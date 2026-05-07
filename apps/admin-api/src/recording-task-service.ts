import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import type {
  AppConfig,
  ArtifactAnchor,
  ExternalSkillJobResponse,
  RecordingAnchorInput,
  RecordingTaskCreateRequest,
  RecordingTaskMaterializeRequest,
  RecordingTaskMaterializeResponse,
  RecordingTaskResponse,
} from './contracts.js';
import { ArtifactService } from './artifact-service.js';
import { ExternalSkillService } from './external-skill-service.js';
import { BadRequestError, ServiceUnavailableError, getErrorMessage } from './errors.js';
import {
  RecordingTaskRepository,
  toRecordingTaskResponse,
  type RecordingTaskRecord,
} from './recording-task-repository.js';
import { TongyiAudioServiceClient, type TongyiAudioServiceTask } from './tongyi-audio-service-client.js';

const RECORDING_MATERIAL_TOOL_CODE = 'tongyi.audio.recording_material';
const DOWNSTREAM_RECORDING_SKILLS = {
  'ext.visit_conversation_understanding': '拜访会话理解',
  'ext.customer_needs_todo_analysis': '客户需求工作待办分析',
  'ext.problem_statement_pm': '问题陈述',
  'ext.customer_value_positioning_pm': '客户价值定位',
} as const;
type DownstreamRecordingSkillCode = keyof typeof DOWNSTREAM_RECORDING_SKILLS;
const PROCESS_ONLY_FILE_NAMES = [
  'transcription.json',
  'translations.json',
  'textPolish.json',
  'task-result.json',
  'create-task.json',
  'summary.txt',
];
const STRUCTURED_ANALYSIS_FILE_NAMES = [
  'mindMapSummary.json',
  'summarization.json',
  'meetingAssistance.json',
  'autoChapters.json',
];

export class RecordingTaskService {
  constructor(
    private readonly options: {
      config: AppConfig;
      repository: RecordingTaskRepository;
      client: TongyiAudioServiceClient;
      artifactService: ArtifactService;
      externalSkillService?: ExternalSkillService;
    },
  ) {}

  async getHealth() {
    let health: Awaited<ReturnType<TongyiAudioServiceClient['health']>>;
    let errorMessage: string | null = null;
    try {
      health = await this.options.client.health();
    } catch (error) {
      errorMessage = getErrorMessage(error);
      health = {
        status: 'unavailable',
        providerConfigured: false,
        capabilities: [],
      };
    }
    return {
      serviceProvider: '通义录音处理',
      status: health.status === 'ok' ? 'running' : 'warning',
      providerConfigured: health.providerConfigured,
      capabilities: health.capabilities,
      errorMessage,
      outputs: ['转写', '摘要', '章节', '关键词', '说话人', '回放', '录音资料包'],
      consumableMaterials: [
        'assets/mindMapSummary.json',
        'assets/summarization.json',
        'assets/meetingAssistance.json',
        'assets/autoChapters.json',
        'recording-material.md',
        'profile-analysis/*.md',
      ],
      structuredAnalysisFiles: STRUCTURED_ANALYSIS_FILE_NAMES,
      processOnlyFiles: PROCESS_ONLY_FILE_NAMES,
      defaultRules: [
        '上传录音后自动生成基础录音资料。',
        '不自动跑完所有下游分析。',
        '用户点击继续使用时再调用对应能力。',
        '生成正式跟进记录前必须用户确认。',
        '录音未关联客户/商机时可以先处理，但写入记录前必须补齐关联。',
      ],
    };
  }

