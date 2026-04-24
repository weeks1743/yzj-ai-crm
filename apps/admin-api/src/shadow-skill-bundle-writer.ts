import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  ShadowDictionaryBindingRecord,
  ShadowObjectKey,
  ShadowSkillContract,
  ShadowStandardizedField,
} from './contracts.js';

interface ShadowSkillBundleWriterOptions {
  outputDir: string;
}

interface WriteShadowSkillBundlesParams {
  objectKey: ShadowObjectKey;
  objectLabel: string;
  formCodeId: string;
  formDefId: string | null;
  snapshotVersion: string;
  schemaHash: string;
  rawTemplate: unknown;
  fields: ShadowStandardizedField[];
  dictionaryBindings: ShadowDictionaryBindingRecord[];
  skills: ShadowSkillContract[];
}

const SHADOW_SKILL_PHASE = '0.2.17';

function toJsonFile(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function toYamlQuoted(value: string): string {
  return JSON.stringify(value);
}

function toTitleCase(operation: ShadowSkillContract['operation']): string {
  switch (operation) {
    case 'search':
      return 'Search';
    case 'get':
      return 'Get';
    case 'create':
      return 'Create';
    case 'update':
      return 'Update';
    case 'delete':
      return 'Delete';
  }
}

function formatCodeList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(', ') : '(none)';
}

function getSearchCoverageSummary(
  skill: ShadowSkillContract,
  fields: ShadowStandardizedField[],
): {
  baseParamKeys: string[];
  relationSummaries: string[];
  excludedFieldSummaries: string[];
} {
  const optionalParamSet = new Set(skill.optionalParams);
  const relationParamKeys = new Set<string>();
  const relationSummaries: string[] = [];
  const excludedFieldSummaries: string[] = [];

  for (const field of fields) {
    const parameterKey = field.semanticSlot ?? field.fieldCode;
    if (field.widgetType === 'basicDataWidget') {
      const resolvedParamKey =
        (optionalParamSet.has(field.fieldCode) && field.fieldCode) ||
        (typeof field.semanticSlot === 'string' && optionalParamSet.has(field.semanticSlot)
          ? field.semanticSlot
          : null);
      if (!resolvedParamKey || !field.relationBinding?.formCodeId) {
        excludedFieldSummaries.push(`${field.label}(${field.fieldCode})`);
        continue;
      }

      relationParamKeys.add(resolvedParamKey);
      relationSummaries.push(
        `${resolvedParamKey} -> ${field.fieldCode} (displayCol: ${
          field.relationBinding.displayCol ?? 'unknown'
        }, formCodeId: ${field.relationBinding.formCodeId})`,
      );
      continue;
    }

    if (field.widgetType === 'attachmentWidget') {
      excludedFieldSummaries.push(`${field.label}(${field.fieldCode}, attachmentWidget)`);
      continue;
    }

    if (field.widgetType === 'publicOptBoxWidget') {
      const reason = field.referId
        ? field.enumBinding?.resolutionStatus === 'resolved'
          ? null
          : 'dictionary_unresolved'
        : 'missing_referId';
      if (reason) {
        excludedFieldSummaries.push(`${field.label}(${field.fieldCode}, publicOptBoxWidget, ${reason})`);
      }
      continue;
    }

    if (
      field.widgetType === 'describeWidget' ||
      field.widgetType === 'detailedWidget' ||
      field.widgetType === 'arithmeticWidget' ||
      field.widgetType === 'imageWidget' ||
      field.widgetType === 'relatedWidget' ||
      field.widgetType === 'kingGridWidget'
    ) {
      excludedFieldSummaries.push(`${field.label}(${field.fieldCode}, ${field.widgetType})`);
    }
  }

  const baseParamKeys = skill.optionalParams.filter((key) => !relationParamKeys.has(key));

  return {
    baseParamKeys,
    relationSummaries,
    excludedFieldSummaries,
  };
}

