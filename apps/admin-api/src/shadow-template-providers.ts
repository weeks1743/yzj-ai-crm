import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  ShadowFieldProvenance,
  ShadowMergedTemplateDiagnostics,
  ShadowMergedTemplateRaw,
  YzjApprovalDetailWidget,
  YzjApprovalFormTemplateResponse,
  YzjApprovalWidget,
} from './contracts.js';
import { ApprovalClient } from './approval-client.js';

type PublicTemplatePayload = NonNullable<YzjApprovalFormTemplateResponse['data']>;

export interface ShadowPublicTemplateSnapshot {
  formCodeId: string;
  formDefId: string | null;
  payload: PublicTemplatePayload;
  widgetMap: Record<string, YzjApprovalWidget>;
  detailMap: Record<string, YzjApprovalDetailWidget>;
}

export interface ShadowInternalTemplateSnapshot {
  formCodeId: string;
  formDefId: string | null;
  templateTitle: string | null;
  payload: unknown;
  widgetMap: Record<string, YzjApprovalWidget>;
}

export interface ShadowMergedTemplateSnapshot {
  formCodeId: string;
  formDefId: string | null;
  rawTemplate: ShadowMergedTemplateRaw;
  widgetMap: Record<string, YzjApprovalWidget>;
  fieldProvenance: Record<string, ShadowFieldProvenance>;
}

export interface ShadowPublicTemplateProvider {
  getTemplate(params: { accessToken: string; formCodeId: string }): Promise<ShadowPublicTemplateSnapshot>;
}

export interface ShadowInternalTemplateProvider {
  getTemplate(params: { formCodeId: string }): Promise<ShadowInternalTemplateSnapshot | null>;
}

export class ApprovalPublicTemplateProvider implements ShadowPublicTemplateProvider {
  private readonly approvalClient: ApprovalClient;

  constructor(options: { approvalClient: ApprovalClient }) {
    this.approvalClient = options.approvalClient;
  }

  async getTemplate(params: {
    accessToken: string;
    formCodeId: string;
  }): Promise<ShadowPublicTemplateSnapshot> {
    const payload = await this.approvalClient.viewFormDef(params);
    return {
      formCodeId: params.formCodeId,
      formDefId: extractPublicFormDefId(payload),
      payload,
      widgetMap: payload.formInfo?.widgetMap ?? {},
      detailMap: payload.formInfo?.detailMap ?? {},
    };
  }
}

export class FixtureInternalTemplateProvider implements ShadowInternalTemplateProvider {
  private readonly directory: string;

  constructor(options: { directory: string }) {
    this.directory = options.directory;
  }

  async getTemplate(params: { formCodeId: string }): Promise<ShadowInternalTemplateSnapshot | null> {
    const filePath = resolve(this.directory, `${params.formCodeId}.json`);
    if (!existsSync(filePath)) {
      return null;
    }

    const payload = JSON.parse(readFileSync(filePath, 'utf8')) as {
      data?: {
        formTemplate?: {
          id?: string | null;
          formTemplateId?: string | null;
          title?: string | null;
          formWidgets?: unknown[];
        };
      };
    };
    const formTemplate = payload.data?.formTemplate;
    const widgetMap = buildWidgetMapFromInternalWidgets(formTemplate?.formWidgets ?? []);

    return {
      formCodeId: params.formCodeId,
      formDefId: extractInternalFormDefId(payload),
      templateTitle: typeof formTemplate?.title === 'string' && formTemplate.title.trim()
        ? formTemplate.title.trim()
        : null,
      payload,
      widgetMap,
    };
  }
}