  async createFixtureTask(input: RecordingTaskCreateRequest): Promise<RecordingTaskResponse> {
    const normalized = this.normalizeCreateInput(input);
    if (!normalized.fixtureTaskId) {
      throw new BadRequestError('fixtureTaskId 不能为空');
    }
    const fixtureHash = createHash('md5').update(normalized.fixtureTaskId).digest('hex');
    const existing = await this.options.repository.findByFileHash({
      eid: normalized.eid,
      appId: normalized.appId,
      md5: fixtureHash,
    });
    if (existing) {
      return toRecordingTaskResponse(await this.reuseExistingTask(existing));
    }

    const serviceTask = await this.options.client.createFixtureTask({
      fixtureTaskId: normalized.fixtureTaskId,
      fileName: normalized.fileName,
      anchors: normalized.anchors,
    });
    const record = await this.options.repository.createTask({
      eid: normalized.eid,
      appId: normalized.appId,
      serviceTaskId: serviceTask.taskId,
      providerDataId: serviceTask.providerDataId,
      fixtureTaskId: serviceTask.fixtureTaskId ?? normalized.fixtureTaskId,
      status: serviceTask.status,
      file: readServiceFile(serviceTask, {
        fileName: normalized.fileName || `${normalized.fixtureTaskId}.fixture`,
        mimeType: 'application/octet-stream',
        size: 0,
        md5: fixtureHash,
      }),
      anchors: normalized.anchors,
      servicePayload: serviceTask as unknown as Record<string, unknown>,
      errorMessage: serviceTask.errorMessage,
      createdBy: normalized.createdBy,
    });
    return toRecordingTaskResponse(record);
  }

  async uploadTask(input: {
    eid?: string;
    appId?: string;
    fileName: string;
    mimeType: string;
    content: Buffer;
    anchors?: RecordingAnchorInput;
    createdBy?: string;
  }): Promise<RecordingTaskResponse> {
    const eid = input.eid?.trim() || this.options.config.yzj.eid;
    const appId = input.appId?.trim() || this.options.config.yzj.appId;
    const fileName = input.fileName.trim();
    if (!fileName) {
      throw new BadRequestError('录音文件名不能为空');
    }
    if (!input.content.byteLength) {
      throw new BadRequestError('录音文件不能为空');
    }
    const md5 = createHash('md5').update(input.content).digest('hex');
    const existing = await this.options.repository.findByFileHash({ eid, appId, md5 });
    if (existing && existing.status !== 'failed') {
      return toRecordingTaskResponse(await this.reuseExistingTask(existing));
    }

    const serviceTask = await this.options.client.uploadTask({
      fileName,
      mimeType: input.mimeType || 'application/octet-stream',
      content: input.content,
      anchors: normalizeAnchors(input.anchors),
    });
    if (existing) {
      const restarted = await this.options.repository.replaceFromService({
        taskId: existing.taskId,
        serviceTaskId: serviceTask.taskId,
        providerDataId: serviceTask.providerDataId,
        fixtureTaskId: serviceTask.fixtureTaskId,
        status: serviceTask.status,
        file: readServiceFile(serviceTask, {
          fileName,
          mimeType: input.mimeType || 'application/octet-stream',
          size: input.content.byteLength,
          md5,
        }),
        anchors: normalizeAnchors(input.anchors),
        servicePayload: serviceTask as unknown as Record<string, unknown>,
        errorMessage: serviceTask.errorMessage,
        materialPath: serviceTask.material?.path,
        materialSource: serviceTask.material?.source,
      });
      return toRecordingTaskResponse(restarted);
    }

    const record = await this.options.repository.createTask({
      eid,
      appId,
      serviceTaskId: serviceTask.taskId,
      providerDataId: serviceTask.providerDataId,
      fixtureTaskId: serviceTask.fixtureTaskId,
      status: serviceTask.status,
      file: readServiceFile(serviceTask, {
        fileName,
        mimeType: input.mimeType || 'application/octet-stream',
        size: input.content.byteLength,
        md5,
      }),
      anchors: normalizeAnchors(input.anchors),
      servicePayload: serviceTask as unknown as Record<string, unknown>,
      errorMessage: serviceTask.errorMessage,
      createdBy: input.createdBy?.trim() || 'assistant-web',
    });
    return toRecordingTaskResponse(record);
  }

  async getTask(taskId: string): Promise<RecordingTaskResponse> {
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    return toRecordingTaskResponse(record);
  }