function getRelationFieldNotes(fields: ShadowStandardizedField[]): string[] {
  return fields
    .filter((field) => field.widgetType === 'basicDataWidget' && field.relationBinding?.formCodeId)
    .map((field) => {
      const parameterKey = field.semanticSlot ?? field.fieldCode;
      const displayCol = field.relationBinding?.displayCol ?? 'unknown';
      const relationFormCodeId = field.relationBinding?.formCodeId ?? 'unknown';

      return `- Relation field \`${parameterKey}\` maps to \`${field.fieldCode}\`; exact search uses \`${displayCol}\` as \`_name_\`, target \`formCodeId\` is \`${relationFormCodeId}\`.`;
    });
}

function getOperationLabel(operation: ShadowSkillContract['operation']): string {
  switch (operation) {
    case 'search':
      return '查询';
    case 'get':
      return '详情读取';
    case 'create':
      return '新建';
    case 'update':
      return '更新';
    case 'delete':
      return '删除';
  }
}

function getOperationShortDescription(
  objectLabel: string,
  operation: ShadowSkillContract['operation'],
): string {
  switch (operation) {
    case 'search':
      return `按${objectLabel}模板执行或预演轻云条件查询请求`;
    case 'get':
      return `按formInstId执行或预演${objectLabel}详情读取请求`;
    case 'create':
      return `按${objectLabel}模板预演轻云新建请求`;
    case 'update':
      return `按${objectLabel}模板预演轻云更新请求`;
    case 'delete':
      return `按formInstIds预演或执行${objectLabel}批量删除请求`;
  }
}

function renderOpenAiYaml(skill: ShadowSkillContract, objectLabel: string): string {
  return [
    'interface:',
    `  display_name: ${toYamlQuoted(`${objectLabel}${getOperationLabel(skill.operation)}（影子）`)}`,
    `  short_description: ${toYamlQuoted(getOperationShortDescription(objectLabel, skill.operation))}`,
    `  default_prompt: ${toYamlQuoted(`Use $${skill.skillName} to prepare a preview-first ${objectLabel} ${skill.operation} request from the current shadow template snapshot.`)}`,
    'policy:',
    '  allow_implicit_invocation: false',
    '',
  ].join('\n');
}