export function mergeShadowTemplateSnapshots(params: {
  formCodeId: string;
  publicTemplate: ShadowPublicTemplateSnapshot;
  internalTemplate: ShadowInternalTemplateSnapshot | null;
}): ShadowMergedTemplateSnapshot {
  const publicWidgetMap = params.publicTemplate.widgetMap;
  const internalWidgetMap = params.internalTemplate?.widgetMap ?? {};
  const fieldCodeSet = new Set([...Object.keys(publicWidgetMap), ...Object.keys(internalWidgetMap)]);
  const mergedWidgetMap: Record<string, YzjApprovalWidget> = {};
  const fieldProvenance: Record<string, ShadowFieldProvenance> = {};
  const publicOnlyFields: string[] = [];
  const internalOnlyFields: string[] = [];
  const truthOverlayFields: string[] = [];

  for (const fieldCode of fieldCodeSet) {
    const publicWidget = publicWidgetMap[fieldCode];
    const internalWidget = internalWidgetMap[fieldCode];

    if (publicWidget && !internalWidget) {
      publicOnlyFields.push(fieldCode);
    }

    if (internalWidget && !publicWidget) {
      internalOnlyFields.push(fieldCode);
    }

    if (publicWidget && internalWidget && shouldRecordTruthOverlay(publicWidget, internalWidget)) {
      truthOverlayFields.push(fieldCode);
    }

    mergedWidgetMap[fieldCode] = mergeWidgets(publicWidget, internalWidget);
    fieldProvenance[fieldCode] = {
      sources: [
        ...(publicWidget ? ['public_view_form_def' as const] : []),
        ...(internalWidget ? ['internal_get_form_by_code_id' as const] : []),
      ],
      truthSource: internalWidget ? 'internal_get_form_by_code_id' : 'public_view_form_def',
    };
  }

  const mergeDiagnostics: ShadowMergedTemplateDiagnostics = {
    publicWidgetCount: Object.keys(publicWidgetMap).length,
    internalWidgetCount: Object.keys(internalWidgetMap).length,
    mergedWidgetCount: Object.keys(mergedWidgetMap).length,
    publicOnlyFields: publicOnlyFields.sort(),
    internalOnlyFields: internalOnlyFields.sort(),
    truthOverlayFields: truthOverlayFields.sort(),
  };

  const rawTemplate: ShadowMergedTemplateRaw = {
    ...params.publicTemplate.payload,
    formDefId: params.publicTemplate.formDefId ?? params.internalTemplate?.formDefId ?? null,
    basicInfo: {
      ...(params.publicTemplate.payload.basicInfo ?? {}),
      formDefId:
        params.publicTemplate.payload.basicInfo?.formDefId ??
        params.publicTemplate.formDefId ??
        params.internalTemplate?.formDefId ??
        null,
    },
    formInfo: {
      ...(params.publicTemplate.payload.formInfo ?? {}),
      detailMap: params.publicTemplate.detailMap,
      widgetMap: mergedWidgetMap,
    },
    templateTitle: params.internalTemplate?.templateTitle ?? null,
    sourcePayloads: {
      publicViewFormDef: params.publicTemplate.payload,
      internalGetFormByCodeId: params.internalTemplate?.payload ?? null,
    },
    mergeDiagnostics,
  };

  return {
    formCodeId: params.formCodeId,
    formDefId: rawTemplate.formDefId ?? null,
    rawTemplate,
    widgetMap: mergedWidgetMap,
    fieldProvenance,
  };
}

function extractPublicFormDefId(payload: PublicTemplatePayload): string | null {
  const candidates = [payload.formDefId, payload.basicInfo?.formDefId];
  return candidates.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function extractInternalFormDefId(payload: {
  data?: {
    formTemplate?: {
      id?: string | null;
      formTemplateId?: string | null;
    };
  };
}): string | null {
  const formTemplate = payload.data?.formTemplate;
  const candidates = [formTemplate?.id, formTemplate?.formTemplateId];
  return candidates.find((value): value is string => Boolean(value?.trim())) ?? null;
}

function buildWidgetMapFromInternalWidgets(widgets: unknown[]): Record<string, YzjApprovalWidget> {
  const widgetMap: Record<string, YzjApprovalWidget> = {};
  for (const widget of widgets) {
    if (!widget || typeof widget !== 'object') {
      continue;
    }
    const typedWidget = widget as YzjApprovalWidget;
    if (typeof typedWidget.codeId !== 'string' || !typedWidget.codeId.trim()) {
      continue;
    }
    widgetMap[typedWidget.codeId] = typedWidget;
  }
  return widgetMap;
}

function mergeWidgets(
  publicWidget: YzjApprovalWidget | undefined,
  internalWidget: YzjApprovalWidget | undefined,
): YzjApprovalWidget {
  if (!publicWidget && internalWidget) {
    return structuredClone(internalWidget);
  }

  if (!internalWidget && publicWidget) {
    return structuredClone(publicWidget);
  }

  if (!publicWidget || !internalWidget) {
    throw new Error('mergeWidgets requires at least one widget source');
  }

  return mergeUnknown(publicWidget, internalWidget) as YzjApprovalWidget;
}

function mergeUnknown(publicValue: unknown, internalValue: unknown): unknown {
  if (internalValue === undefined) {
    return cloneValue(publicValue);
  }

  if (publicValue === undefined) {
    return cloneValue(internalValue);
  }

  if (Array.isArray(publicValue) && Array.isArray(internalValue)) {
    return internalValue.length >= publicValue.length
      ? cloneValue(internalValue)
      : cloneValue(publicValue);
  }

  if (isPlainObject(publicValue) && isPlainObject(internalValue)) {
    const merged: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(publicValue), ...Object.keys(internalValue)]);
    for (const key of keys) {
      merged[key] = mergeUnknown(
        (publicValue as Record<string, unknown>)[key],
        (internalValue as Record<string, unknown>)[key],
      );
    }
    return merged;
  }

  return cloneValue(internalValue);
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldRecordTruthOverlay(
  publicWidget: YzjApprovalWidget,
  internalWidget: YzjApprovalWidget,
): boolean {
  return TRUTH_KEYS.some((key) => publicWidget[key] !== undefined && publicWidget[key] !== internalWidget[key]);
}

const TRUTH_KEYS: Array<keyof YzjApprovalWidget> = [
  'required',
  'isRequired',
  'requiredFlag',
  'mustInput',
  'notNull',
  'readOnly',
  'edit',
  'view',
  'systemDefault',
  'placeholder',
  'noRepeat',
];