  async materializeTask(
    taskId: string,
    input: RecordingTaskMaterializeRequest = {},
  ): Promise<RecordingTaskMaterializeResponse> {
    const current = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    if (current.status !== 'succeeded') {
      throw new BadRequestError('录音任务尚未完成，不能生成资料包');
    }

    const anchors = { ...current.anchors, ...normalizeAnchors(input.anchors) };
    const serviceTask = await this.options.client.materialize({
      taskId: current.serviceTaskId,
      preferredSource: input.preferredSource ?? 'auto',
      anchors,
    });
    const markdown = serviceTask.material?.markdown?.trim();
    if (!markdown) {
      throw new BadRequestError('录音处理服务未返回可用资料包 Markdown');
    }
    assertProcessFilesExcluded(markdown);

    const materialPath = serviceTask.material?.path ?? current.materialPath;
    const materialSource = serviceTask.material?.source ?? current.materialSource;
    const updated = await this.options.repository.updateFromService({
      taskId: current.taskId,
      status: serviceTask.status,
      providerDataId: serviceTask.providerDataId,
      fixtureTaskId: serviceTask.fixtureTaskId,
      anchors,
      servicePayload: serviceTask as unknown as Record<string, unknown>,
      errorMessage: serviceTask.errorMessage,
      materialPath,
      materialSource,
    });

    const response = toRecordingTaskResponse(updated) as RecordingTaskMaterializeResponse;
    response.material = {
      ...(response.material ?? { available: true }),
      available: true,
      artifactId: updated.artifactId ?? undefined,
      path: materialPath,
      source: materialSource,
      markdown,
      excludedProcessFiles: serviceTask.material?.excludedProcessFiles ?? PROCESS_ONLY_FILE_NAMES,
    };
    return response;
  }

  async archiveTask(input: {
    taskId: string;
    customerId: string;
    opportunityId: string;
    followupId: string;
    createdBy?: string;
  }): Promise<RecordingTaskResponse> {
    const formalAnchors = normalizeAnchors({
      customer: input.customerId,
      opportunity: input.opportunityId,
      followup: input.followupId,
    });
    if (!formalAnchors.customer || !formalAnchors.opportunity || !formalAnchors.followup) {
      throw new BadRequestError('录音资料正式归档前必须绑定客户、商机和拜访记录');
    }

    const current = await this.refreshTaskRecord(await this.options.repository.getTask(input.taskId));
    if (current.status !== 'succeeded') {
      throw new BadRequestError('录音任务尚未完成，不能正式归档');
    }

    const serviceTask = await this.options.client.materialize({
      taskId: current.serviceTaskId,
      preferredSource: 'auto',
      anchors: formalAnchors,
    });
    const markdown = serviceTask.material?.markdown?.trim();
    if (!markdown) {
      throw new BadRequestError('录音处理服务未返回可用资料包 Markdown');
    }
    assertProcessFilesExcluded(markdown);

    const materialPath = serviceTask.material?.path ?? current.materialPath;
    const materialSource = serviceTask.material?.source ?? current.materialSource;
    const updated = await this.options.repository.updateFromService({
      taskId: current.taskId,
      status: serviceTask.status,
      providerDataId: serviceTask.providerDataId,
      fixtureTaskId: serviceTask.fixtureTaskId,
      anchors: formalAnchors,
      servicePayload: serviceTask as unknown as Record<string, unknown>,
      errorMessage: serviceTask.errorMessage,
      materialPath,
      materialSource,
    });

    const artifact = await this.options.artifactService.createRecordingMaterialArtifact({
      eid: updated.eid,
      appId: updated.appId,
      title: `${updated.file.fileName} 录音资料包`,
      markdown,
      sourceToolCode: RECORDING_MATERIAL_TOOL_CODE,
      anchors: buildRecordingArtifactAnchors(updated, formalAnchors, 'bound'),
      createdBy: input.createdBy?.trim() || updated.createdBy || 'assistant-web',
      summary: summarizeMarkdown(markdown),
      recordingTaskId: updated.taskId,
      providerDataId: updated.providerDataId,
      sourceFile: {
        name: updated.file.fileName,
        md5: updated.file.md5,
        mimeType: updated.file.mimeType,
        size: updated.file.size,
      },
    });

    const finalRecord = await this.options.repository.attachArtifact({
      taskId: updated.taskId,
      artifactId: artifact.artifact.artifactId,
      materialPath,
      materialSource,
      servicePayload: {
        ...(serviceTask as unknown as Record<string, unknown>),
        archivedArtifactId: artifact.artifact.artifactId,
        archivedFollowupId: formalAnchors.followup,
      },
    });
    return toRecordingTaskResponse(finalRecord);
  }