function renderSkillMarkdown(params: {
  skill: ShadowSkillContract;
  objectLabel: string;
  formCodeId: string;
  snapshotVersion: string;
  schemaHash: string;
  fields: ShadowStandardizedField[];
  dictionaryBindings: ShadowDictionaryBindingRecord[];
}): string {
  const { skill, objectLabel, formCodeId, snapshotVersion, schemaHash, fields, dictionaryBindings } = params;
  const resolvedDictionaryCount = dictionaryBindings.filter(
    (binding) => binding.resolutionStatus === 'resolved',
  ).length;
  const pendingDictionaryCount = dictionaryBindings.length - resolvedDictionaryCount;
  const isWriteFieldSkill = skill.operation === 'create' || skill.operation === 'update';
  const relationFieldNotes = skill.operation === 'delete' ? [] : getRelationFieldNotes(fields);
  const requiredParams = skill.requiredParams.length > 0 ? skill.requiredParams.join(', ') : '(none)';
  const optionalParams = skill.optionalParams.length > 0 ? skill.optionalParams.join(', ') : '(none)';
  const confirmationNote =
    skill.confirmationPolicy === 'required_before_write'
      ? skill.executionBinding.phase === 'live_write_enabled'
        ? 'This write skill now exposes a live write API. Use preview first, then call live write only after explicit user confirmation.'
        : 'This is still a preview-first write skill. Do not send a real LightCloud write unless a later phase explicitly enables it.'
      : 'This is a read / preview skill and does not require write confirmation.';
  const getFormInstIdNote =
    skill.operation === 'get'
      ? '- `form_inst_id` is mandatory. Do not guess it from customer names or fuzzy search results.'
      : null;
  const deleteFormInstIdsNote =
    skill.operation === 'delete'
      ? '- `form_inst_ids` is mandatory and must contain exact LightCloud `formInstId` values gathered from a prior search/get result. Do not guess, fuzzily derive, or silently expand this list.'
      : null;
  const personFieldNote = isWriteFieldSkill && fields.some((field) => field.widgetType === 'personSelectWidget')
    ? '- Person fields should use Yunzhijia personnel `open_id` values. Single-select person params may be passed as a plain `open_id` string and will be normalized to the LightCloud string-array format.'
    : null;
  const attachmentFieldNote =
    isWriteFieldSkill && fields.some((field) => field.widgetType === 'attachmentWidget')
    ? '- Attachment fields accept either a single uploaded file object or an array. Upload local files first with `$approval.file_upload`, then pass `{fileId,fileName,fileSize,fileType,fileExt}` objects exactly as returned by the file-upload skill or internal upload API.'
    : null;
  const basicDataFieldNote = isWriteFieldSkill && fields.some((field) => field.widgetType === 'basicDataWidget')
    ? '- `basicDataWidget` relation fields accept a linked `formInstId`/`id` string, a `{formInstId}`/`{id}` object, or a full relation object. Write paths resolve them into LightCloud relation objects; search exact-match paths normalize them into `[{_id_,_name_}]`, while display-text search uses the linked display field value directly.'
    : null;
  const searchFieldNote =
    skill.operation === 'search'
      ? '- Search input aligns to `search2Gen`. Search `pageSize` must stay within `1..100`. For `basicDataWidget`, exact match should include `operator`; the value may be `formInstId/id`, a full relation object, or an explicit token. If the input is display text only, omit `operator` or use `contain` / `like`; exact-like operators automatically downgrade to display-text search when no linked record id can be resolved. Date search normalizes to `range` with Shanghai-time timestamps and `lightFieldMap.plusDay=false`.'
      : null;
  const operatorVisibilityNote =
    skill.operation === 'search' && skill.sourceObject === 'customer'
      ? '- Real validation shows customer `searchList` visibility depends on `operatorOpenId`. Use an operator account that can see customer list data. Current verified customer-search sample `operatorOpenId` is `69e75eb5e4b0e65b61c014da`; `66160cfde4b014e237ba75ca` may return empty results for customer search even when direct get still works.'
      : skill.operation === 'search' && skill.sourceObject === 'contact'
        ? '- Current verified contact-search sample `operatorOpenId` is `66160cfde4b014e237ba75ca`; this operator can query contact list data in live validation.'
        : null;
  const customerSearchExampleNote =
    skill.operation === 'search' && skill.sourceObject === 'customer'
      ? '- Customer search preview examples use the minimal linked-contact display value `CON-20260424-001` and date-range timestamps such as `[1777046400000,1777132799999]`.'
      : null;
  const ignoredFieldNote = fields.some(
    (field) =>
      field.widgetType === 'publicOptBoxWidget' && !field.referId,
  )
    ? '- `publicOptBoxWidget` fields without `referId` stay in template references for context only until a usable dictionary source is available. Do not invent enum payloads.'
    : null;
  const searchCoverage =
    skill.operation === 'search'
      ? getSearchCoverageSummary(skill, fields)
      : null;

  return [
    '---',
    `name: ${skill.skillName}`,
    `description: ${getOperationShortDescription(objectLabel, skill.operation)}，并引用当前模板快照与公共选项资源。`,
    '---',
    '',
    `# Shadow ${objectLabel} ${toTitleCase(skill.operation)}`,
    '',
    `Use this bundle only for the \`${skill.sourceObject}\` object. It is generated from the current approval template snapshot and is intended for Codex-style \`SKILL.md\` consumption while remaining readable to other agents such as Claude.`,
    '',
    '## Snapshot',
    '',
    `- \`formCodeId\`: \`${formCodeId}\``,
    `- \`source_version\`: \`${snapshotVersion}\``,
    `- \`schema_hash\`: \`${schemaHash}\``,
    `- \`field_count\`: \`${fields.length}\``,
    `- \`resolved_public_option_fields\`: \`${resolvedDictionaryCount}\``,
    `- \`pending_public_option_fields\`: \`${pendingDictionaryCount}\``,
    '',
    '## Workflow',
    '',
    '1. Read `references/skill-bundle.json` for the fixed skill contract and execution boundary.',
    '2. Read `references/template-summary.json` for normalized field metadata. Open `references/template-raw.json` only when the normalized snapshot is insufficient.',
    '3. For any `publicOptBoxWidget`, inspect `references/dictionaries.json` before accepting or mapping user input.',
    skill.executionBinding.liveApi
      ? skill.confirmationPolicy === 'required_before_write'
        ? '4. Use the preview defined in `references/execution.json` first; after explicit confirmation, call the live API.'
        : '4. Prefer the live API defined in `references/execution.json`; fall back to preview only when you need a dry-run.'
      : '4. Build or call the preview defined in `references/execution.json`.',
    '5. Never invent fields, `dicId` values, or aliases that are absent from the referenced snapshot files.',
    '',
    '## Input Rules',
    '',
    `- Required params: ${requiredParams}`,
    `- Optional params: ${optionalParams}`,
    `- Confirmation policy: \`${skill.confirmationPolicy}\``,
    confirmationNote ? `- ${confirmationNote}` : '',
    getFormInstIdNote ?? '',
    deleteFormInstIdsNote ?? '',
    personFieldNote ?? '',
    attachmentFieldNote ?? '',
    basicDataFieldNote ?? '',
    ...relationFieldNotes,
    searchFieldNote ?? '',
    operatorVisibilityNote ?? '',
    customerSearchExampleNote ?? '',
    ignoredFieldNote ?? '',
    '',
    searchCoverage ? '## Search Coverage' : null,
    searchCoverage
      ? `- Base searchable params (${searchCoverage.baseParamKeys.length}): ${formatCodeList(
          searchCoverage.baseParamKeys,
        )}`
      : null,
    searchCoverage
      ? `- Relation searchable params (${searchCoverage.relationSummaries.length}): ${
          searchCoverage.relationSummaries.length > 0
            ? searchCoverage.relationSummaries.map((item) => `\`${item}\``).join(', ')
            : '(none)'
        }`
      : null,
    searchCoverage
      ? `- Not auto-generated for search: ${
          searchCoverage.excludedFieldSummaries.length > 0
            ? searchCoverage.excludedFieldSummaries.map((item) => `\`${item}\``).join(', ')
            : '(none)'
        }`
      : null,
    searchCoverage ? '' : null,
    '## Public Option Rules',
    '',
    '- Resolved dictionaries may accept `title`, `dicId`, or `{title,dicId}` and must normalize to `[{title,dicId}]`.',
    '- Unresolved dictionaries must not use title-only guessing. Only explicit `{title,dicId}` input is allowed.',
    '- If a public option field is unresolved and the caller does not provide an explicit value, leave the field unset.',
    '',
    '## Execution',
    '',
    `- Internal preview API: \`${skill.executionBinding.previewApi.method} ${skill.executionBinding.previewApi.path}\``,
    skill.executionBinding.liveApi
      ? `- Internal live API: \`${skill.executionBinding.liveApi.method} ${skill.executionBinding.liveApi.path}\``
      : null,
    `- Upstream LightCloud preview target: \`${skill.executionBinding.lightCloudPreview.method} ${skill.executionBinding.lightCloudPreview.url}\``,
    skill.executionBinding.lightCloudLive
      ? `- Upstream LightCloud live target: \`${skill.executionBinding.lightCloudLive.method} ${skill.executionBinding.lightCloudLive.url}\``
      : null,
    skill.executionBinding.phase === 'live_read_enabled'
      ? `- This bundle is generated for phase \`${SHADOW_SKILL_PHASE}\`; read operations may execute against LightCloud, while writes remain preview-first.`
      : skill.executionBinding.phase === 'live_write_enabled'
        ? `- This bundle is generated for phase \`${SHADOW_SKILL_PHASE}\`; live write is enabled and should only be used after explicit user confirmation.`
        : `- This bundle is generated for phase \`${SHADOW_SKILL_PHASE}\` and remains preview-first.`,
    '',
    '## References',
    '',
    '- `references/skill-bundle.json`',
    '- `references/template-summary.json`',
    '- `references/template-raw.json`',
    '- `references/dictionaries.json`',
    '- `references/execution.json`',
    '',
  ]
    .filter((line) => line !== null && line !== undefined)
    .join('\n');
}

