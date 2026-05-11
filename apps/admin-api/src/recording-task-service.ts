import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
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
import { resolveAgentIsolationTenant } from './tenant-isolation.js';

const RECORDING_MATERIAL_TOOL_CODE = 'tongyi.audio.recording_material';
const DOWNSTREAM_RECORDING_SKILLS = {
  'ext.visit_conversation_understanding': '拜访会话理解',
  'ext.customer_needs_todo_analysis': '客户需求工作待办分析',
  'ext.customer_value_positioning_pm': '客户价值定位',
} as const;

const CORE_ANALYSIS_JOB_WAIT_TIMEOUT_MS = 180_000;
const CORE_ANALYSIS_JOB_POLL_INTERVAL_MS = 1_000;
type DownstreamRecordingSkillCode = keyof typeof DOWNSTREAM_RECORDING_SKILLS;
type FormalRecordingAnchors = Required<Pick<RecordingAnchorInput, 'customer' | 'opportunity' | 'followup'>>;
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
const STALE_UNBOUND_CONTEXT_PATTERN = /(未关联客户\/商机|未关联客户|未关联商机|录音未绑定|未绑定客户\/商机|录音未绑定客户\/商机)/;

interface PendingArchivePayload {
  customerId: string;
  opportunityId: string;
  followupId: string;
  createdBy: string;
  requestedAt: string;
}

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
    const { eid, appId } = resolveAgentIsolationTenant(this.options.config, { eid: input.eid });
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
      servicePayload: mergeServicePayload(current.servicePayload, serviceTask as unknown as Record<string, unknown>),
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
    const formalAnchors = normalizeFormalArchiveAnchors({
      customer: input.customerId,
      opportunity: input.opportunityId,
      followup: input.followupId,
    });

    const current = await this.refreshTaskRecord(await this.options.repository.getTask(input.taskId));
    if (current.status !== 'succeeded') {
      throw new BadRequestError('录音任务尚未完成，不能正式归档');
    }

    const archived = await this.archiveSucceededTask({
      record: current,
      formalAnchors,
      createdBy: input.createdBy,
    });
    await this.rerunCompletedSkillJobsSafely(archived);
    return toRecordingTaskResponse(archived);
  }

  async requestArchiveTask(input: {
    taskId: string;
    customerId: string;
    opportunityId: string;
    followupId: string;
    createdBy?: string;
  }): Promise<RecordingTaskResponse> {
    const formalAnchors = normalizeFormalArchiveAnchors({
      customer: input.customerId,
      opportunity: input.opportunityId,
      followup: input.followupId,
    });

    const current = await this.refreshTaskRecord(await this.options.repository.getTask(input.taskId));
    if (current.artifactId && current.anchors.followup === formalAnchors.followup) {
      await this.ensureLinkedAnalysisMaterials(current);
      return toRecordingTaskResponse(current);
    }
    if (current.status === 'succeeded') {
      const archived = await this.archiveSucceededTask({
        record: current,
        formalAnchors,
        createdBy: input.createdBy,
      });
      await this.rerunCompletedSkillJobsSafely(archived);
      return toRecordingTaskResponse(archived);
    }

    const pendingArchive: PendingArchivePayload = {
      customerId: formalAnchors.customer,
      opportunityId: formalAnchors.opportunity,
      followupId: formalAnchors.followup,
      createdBy: input.createdBy?.trim() || current.createdBy || 'assistant-web',
      requestedAt: new Date().toISOString(),
    };
    const updated = await this.options.repository.updateFromService({
      taskId: current.taskId,
      status: current.status,
      providerDataId: current.providerDataId,
      fixtureTaskId: current.fixtureTaskId,
      anchors: formalAnchors,
      servicePayload: mergeServicePayload(current.servicePayload, {
        pendingArchive,
      }),
      errorMessage: current.errorMessage,
      materialPath: current.materialPath,
      materialSource: current.materialSource,
    });
    return toRecordingTaskResponse(updated);
  }

  private async archiveSucceededTask(input: {
    record: RecordingTaskRecord;
    formalAnchors: FormalRecordingAnchors;
    createdBy?: string;
  }): Promise<RecordingTaskRecord> {
    const current = input.record;
    const formalAnchors = input.formalAnchors;
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
      servicePayload: mergeServicePayload(current.servicePayload, serviceTask as unknown as Record<string, unknown>),
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
      servicePayload: removePendingArchive({
        ...mergeServicePayload(updated.servicePayload, serviceTask as unknown as Record<string, unknown>),
        archivedArtifactId: artifact.artifact.artifactId,
        archivedFollowupId: formalAnchors.followup,
      }),
    });
    return finalRecord;
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
    return `${trimTrailingSlash(this.options.config.external.tongyiAudioService.publicBaseUrl)}/meeting-viewer/?task=${encodeURIComponent(viewerTaskId)}`;
  }

  async createSkillJob(taskId: string, input: { skillCode?: string }): Promise<ExternalSkillJobResponse> {
    const skillCode = String(input.skillCode || '').trim();
    if (!isDownstreamRecordingSkillCode(skillCode)) {
      throw new BadRequestError('录音资料包只允许继续调用拜访会话理解、客户需求工作待办分析、客户价值定位');
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
      throw new BadRequestError('录音资料包只允许继续调用拜访会话理解、客户需求工作待办分析、客户价值定位');
    }
    if (!this.options.externalSkillService) {
      throw new ServiceUnavailableError('外部技能服务未启用');
    }
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    const job = await this.options.externalSkillService.getSkillJob(jobId);
    return this.persistAnalysisMaterialIfFormal(record, skillCode, job);
  }

  async archiveCompletedSkillJobs(taskId: string): Promise<number> {
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    if (!record.artifactId || !record.anchors.customer || !record.anchors.opportunity || !record.anchors.followup) {
      return 0;
    }

    const jobs = await this.findCompletedSkillJobsForTask(record);
    let archivedCount = 0;
    for (const job of jobs) {
      const persisted = await this.persistAnalysisMaterialIfFormal(record, job.skillCode, job);
      if (persisted.status === 'succeeded') {
        archivedCount += 1;
      }
    }
    return archivedCount;
  }

  async ensureCoreAnalysisMaterials(taskId: string): Promise<number> {
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    return this.ensureAnalysisMaterialsForRecord(record, [
      'ext.visit_conversation_understanding',
      'ext.customer_needs_todo_analysis',
    ]);
  }

  async rerunCompletedSkillJobs(taskId: string): Promise<number> {
    const record = await this.refreshTaskRecord(await this.options.repository.getTask(taskId));
    return this.rerunCompletedSkillJobsForRecord(record);
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
    const markdown = await this.resolveSkillJobMarkdown(job);
    if (!markdown.trim()) {
      return job;
    }
    assertProcessFilesExcluded(markdown);
    if (hasStaleUnboundContextMarkdown(markdown)) {
      throw new BadRequestError('下游分析仍包含未关联客户/商机等旧上下文文案，已阻止保存，请使用正式客户、商机、跟进记录上下文重跑分析');
    }

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

  private async findCompletedSkillJobsForTask(record: RecordingTaskRecord): Promise<Array<ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }>> {
    const sourceSignals = buildRecordingJobSourceSignals(record);
    const jobs: Array<ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }> = [];
    const seen = new Set<DownstreamRecordingSkillCode>();

    for (const remoteJob of await this.findCompletedRemoteSkillJobsForTask(sourceSignals)) {
      if (seen.has(remoteJob.skillCode)) {
        continue;
      }
      jobs.push(remoteJob);
      seen.add(remoteJob.skillCode);
    }

    const runtimeSqlitePath = resolve(dirname(this.options.config.meta.envFilePath), '.local/skill-runtime.sqlite');
    let rows: Array<{ job_id: string; skill_name: string; request_text: string; status: string }> = [];
    try {
      const { DatabaseSync } = await import('node:sqlite');
      const database = new DatabaseSync(runtimeSqlitePath, { readOnly: true });
      try {
        rows = database.prepare(`
          SELECT job_id, skill_name, request_text, status
          FROM jobs
          WHERE status = 'succeeded'
          ORDER BY updated_at DESC
        `).all() as Array<{ job_id: string; skill_name: string; request_text: string; status: string }>;
      } finally {
        database.close();
      }
    } catch {
      rows = [];
    }

    const candidates = rows.filter((row) => {
      const skillCode = runtimeSkillNameToDownstreamSkillCode(row.skill_name);
      return skillCode
        && sourceSignals.some((signal) => row.request_text.includes(signal));
    });

    for (const candidate of candidates) {
      const skillCode = runtimeSkillNameToDownstreamSkillCode(candidate.skill_name);
      if (!skillCode || seen.has(skillCode)) {
        continue;
      }
      try {
        const job = this.options.externalSkillService
          ? await this.options.externalSkillService.getSkillJob(candidate.job_id)
          : null;
        if (job?.status === 'succeeded' && job.skillCode === skillCode) {
          const markdown = await this.resolveSkillJobMarkdown(job);
          jobs.push({
            ...job,
            finalText: markdown || job.finalText,
            artifacts: markdown ? [] : job.artifacts,
            skillCode,
          });
          seen.add(skillCode);
        }
      } catch {
        const artifactJob = this.resolveArchivedSkillRuntimeArtifact(candidate.job_id, candidate.skill_name);
        if (artifactJob?.status === 'succeeded') {
          jobs.push({ ...artifactJob, skillCode });
          seen.add(skillCode);
        }
      }
    }

    for (const artifactJob of this.findCompletedSkillRuntimeArtifactJobsForTask(record)) {
      if (seen.has(artifactJob.skillCode)) {
        continue;
      }
      jobs.push(artifactJob);
      seen.add(artifactJob.skillCode);
    }
    return jobs;
  }

  private async findCompletedRemoteSkillJobsForTask(
    sourceSignals: string[],
  ): Promise<Array<ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }>> {
    if (!this.options.externalSkillService || typeof this.options.externalSkillService.listSkillJobs !== 'function') {
      return [];
    }

    const jobs: Array<ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }> = [];
    const seen = new Set<DownstreamRecordingSkillCode>();
    for (const signal of sourceSignals) {
      let result: { jobs: ExternalSkillJobResponse[] } | null = null;
      try {
        result = await this.options.externalSkillService.listSkillJobs({
          status: 'succeeded',
          query: signal,
          pageSize: 25,
        });
      } catch {
        continue;
      }
      for (const job of result.jobs) {
        const skillCode = job.skillCode;
        if (!isDownstreamRecordingSkillCode(skillCode) || seen.has(skillCode)) {
          continue;
        }
        jobs.push({ ...job, skillCode });
        seen.add(skillCode);
      }
    }
    return jobs;
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

  private findCompletedSkillRuntimeArtifactJobsForTask(
    record: RecordingTaskRecord,
  ): Array<ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }> {
    const artifactRoot = resolve(dirname(this.options.config.meta.envFilePath), '.local/skill-runtime-artifacts');
    const stat = statSync(artifactRoot, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      return [];
    }

    const sourceSignals = buildRecordingJobSourceSignals(record);
    const jobs: Array<ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }> = [];

    for (const jobId of readdirSync(artifactRoot).sort()) {
      const jobDir = join(artifactRoot, jobId);
      const jobStat = statSync(jobDir, { throwIfNoEntry: false });
      if (!jobStat?.isDirectory() || jobId === '_jobs') {
        continue;
      }
      for (const fileName of readdirSync(jobDir).sort()) {
        const filePath = join(jobDir, fileName);
        const fileStat = statSync(filePath, { throwIfNoEntry: false });
        if (!fileStat?.isFile() || extname(fileName).toLowerCase() !== '.md') {
          continue;
        }
        const runtimeSkillName = parseRuntimeSkillNameFromArtifactFileName(fileName, jobId);
        const skillCode = runtimeSkillNameToDownstreamSkillCode(runtimeSkillName);
        if (!skillCode) {
          continue;
        }
        const markdown = readFileSync(filePath, 'utf8');
        const inputText = readArchivedSkillRuntimeJobInputText(artifactRoot, jobId);
        const searchText = `${inputText}\n${markdown}`;
        if (!sourceSignals.some((signal) => searchText.includes(signal))) {
          continue;
        }
        jobs.push(buildRecoveredSkillJob({
          jobId,
          runtimeSkillName,
          skillCode,
          markdown,
          fileName,
          fileStat,
        }));
      }
    }

    return jobs;
  }

  private resolveArchivedSkillRuntimeArtifact(
    jobId: string,
    runtimeSkillName: string,
  ): (ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode }) | null {
    const skillCode = runtimeSkillNameToDownstreamSkillCode(runtimeSkillName);
    if (!skillCode) {
      return null;
    }
    const artifactRoot = resolve(dirname(this.options.config.meta.envFilePath), '.local/skill-runtime-artifacts');
    const jobDir = join(artifactRoot, jobId);
    const stat = statSync(jobDir, { throwIfNoEntry: false });
    if (!stat?.isDirectory()) {
      return null;
    }
    for (const fileName of readdirSync(jobDir).sort()) {
      const filePath = join(jobDir, fileName);
      const fileStat = statSync(filePath, { throwIfNoEntry: false });
      if (!fileStat?.isFile() || extname(fileName).toLowerCase() !== '.md') {
        continue;
      }
      if (parseRuntimeSkillNameFromArtifactFileName(fileName, jobId) !== runtimeSkillName) {
        continue;
      }
      return buildRecoveredSkillJob({
        jobId,
        runtimeSkillName,
        skillCode,
        markdown: readFileSync(filePath, 'utf8'),
        fileName,
        fileStat,
      });
    }
    return null;
  }

  private async refreshTaskRecord(record: RecordingTaskRecord): Promise<RecordingTaskRecord> {
    let serviceTask: TongyiAudioServiceTask;
    try {
      serviceTask = await this.options.client.getTask(record.serviceTaskId);
    } catch {
      return this.tryCompletePendingArchive(record);
    }

    const refreshed = await this.options.repository.updateFromService({
      taskId: record.taskId,
      status: serviceTask.status,
      providerDataId: serviceTask.providerDataId,
      fixtureTaskId: serviceTask.fixtureTaskId,
      anchors: serviceTask.anchors,
      servicePayload: mergeServicePayload(record.servicePayload, serviceTask as unknown as Record<string, unknown>),
      errorMessage: serviceTask.errorMessage,
      materialPath: serviceTask.material?.path,
      materialSource: serviceTask.material?.source,
    });
    return this.tryCompletePendingArchive(refreshed);
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
        servicePayload: mergeServicePayload(record.servicePayload, serviceTask as unknown as Record<string, unknown>),
        errorMessage: serviceTask.errorMessage,
        materialPath: serviceTask.material?.path,
        materialSource: serviceTask.material?.source,
      });
    } catch {
      return record;
    }
  }

  private async tryCompletePendingArchive(record: RecordingTaskRecord): Promise<RecordingTaskRecord> {
    const pendingArchive = readPendingArchivePayload(record.servicePayload.pendingArchive);
    if (!pendingArchive || record.artifactId || record.status !== 'succeeded') {
      return record;
    }
    const formalAnchors = normalizeAnchors({
      customer: pendingArchive.customerId,
      opportunity: pendingArchive.opportunityId,
      followup: pendingArchive.followupId,
    });
    if (!formalAnchors.customer || !formalAnchors.opportunity || !formalAnchors.followup) {
      return record;
    }
    const completeFormalAnchors: FormalRecordingAnchors = {
      customer: formalAnchors.customer,
      opportunity: formalAnchors.opportunity,
      followup: formalAnchors.followup,
    };
    const archived = await this.archiveSucceededTask({
      record: {
        ...record,
        anchors: { ...record.anchors, ...completeFormalAnchors },
      },
      formalAnchors: completeFormalAnchors,
      createdBy: pendingArchive.createdBy,
    });
    await this.rerunCompletedSkillJobsSafely(archived);
    return archived;
  }

  private async rerunCompletedSkillJobsSafely(record: RecordingTaskRecord): Promise<number> {
    try {
      return await this.rerunCompletedSkillJobsForRecord(record);
    } catch {
      return 0;
    }
  }

  private async ensureLinkedAnalysisMaterials(record: RecordingTaskRecord): Promise<number> {
    if (!record.artifactId || !record.anchors.customer || !record.anchors.opportunity || !record.anchors.followup) {
      return 0;
    }
    const rerunCount = await this.rerunCompletedSkillJobsSafely(record);
    if (rerunCount > 0) {
      return rerunCount;
    }
    try {
      return await this.ensureCoreAnalysisMaterials(record.taskId);
    } catch {
      return 0;
    }
  }

  private async rerunCompletedSkillJobsForRecord(record: RecordingTaskRecord): Promise<number> {
    if (!this.options.externalSkillService) {
      return 0;
    }
    if (!record.artifactId || !record.anchors.customer || !record.anchors.opportunity || !record.anchors.followup) {
      return 0;
    }
    const jobs = await this.findCompletedSkillJobsForTask(record);
    const skillCodes = Array.from(new Set(jobs.map((job) => job.skillCode)));
    if (!skillCodes.length) {
      return 0;
    }
    const materialRecord = await this.ensureGeneratedMaterialForSkill(record);
    if (!materialRecord.artifactId) {
      materialRecord.artifactId = record.artifactId;
    }
    materialRecord.anchors = record.anchors;
    const attachments = resolveConsumableRecordingSkillAttachmentPaths(materialRecord);
    let startedCount = 0;
    for (const skillCode of skillCodes) {
      const label = DOWNSTREAM_RECORDING_SKILLS[skillCode];
      const createdJob = await this.options.externalSkillService.createSkillJob(skillCode, {
        requestText: buildRecordingSkillRequestText(label, materialRecord),
        attachments,
      });
      const job = await this.waitForDownstreamSkillJob(createdJob);
      await this.persistAnalysisMaterialIfFormal(materialRecord, skillCode, job);
      if (job.status === 'succeeded') {
        startedCount += 1;
      }
    }
    return startedCount;
  }

  private async ensureAnalysisMaterialsForRecord(
    record: RecordingTaskRecord,
    skillCodes: DownstreamRecordingSkillCode[],
  ): Promise<number> {
    if (!this.options.externalSkillService) {
      return 0;
    }
    if (!record.artifactId || !record.anchors.customer || !record.anchors.opportunity || !record.anchors.followup) {
      return 0;
    }

    const materialRecord = await this.ensureGeneratedMaterialForSkill(record);
    if (!materialRecord.artifactId) {
      materialRecord.artifactId = record.artifactId;
    }
    materialRecord.anchors = record.anchors;
    const attachments = resolveConsumableRecordingSkillAttachmentPaths(materialRecord);
    let completedCount = 0;
    for (const skillCode of Array.from(new Set(skillCodes))) {
      const label = DOWNSTREAM_RECORDING_SKILLS[skillCode];
      const createdJob = await this.options.externalSkillService.createSkillJob(skillCode, {
        requestText: buildRecordingSkillRequestText(label, materialRecord),
        attachments,
      });
      const job = await this.waitForDownstreamSkillJob(createdJob);
      await this.persistAnalysisMaterialIfFormal(materialRecord, skillCode, job);
      if (job.status === 'succeeded') {
        completedCount += 1;
      }
    }
    return completedCount;
  }

  private async waitForDownstreamSkillJob(job: ExternalSkillJobResponse): Promise<ExternalSkillJobResponse> {
    if (!this.options.externalSkillService || job.status === 'succeeded' || job.status === 'failed') {
      return job;
    }
    const deadline = Date.now() + CORE_ANALYSIS_JOB_WAIT_TIMEOUT_MS;
    let latest = job;
    while (Date.now() < deadline) {
      await sleep(CORE_ANALYSIS_JOB_POLL_INTERVAL_MS);
      latest = await this.options.externalSkillService.getSkillJob(job.jobId);
      if (latest.status === 'succeeded' || latest.status === 'failed') {
        return latest;
      }
    }
    return latest;
  }

  private normalizeCreateInput(input: RecordingTaskCreateRequest): Required<Pick<RecordingTaskCreateRequest, 'eid' | 'appId' | 'createdBy' | 'anchors'>> &
    Omit<RecordingTaskCreateRequest, 'eid' | 'appId' | 'createdBy' | 'anchors'> {
    return {
      ...input,
      ...resolveAgentIsolationTenant(this.options.config, { eid: input.eid }),
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

function normalizeFormalArchiveAnchors(input: {
  customer?: string;
  opportunity?: string;
  followup?: string;
}): FormalRecordingAnchors {
  const anchors = normalizeAnchors(input);
  if (!anchors.customer || !anchors.opportunity || !anchors.followup) {
    throw new BadRequestError('录音资料正式归档前必须绑定客户、商机和拜访记录');
  }
  return {
    customer: anchors.customer,
    opportunity: anchors.opportunity,
    followup: anchors.followup,
  };
}

function mergeServicePayload(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...previous, ...next };
  if (previous.pendingArchive && !next.pendingArchive) {
    merged.pendingArchive = previous.pendingArchive;
  }
  return merged;
}

function removePendingArchive(payload: Record<string, unknown>): Record<string, unknown> {
  const { pendingArchive: _pendingArchive, ...rest } = payload;
  return rest;
}

function readPendingArchivePayload(value: unknown): PendingArchivePayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const payload = value as Record<string, unknown>;
  const customerId = readPayloadString(payload.customerId);
  const opportunityId = readPayloadString(payload.opportunityId);
  const followupId = readPayloadString(payload.followupId);
  if (!customerId || !opportunityId || !followupId) {
    return null;
  }
  return {
    customerId,
    opportunityId,
    followupId,
    createdBy: readPayloadString(payload.createdBy) || 'assistant-web',
    requestedAt: readPayloadString(payload.requestedAt) || new Date(0).toISOString(),
  };
}