  async getMeetingViewerUrl(taskId: string): Promise<string> {
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    if (record.status !== 'succeeded') {
      throw new BadRequestError('录音任务尚未完成，不能打开录音查看页');
    }
    const viewerTaskId = resolveViewerTaskId(record);
    if (!viewerTaskId) {
      throw new BadRequestError('录音任务缺少通义任务标识，不能打开录音查看页');
    }
    return `${trimTrailingSlash(this.options.config.external.tongyiAudioService.baseUrl)}/meeting-viewer/?task=${encodeURIComponent(viewerTaskId)}`;
  }

  async createSkillJob(taskId: string, input: { skillCode?: string }): Promise<ExternalSkillJobResponse> {
    const skillCode = String(input.skillCode || '').trim();
    if (!isDownstreamRecordingSkillCode(skillCode)) {
      throw new BadRequestError('录音资料包只允许继续调用拜访会话理解、客户需求工作待办分析、问题陈述、客户价值定位');
    }
    if (!this.options.externalSkillService) {
      throw new ServiceUnavailableError('外部技能服务未启用');
    }

    let record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    if (record.status !== 'succeeded') {
      throw new BadRequestError('录音任务尚未完成，不能调用下游外部技能');
    }
    record = await this.ensureGeneratedMaterialForSkill(record);
    const attachments = resolveConsumableRecordingSkillAttachmentPaths(record);
    const label = DOWNSTREAM_RECORDING_SKILLS[skillCode];
    const job = await this.options.externalSkillService.createSkillJob(skillCode, {
      requestText: buildRecordingSkillRequestText(label, record),
      attachments,
    });
    return this.persistAnalysisMaterialIfFormal(record, skillCode, job);
  }

  async getSkillJob(taskId: string, skillCode: string, jobId: string): Promise<ExternalSkillJobResponse> {
    if (!isDownstreamRecordingSkillCode(skillCode)) {
      throw new BadRequestError('录音资料包只允许继续调用拜访会话理解、客户需求工作待办分析、问题陈述、客户价值定位');
    }
    if (!this.options.externalSkillService) {
      throw new ServiceUnavailableError('外部技能服务未启用');
    }
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    const job = await this.options.externalSkillService.getSkillJob(jobId);
    return this.persistAnalysisMaterialIfFormal(record, skillCode, job);
  }

  private async persistAnalysisMaterialIfFormal(
    record: RecordingTaskRecord,
    skillCode: DownstreamRecordingSkillCode,
    job: ExternalSkillJobResponse,
  ): Promise<ExternalSkillJobResponse> {
    if (job.status !== 'succeeded') {
      return job;
    }
    if (!record.artifactId || !record.anchors.customer || !record.anchors.opportunity || !record.anchors.followup) {
      return job;
    }
    if (!this.options.externalSkillService) {
      return job;
    }

    const markdown = await this.resolveSkillJobMarkdown(job);
    if (!markdown.trim()) {
      return job;
    }
    assertProcessFilesExcluded(markdown);

    const label = DOWNSTREAM_RECORDING_SKILLS[skillCode];
    await this.options.artifactService.createAnalysisMaterialArtifact({
      eid: record.eid,
      appId: record.appId,
      title: `${stripFileExtension(record.file.fileName)} - ${label}`,
      markdown,
      sourceToolCode: skillCode,
      anchors: buildRecordingArtifactAnchors(record, record.anchors, 'bound'),
      createdBy: record.createdBy || 'assistant-web',
      summary: summarizeMarkdown(markdown),
      recordingTaskId: record.taskId,
      skillCode,
      sourceJobId: job.jobId,
      sourceFile: {
        name: record.file.fileName,
        md5: record.file.md5,
        mimeType: record.file.mimeType,
        size: record.file.size,
      },
    });

    return job;
  }

