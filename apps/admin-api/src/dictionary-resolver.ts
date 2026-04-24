import { existsSync, readFileSync } from 'node:fs';
import type {
  ManualDictionaryFile,
  ShadowDictionaryResolutionStatus,
  ShadowDictionarySource,
} from './contracts.js';
import { ApprovalClient } from './approval-client.js';
import { ConfigError } from './errors.js';

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
  source: ShadowDictionarySource | 'unresolved';
  resolutionStatus: ShadowDictionaryResolutionStatus;
  entries: ResolvedDictionaryEntry[];
}

interface DictionaryResolverOptions {
  source: ShadowDictionarySource;
  jsonPath: string;
  approvalClient: ApprovalClient;
}

export class DictionaryResolver {
  private readonly source: ShadowDictionarySource;
  private readonly jsonPath: string;
  private readonly approvalClient: ApprovalClient;

  constructor(options: DictionaryResolverOptions) {
    this.source = options.source;
    this.jsonPath = options.jsonPath;
    this.approvalClient = options.approvalClient;
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
