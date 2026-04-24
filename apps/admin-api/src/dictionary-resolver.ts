import { existsSync, readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type {
  FieldBoundDictionaryKey,
  ManualDictionaryFile,
  ShadowDictionaryResolutionStatus,
  ShadowResolvedDictionarySource,
  ShadowDictionarySource,
} from './contracts.js';
import { ApprovalClient } from './approval-client.js';
import { ConfigError } from './errors.js';

const FIELD_BOUND_ROOT_DIC_IDS: Record<FieldBoundDictionaryKey, string> = {
  province: 'd005',
  city: 'd006',
  district: 'd007',
};

const FIELD_BOUND_ROOT_TITLES: Record<FieldBoundDictionaryKey, string> = {
  province: '省',
  city: '市',
  district: '区',
};

export interface ResolvedDictionaryEntry {
  referId: string;
  dicId: string;
  title: string;
  code: string | null;
  state: string | null;
  sort: number | null;
  aliases: string[];
}

export interface ResolvedDictionaryBinding {
  referId: string;
  source: ShadowResolvedDictionarySource;
  resolutionStatus: ShadowDictionaryResolutionStatus;
  entries: ResolvedDictionaryEntry[];
}

interface DictionaryResolverOptions {
  source: ShadowDictionarySource;
  jsonPath: string;
  approvalClient: ApprovalClient;
  fieldBoundWorkbookPath?: string;
}

export class DictionaryResolver {
  private readonly source: ShadowDictionarySource;
  private readonly jsonPath: string;
  private readonly approvalClient: ApprovalClient;
  private readonly fieldBoundWorkbookPath: string | null;
  private fieldBoundWorkbookCache: Map<FieldBoundDictionaryKey, ResolvedDictionaryBinding> | null = null;

  constructor(options: DictionaryResolverOptions) {
    this.source = options.source;
    this.jsonPath = options.jsonPath;
    this.approvalClient = options.approvalClient;
    this.fieldBoundWorkbookPath = options.fieldBoundWorkbookPath ?? null;
  }

  async resolvePublicOptions(params: {
    referIds: string[];
    accessToken?: string;
  }): Promise<Map<string, ResolvedDictionaryBinding>> {
    const referIds = [...new Set(params.referIds.filter(Boolean))];
    const result = new Map<string, ResolvedDictionaryBinding>();

    const manualEntries = this.loadManualEntries();
    for (const referId of referIds) {
      const manualBinding = manualEntries.get(referId);
      if (manualBinding) {
        result.set(referId, manualBinding);
      }
    }

    if (this.source === 'approval_api' || this.source === 'hybrid') {
      const unresolvedReferIds = referIds.filter((referId) => !result.has(referId));
      if (params.accessToken) {
        for (const referId of unresolvedReferIds) {
          const approvalBinding = await this.resolveFromApprovalApi(referId, params.accessToken);
          if (approvalBinding) {
            result.set(referId, approvalBinding);
          }
        }
      }
    }

    for (const referId of referIds) {
      if (!result.has(referId)) {
        result.set(referId, {
          referId,
          source: this.source === 'approval_api' ? 'approval_api' : 'unresolved',
          resolutionStatus: 'pending',
          entries: [],
        });
      }
    }

    return result;
  }

  resolveFieldBoundOptions(params: {
    bindingKeys: FieldBoundDictionaryKey[];
  }): Map<FieldBoundDictionaryKey, ResolvedDictionaryBinding> {
    const bindingKeys = [...new Set(params.bindingKeys)];
    const resolved = this.loadFieldBoundEntries();
    const result = new Map<FieldBoundDictionaryKey, ResolvedDictionaryBinding>();

    for (const bindingKey of bindingKeys) {
      result.set(
        bindingKey,
        resolved.get(bindingKey) ?? this.createFieldBoundFailureBinding(bindingKey),
      );
    }

    return result;
  }

  private loadManualEntries(): Map<string, ResolvedDictionaryBinding> {
    if (this.source === 'approval_api') {
      return new Map();
    }

    if (!existsSync(this.jsonPath)) {
      return new Map();
    }

    let payload: ManualDictionaryFile;
    try {
      payload = JSON.parse(readFileSync(this.jsonPath, 'utf8')) as ManualDictionaryFile;
    } catch (error) {
      throw new ConfigError(`公共选项码表 JSON 无法解析: ${this.jsonPath}`, {
        path: this.jsonPath,
        cause: error,
      });
    }

    if (!payload || !Array.isArray(payload.dictionaries)) {
      throw new ConfigError(`公共选项码表 JSON 格式无效: ${this.jsonPath}`);
    }

    const result = new Map<string, ResolvedDictionaryBinding>();
    for (const definition of payload.dictionaries) {
      if (!definition?.referId || !Array.isArray(definition.entries)) {
        continue;
      }

      result.set(definition.referId, {
        referId: definition.referId,
        source: 'manual_json',
        resolutionStatus: definition.entries.length > 0 ? 'resolved' : 'pending',
        entries: definition.entries.map((entry) => ({
          referId: definition.referId,
          dicId: entry.dicId,
          title: entry.title,
          code: entry.code ?? null,
          state: entry.state ?? null,
          sort: typeof entry.sort === 'number' ? entry.sort : null,
          aliases: [
            definition.title,
            ...(definition.aliases ?? []),
            ...(entry.aliases ?? []),
          ],
        })),
      });
    }

    return result;
  }

  private loadFieldBoundEntries(): Map<FieldBoundDictionaryKey, ResolvedDictionaryBinding> {
    if (this.fieldBoundWorkbookCache) {
      return this.fieldBoundWorkbookCache;
    }

    if (!this.fieldBoundWorkbookPath || !existsSync(this.fieldBoundWorkbookPath)) {
      this.fieldBoundWorkbookCache = new Map(
        (Object.keys(FIELD_BOUND_ROOT_DIC_IDS) as FieldBoundDictionaryKey[]).map((bindingKey) => [
          bindingKey,
          this.createFieldBoundFailureBinding(bindingKey),
        ]),
      );
      return this.fieldBoundWorkbookCache;
    }

    try {
      const workbookBuffer = readFileSync(this.fieldBoundWorkbookPath);
      const workbook = XLSX.read(workbookBuffer, {
        type: 'buffer',
      });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        throw new ConfigError(`省市区码表工作簿没有可用工作表: ${this.fieldBoundWorkbookPath}`);
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: null,
      });

      const rootIdByBindingKey = new Map<FieldBoundDictionaryKey, string>();
      for (const row of rows) {
        if (readNumberCell(row.type) !== 1) {
          continue;
        }

        const dicId = readStringCell(row.dicId);
        const title = readStringCell(row.title);
        for (const bindingKey of Object.keys(FIELD_BOUND_ROOT_DIC_IDS) as FieldBoundDictionaryKey[]) {
          if (
            dicId === FIELD_BOUND_ROOT_DIC_IDS[bindingKey] ||
            title === FIELD_BOUND_ROOT_TITLES[bindingKey]
          ) {
            rootIdByBindingKey.set(bindingKey, dicId || FIELD_BOUND_ROOT_DIC_IDS[bindingKey]);
          }
        }
      }

      const entriesByBindingKey = new Map<FieldBoundDictionaryKey, ResolvedDictionaryEntry[]>(
        (Object.keys(FIELD_BOUND_ROOT_DIC_IDS) as FieldBoundDictionaryKey[]).map((bindingKey) => [
          bindingKey,
          [],
        ]),
      );

      for (const row of rows) {
        if (readNumberCell(row.type) !== 0) {
          continue;
        }

        const parentId = readStringCell(row.parentId);
        const bindingKey = (Object.keys(FIELD_BOUND_ROOT_DIC_IDS) as FieldBoundDictionaryKey[]).find(
          (key) => parentId === (rootIdByBindingKey.get(key) ?? FIELD_BOUND_ROOT_DIC_IDS[key]),
        );
        if (!bindingKey) {
          continue;
        }

        const dicId = readStringCell(row.dicId);
        const title = readStringCell(row.title);
        if (!dicId || !title) {
          continue;
        }

        entriesByBindingKey.get(bindingKey)?.push({
          referId: bindingKey,
          dicId,
          title,
          code: readStringCell(row.code) || null,
          state: null,
          sort: readNumberCell(row.sort),
          aliases: [],
        });
      }

      this.fieldBoundWorkbookCache = new Map(
        (Object.keys(FIELD_BOUND_ROOT_DIC_IDS) as FieldBoundDictionaryKey[]).map((bindingKey) => {
          const entries = [...(entriesByBindingKey.get(bindingKey) ?? [])].sort((left, right) => {
            const leftSort = left.sort ?? Number.MAX_SAFE_INTEGER;
            const rightSort = right.sort ?? Number.MAX_SAFE_INTEGER;
            if (leftSort !== rightSort) {
              return leftSort - rightSort;
            }

            return left.title.localeCompare(right.title, 'zh-Hans-CN');
          });

          return [
            bindingKey,
            {
              referId: bindingKey,
              source: 'field_binding_workbook',
              resolutionStatus: entries.length > 0 ? 'resolved' : 'failed',
              entries,
            } satisfies ResolvedDictionaryBinding,
          ];
        }),
      );

      return this.fieldBoundWorkbookCache;
    } catch (error) {
      if (error instanceof ConfigError) {
        throw error;
      }

      throw new ConfigError(`省市区码表工作簿无法解析: ${this.fieldBoundWorkbookPath}`, {
        path: this.fieldBoundWorkbookPath,
        cause: error,
      });
    }
  }

  private createFieldBoundFailureBinding(
    bindingKey: FieldBoundDictionaryKey,
  ): ResolvedDictionaryBinding {
    return {
      referId: bindingKey,
      source: 'field_binding_workbook',
      resolutionStatus: 'failed',
      entries: [],
    };
  }

  private async resolveFromApprovalApi(
    referId: string,
    accessToken: string,
  ): Promise<ResolvedDictionaryBinding | null> {
    const entries = await this.approvalClient.listPublicOptionElements({
      accessToken,
      parentId: referId,
      pageNumber: 1,
      pageSize: 500,
    });

    if (entries.length === 0) {
      return null;
    }

    return {
      referId,
      source: 'approval_api',
      resolutionStatus: 'resolved',
      entries: entries.map((entry) => ({
        referId,
        dicId: entry.dicId,
        title: entry.title,
        code: entry.code ?? null,
        state: entry.state ?? null,
        sort: typeof entry.sort === 'number' ? entry.sort : null,
        aliases: [],
      })),
    };
  }
}

function readStringCell(value: unknown): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return '';
}

function readNumberCell(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}