  private async resolveSkillJobMarkdown(job: ExternalSkillJobResponse): Promise<string> {
    const markdownArtifact = job.artifacts.find((item) =>
      item.mimeType.toLowerCase().includes('markdown') || extname(item.fileName).toLowerCase() === '.md'
    );
    if (markdownArtifact && this.options.externalSkillService) {
      const { content } = await this.options.externalSkillService.getSkillJobArtifact(job.jobId, markdownArtifact.artifactId);
      return content.toString('utf8');
    }
    return job.finalText ?? '';
  }

  private async refreshTaskRecord(record: RecordingTaskRecord): Promise<RecordingTaskRecord> {
    let serviceTask: TongyiAudioServiceTask;
    try {
      serviceTask = await this.options.client.getTask(record.serviceTaskId);
    } catch {
      return record;
    }

    return this.options.repository.updateFromService({
      taskId: record.taskId,
      status: serviceTask.status,
      providerDataId: serviceTask.providerDataId,
      fixtureTaskId: serviceTask.fixtureTaskId,
      anchors: serviceTask.anchors,
      servicePayload: serviceTask as unknown as Record<string, unknown>,
      errorMessage: serviceTask.errorMessage,
      materialPath: serviceTask.material?.path,
      materialSource: serviceTask.material?.source,
    });
  }

  private async reuseExistingTask(record: RecordingTaskRecord): Promise<RecordingTaskRecord> {
    if (record.status === 'succeeded' && record.artifactId) {
      return record;
    }
    return this.refreshTaskRecord(record);
  }

  private async ensureGeneratedMaterialForSkill(record: RecordingTaskRecord): Promise<RecordingTaskRecord> {
    try {
      const serviceTask = await this.options.client.materialize({
        taskId: record.serviceTaskId,
        preferredSource: 'generated',
        anchors: record.anchors,
      });
      const markdown = serviceTask.material?.markdown?.trim();
      if (markdown) {
        assertProcessFilesExcluded(markdown);
      }
      return this.options.repository.updateFromService({
        taskId: record.taskId,
        status: serviceTask.status,
        providerDataId: serviceTask.providerDataId,
        fixtureTaskId: serviceTask.fixtureTaskId,
        anchors: serviceTask.anchors,
        servicePayload: serviceTask as unknown as Record<string, unknown>,
        errorMessage: serviceTask.errorMessage,
        materialPath: serviceTask.material?.path,
        materialSource: serviceTask.material?.source,
      });
    } catch {
      return record;
    }
  }

  private normalizeCreateInput(input: RecordingTaskCreateRequest): Required<Pick<RecordingTaskCreateRequest, 'eid' | 'appId' | 'createdBy' | 'anchors'>> &
    Omit<RecordingTaskCreateRequest, 'eid' | 'appId' | 'createdBy' | 'anchors'> {
    return {
      ...input,
      eid: input.eid?.trim() || this.options.config.yzj.eid,
      appId: input.appId?.trim() || this.options.config.yzj.appId,
      anchors: normalizeAnchors(input.anchors),
      createdBy: input.createdBy?.trim() || 'assistant-web',
    };
  }
}

function readServiceFile(
  task: TongyiAudioServiceTask,
  fallback: RecordingTaskRecord['file'],
): RecordingTaskRecord['file'] {
  return {
    fileName: task.file?.fileName || fallback.fileName,
    mimeType: task.file?.mimeType || fallback.mimeType,
    size: Number(task.file?.size ?? fallback.size),
    md5: task.file?.md5 || task.file?.sha256 || fallback.md5,
  };
}