export class ShadowSkillBundleWriter {
  private readonly outputDir: string;

  constructor(options: ShadowSkillBundleWriterOptions) {
    this.outputDir = options.outputDir;
  }

  writeBundles(params: WriteShadowSkillBundlesParams): ShadowSkillContract[] {
    const objectDirectory = resolve(this.outputDir, params.objectKey);
    rmSync(objectDirectory, { recursive: true, force: true });
    mkdirSync(objectDirectory, { recursive: true });

    return params.skills.map((skill) => {
      const bundleDirectory = resolve(objectDirectory, skill.operation);
      const referencesDirectory = resolve(bundleDirectory, 'references');
      const agentsDirectory = resolve(bundleDirectory, 'agents');

      mkdirSync(referencesDirectory, { recursive: true });
      mkdirSync(agentsDirectory, { recursive: true });

      const skillPath = resolve(bundleDirectory, 'SKILL.md');
      const agentMetadataPath = resolve(agentsDirectory, 'openai.yaml');
      const referencePaths = {
        skillBundle: resolve(referencesDirectory, 'skill-bundle.json'),
        templateSummary: resolve(referencesDirectory, 'template-summary.json'),
        templateRaw: resolve(referencesDirectory, 'template-raw.json'),
        dictionaries: resolve(referencesDirectory, 'dictionaries.json'),
        execution: resolve(referencesDirectory, 'execution.json'),
      };

      const enrichedSkill: ShadowSkillContract = {
        ...skill,
        bundleDirectory,
        skillPath,
        agentMetadataPath,
        referencePaths,
      };

      writeFileSync(
        referencePaths.skillBundle,
        toJsonFile({
          skillName: enrichedSkill.skillName,
          skillKey: enrichedSkill.skillKey,
          operation: enrichedSkill.operation,
          description: enrichedSkill.description,
          whenToUse: enrichedSkill.whenToUse,
          notWhenToUse: enrichedSkill.notWhenToUse,
          requiredParams: enrichedSkill.requiredParams,
          optionalParams: enrichedSkill.optionalParams,
          confirmationPolicy: enrichedSkill.confirmationPolicy,
          outputCardType: enrichedSkill.outputCardType,
          sourceObject: enrichedSkill.sourceObject,
          sourceFormCodeId: enrichedSkill.sourceFormCodeId,
          sourceVersion: enrichedSkill.sourceVersion,
        }),
        'utf8',
      );

      writeFileSync(
        referencePaths.templateSummary,
        toJsonFile({
          objectKey: params.objectKey,
          objectLabel: params.objectLabel,
          formCodeId: params.formCodeId,
          formDefId: params.formDefId,
          sourceVersion: params.snapshotVersion,
          schemaHash: params.schemaHash,
          fieldCount: params.fields.length,
          normalizedFields: params.fields,
        }),
        'utf8',
      );

      writeFileSync(referencePaths.templateRaw, toJsonFile(params.rawTemplate), 'utf8');

      writeFileSync(
        referencePaths.dictionaries,
        toJsonFile({
          objectKey: params.objectKey,
          sourceVersion: params.snapshotVersion,
          bindings: params.dictionaryBindings,
        }),
        'utf8',
      );

      writeFileSync(
        referencePaths.execution,
        toJsonFile(enrichedSkill.executionBinding),
        'utf8',
      );

      writeFileSync(
        skillPath,
        renderSkillMarkdown({
          skill: enrichedSkill,
          objectLabel: params.objectLabel,
          formCodeId: params.formCodeId,
          snapshotVersion: params.snapshotVersion,
          schemaHash: params.schemaHash,
          fields: params.fields,
          dictionaryBindings: params.dictionaryBindings,
        }),
        'utf8',
      );

      writeFileSync(agentMetadataPath, renderOpenAiYaml(enrichedSkill, params.objectLabel), 'utf8');

      return enrichedSkill;
    });
  }
}