function readPayloadString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function hasStaleUnboundContextMarkdown(markdown: string): boolean {
  const head = markdown
    .split(/\r?\n/)
    .slice(0, 24)
    .join('\n');
  return STALE_UNBOUND_CONTEXT_PATTERN.test(head);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function buildRecordingJobSourceSignals(record: RecordingTaskRecord): string[] {
  return [
    record.taskId,
    record.serviceTaskId,
    record.providerDataId ?? '',
    record.file.fileName,
    record.file.md5,
    record.anchors.customer ?? '',
    record.anchors.opportunity ?? '',
    record.anchors.followup ?? '',
  ].filter((item): item is string => Boolean(item));
}

function isDownstreamRecordingSkillCode(skillCode: string): skillCode is keyof typeof DOWNSTREAM_RECORDING_SKILLS {
  return Object.prototype.hasOwnProperty.call(DOWNSTREAM_RECORDING_SKILLS, skillCode);
}

function runtimeSkillNameToDownstreamSkillCode(skillName: string): DownstreamRecordingSkillCode | null {
  switch (skillName) {
    case 'visit-conversation-understanding':
      return 'ext.visit_conversation_understanding';
    case 'customer-needs-todo-analysis':
      return 'ext.customer_needs_todo_analysis';
    case 'customer-value-positioning':
      return 'ext.customer_value_positioning_pm';
    default:
      return null;
  }
}

function parseRuntimeSkillNameFromArtifactFileName(fileName: string, jobId: string): string {
  const suffix = `-${jobId}.md`;
  return fileName.endsWith(suffix)
    ? fileName.slice(0, -suffix.length)
    : fileName.replace(/\.md$/i, '');
}

function readArchivedSkillRuntimeJobInputText(artifactRoot: string, jobId: string): string {
  const inputsDir = join(artifactRoot, '_jobs', jobId, 'inputs');
  const stat = statSync(inputsDir, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    return '';
  }
  return readdirSync(inputsDir)
    .sort()
    .map((fileName) => {
      const filePath = join(inputsDir, fileName);
      const fileStat = statSync(filePath, { throwIfNoEntry: false });
      return fileStat?.isFile()
        ? readFileSync(filePath, 'utf8')
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

function buildRecoveredSkillJob(input: {
  jobId: string;
  runtimeSkillName: string;
  skillCode: DownstreamRecordingSkillCode;
  markdown: string;
  fileName: string;
  fileStat: { size: number; mtime?: Date; birthtime?: Date };
}): ExternalSkillJobResponse & { skillCode: DownstreamRecordingSkillCode } {
  const updatedAt = (input.fileStat.mtime ?? new Date()).toISOString();
  const createdAt = (input.fileStat.birthtime ?? input.fileStat.mtime ?? new Date()).toISOString();
  return {
    jobId: input.jobId,
    skillCode: input.skillCode,
    runtimeSkillName: input.runtimeSkillName,
    model: null,
    status: 'succeeded',
    finalText: input.markdown,
    events: [],
    artifacts: [
      {
        artifactId: input.fileName,
        jobId: input.jobId,
        fileName: input.fileName,
        mimeType: 'text/markdown',
        byteSize: input.fileStat.size,
        createdAt,
        downloadPath: '',
      },
    ],
    error: null,
    createdAt,
    updatedAt,
  };
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
  const hasFormalContext = Boolean(record.anchors.customer && record.anchors.opportunity && record.anchors.followup);
  return [
    `请执行「${label}」。`,
    `输入材料是附件中的通义结构化录音分析文件和录音资料包，来源录音文件：${record.file.fileName}。`,
    hasFormalContext
      ? '本次录音已完成正式客户、商机和跟进记录绑定；这些绑定只用于归档关系，不要在 Markdown 标题或正文中输出内部记录 ID。客户名、商机名等可展示信息请以附件资料包内容为准。'
      : '当前录音未绑定完整客户、商机和跟进记录，请仅基于资料包内容输出分析结论。',
    hasFormalContext
      ? '本次请求已提供正式客户、商机和跟进记录锚点；Markdown 标题和正文不得输出“未关联客户/商机”“未关联商机”“录音未绑定”等旧上下文描述。'
      : '如缺少正式客户或商机锚点，请在标题和结论中明确标记为待绑定上下文。',
    '必须优先读取附件中的通义结构化分析 JSON（mindMapSummary.json、summarization.json、meetingAssistance.json、autoChapters.json），再参考 recording-material.md 或 profile-analysis/*.md，并据此抽取具体需求、待办和风险；只有附件确实没有对应内容时，才标记为待澄清。',
    '只读取“可用输入文件”清单中的具体附件；不要读取 transcription.json、translations.json、textPolish.json、task-result.json、create-task.json、summary.txt 等原始过程文件。',
    '请输出结构化 Markdown，并保留可继续被后续拜访分析能力消费的标题层级。',
  ].join('\n');
}

function resolveViewerTaskId(record: RecordingTaskRecord): string {
  if (record.fixtureTaskId) {
    return record.fixtureTaskId;
  }
  const materialTaskId = resolveViewerTaskIdFromKnownOutputPath(record.materialPath);
  if (materialTaskId) {
    return materialTaskId;
  }
  const playbackTaskId = resolveViewerTaskIdFromKnownOutputPath(readPlaybackPath(record.servicePayload));
  if (playbackTaskId) {
    return playbackTaskId;
  }
  const uploadTaskId = resolveViewerTaskIdFromUploadPath(
    readServiceFileLocalPath(record.servicePayload),
    record.file.md5,
  );
  if (uploadTaskId) {
    return uploadTaskId;
  }
  return record.providerDataId || '';
}

function resolveViewerTaskIdFromKnownOutputPath(pathValue: string | null | undefined): string {
  const trimmedPath = pathValue?.trim();
  if (!trimmedPath) {
    return '';
  }
  const normalizedPath = resolve(trimmedPath);
  const parentDir = dirname(normalizedPath);
  const taskDir = ['assets', 'profile-analysis'].includes(basename(parentDir))
    ? dirname(parentDir)
    : parentDir;
  try {
    if (statSync(resolve(taskDir, 'assets'), { throwIfNoEntry: false })?.isDirectory()) {
      return basename(taskDir);
    }
  } catch {
    return '';
  }
  return '';
}

function resolveViewerTaskIdFromUploadPath(pathValue: string | null | undefined, md5: string): string {
  const trimmedPath = pathValue?.trim();
  const trimmedMd5 = md5.trim();
  if (!trimmedPath || !trimmedMd5) {
    return '';
  }
  const outputRoot = dirname(dirname(resolve(trimmedPath)));
  const taskDir = resolve(outputRoot, trimmedMd5);
  try {
    if (statSync(resolve(taskDir, 'assets'), { throwIfNoEntry: false })?.isDirectory()) {
      return basename(taskDir);
    }
  } catch {
    return '';
  }
  return '';
}

function readPlaybackPath(payload: Record<string, unknown>): string | null {
  const playback = payload.playback;
  if (!playback || typeof playback !== 'object') {
    return null;
  }
  return readPayloadString((playback as Record<string, unknown>).path) || null;
}

function readServiceFileLocalPath(payload: Record<string, unknown>): string | null {
  const file = payload.file;
  if (!file || typeof file !== 'object') {
    return null;
  }
  return readPayloadString((file as Record<string, unknown>).localPath) || null;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