function normalizeAnchors(input?: RecordingAnchorInput): RecordingAnchorInput {
  const anchors: RecordingAnchorInput = {};
  for (const key of ['customer', 'opportunity', 'followup'] as const) {
    const value = input?.[key]?.trim();
    if (value) {
      anchors[key] = value;
    }
  }
  return anchors;
}

function buildRecordingArtifactAnchors(
  record: RecordingTaskRecord,
  anchors: RecordingAnchorInput,
  bindingStatus: ArtifactAnchor['bindingStatus'] = 'suggested',
): ArtifactAnchor[] {
  const result: ArtifactAnchor[] = [
    {
      type: 'source_file',
      id: record.file.md5,
      name: record.file.fileName,
      role: 'source',
    },
  ];
  for (const [type, value] of Object.entries(anchors) as Array<[keyof RecordingAnchorInput, string]>) {
    result.push({
      type,
      id: value,
      name: value,
      role: type === 'customer' ? 'primary' : 'related',
      bindingStatus,
    });
  }
  return result;
}

function stripFileExtension(fileName: string): string {
  const ext = extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function summarizeMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

function assertProcessFilesExcluded(markdown: string): void {
  const leakedFile = PROCESS_ONLY_FILE_NAMES.find((fileName) => markdown.includes(fileName));
  if (leakedFile) {
    throw new BadRequestError(`录音资料包包含过程文件名，已阻止保存: ${leakedFile}`);
  }
}

function isDownstreamRecordingSkillCode(skillCode: string): skillCode is keyof typeof DOWNSTREAM_RECORDING_SKILLS {
  return Object.prototype.hasOwnProperty.call(DOWNSTREAM_RECORDING_SKILLS, skillCode);
}

function resolveConsumableRecordingMaterialPath(record: RecordingTaskRecord): string {
  const materialPath = record.materialPath?.trim();
  if (!materialPath) {
    throw new BadRequestError('录音资料包尚未生成，不能调用下游外部技能');
  }
  const normalizedPath = resolve(materialPath);
  const fileName = basename(normalizedPath);
  const parentName = basename(dirname(normalizedPath));
  const isRecordingMaterial = fileName === 'recording-material.md';
  const isProfileMarkdown = parentName === 'profile-analysis' && extname(normalizedPath).toLowerCase() === '.md';
  if (!isRecordingMaterial && !isProfileMarkdown) {
    throw new BadRequestError('录音下游技能只能消费通义结构化分析 JSON、recording-material.md 或 profile-analysis/*.md');
  }
  if (PROCESS_ONLY_FILE_NAMES.includes(fileName)) {
    throw new BadRequestError(`过程文件不能作为下游技能输入: ${fileName}`);
  }
  const stat = statSync(normalizedPath, { throwIfNoEntry: false });
  if (!stat) {
    throw new BadRequestError('录音资料包文件不存在，请重新生成资料包');
  }
  if (!stat.isFile()) {
    throw new BadRequestError('录音资料包路径不是文件，请重新生成资料包');
  }
  return normalizedPath;
}

function resolveConsumableRecordingSkillAttachmentPaths(record: RecordingTaskRecord): string[] {
  const materialPath = resolveConsumableRecordingMaterialPath(record);
  const taskDir = resolveRecordingTaskDirFromMaterialPath(materialPath);
  const structuredPaths = resolveStructuredAnalysisAttachmentPaths(taskDir);
  const profileMarkdownPaths = resolveProfileMarkdownAttachmentPaths(taskDir);
  const attachments = uniquePaths([
    ...structuredPaths,
    materialPath,
    ...profileMarkdownPaths,
  ]);
  const leakedPath = attachments.find((item) => PROCESS_ONLY_FILE_NAMES.includes(basename(item)));
  if (leakedPath) {
    throw new BadRequestError(`过程文件不能作为下游技能输入: ${basename(leakedPath)}`);
  }
  if (!structuredPaths.length && !profileMarkdownPaths.length && !hasMeaningfulMarkdownMaterial(materialPath)) {
    throw new BadRequestError('录音任务缺少可供下游技能消费的通义结构化分析文件，请使用包含 mindMapSummary/summarization/meetingAssistance/autoChapters 的任务或重新处理录音');
  }
  return attachments;
}

function resolveRecordingTaskDirFromMaterialPath(materialPath: string): string {
  const normalizedPath = resolve(materialPath);
  if (basename(dirname(normalizedPath)) === 'profile-analysis') {
    return dirname(dirname(normalizedPath));
  }
  return dirname(normalizedPath);
}

function resolveStructuredAnalysisAttachmentPaths(taskDir: string): string[] {
  const assetsDir = resolve(taskDir, 'assets');
  const stat = statSync(assetsDir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    return [];
  }
  return STRUCTURED_ANALYSIS_FILE_NAMES
    .map((fileName) => resolve(assetsDir, fileName))
    .filter((filePath) => statSync(filePath, { throwIfNoEntry: false })?.isFile());
}

function resolveProfileMarkdownAttachmentPaths(taskDir: string): string[] {
  const profileDir = resolve(taskDir, 'profile-analysis');
  const stat = statSync(profileDir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    return [];
  }
  return readdirSync(profileDir)
    .filter((fileName) => extname(fileName).toLowerCase() === '.md')
    .sort()
    .map((fileName) => resolve(profileDir, fileName))
    .filter((filePath) => statSync(filePath, { throwIfNoEntry: false })?.isFile());
}

function hasMeaningfulMarkdownMaterial(materialPath: string): boolean {
  let markdown = '';
  try {
    markdown = readFileSync(materialPath, 'utf8').trim();
  } catch {
    return false;
  }
  if (!markdown) {
    return false;
  }
  const emptyMarkers = [
    '暂无可用会话摘要。',
    '暂无可用主题。',
    '暂无可用关键词。',
    '暂无可用章节。',
  ];
  return emptyMarkers.some((marker) => !markdown.includes(marker));
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((item) => resolve(item))));
}

function buildRecordingSkillRequestText(label: string, record: RecordingTaskRecord): string {
  const anchors = [
    record.anchors.customer ? `客户：${record.anchors.customer}` : '',
    record.anchors.opportunity ? `商机：${record.anchors.opportunity}` : '',
    record.anchors.followup ? `跟进记录：${record.anchors.followup}` : '',
  ].filter(Boolean);
  return [
    `请执行「${label}」。`,
    `输入材料是附件中的通义结构化录音分析文件和录音资料包，来源录音文件：${record.file.fileName}。`,
    anchors.length ? `建议关联上下文：${anchors.join('；')}。` : '当前录音未绑定客户/商机，请仅基于资料包内容输出分析结论。',
    '必须优先读取附件中的通义结构化分析 JSON（mindMapSummary.json、summarization.json、meetingAssistance.json、autoChapters.json），再参考 recording-material.md 或 profile-analysis/*.md，并据此抽取具体需求、待办和风险；只有附件确实没有对应内容时，才标记为待澄清。',
    '只读取“可用输入文件”清单中的具体附件；不要读取 transcription.json、translations.json、textPolish.json、task-result.json、create-task.json、summary.txt 等原始过程文件。',
    '请输出结构化 Markdown，并保留可继续被后续拜访分析能力消费的标题层级。',
  ].join('\n');
}

function resolveViewerTaskId(record: RecordingTaskRecord): string {
  if (record.fixtureTaskId) {
    return record.fixtureTaskId;
  }
  const materialPath = record.materialPath?.trim();
  if (materialPath) {
    const taskDir = dirname(resolve(materialPath));
    try {
      if (statSync(resolve(taskDir, 'assets'), { throwIfNoEntry: false })?.isDirectory()) {
        return basename(taskDir);
      }
    } catch {
      // Fall back to providerDataId below.
    }
  }
  return record.providerDataId || '';
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
