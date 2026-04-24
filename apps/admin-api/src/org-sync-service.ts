import { randomUUID } from 'node:crypto';
import type {
  AppConfig,
  ManualSyncStartResponse,
  OrgSyncSettingsResponse,
  OrgSyncRunSummary,
  SyncProgress,
  YzjEmployee,
} from './contracts.js';
import { getErrorMessage, SyncAlreadyRunningError } from './errors.js';
import { OrgSyncRepository } from './org-sync-repository.js';
import { YzjClient } from './yzj-client.js';

const PAGE_SIZE = 1000;

interface OrgSyncServiceOptions {
  config: AppConfig;
  repository: OrgSyncRepository;
  client: YzjClient;
  now?: () => Date;
}

export class OrgSyncService {
  private readonly config: AppConfig;
  private readonly repository: OrgSyncRepository;
  private readonly client: YzjClient;
  private readonly now: () => Date;
  private activeRunId: string | null = null;

  constructor(options: OrgSyncServiceOptions) {
    this.config = options.config;
    this.repository = options.repository;
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
  }

  getSettings(): OrgSyncSettingsResponse {
    const lastRun = this.repository.getLatestRun();
    const activeRun = this.activeRunId ? this.repository.getActiveRun() : null;

    return {
      syncMode: 'manual_full_active_only',
      schedulerEnabled: false,
      pageSize: PAGE_SIZE,
      employeeCount: this.repository.countEmployees(this.config.yzj.eid, this.config.yzj.appId),
      isSyncing: Boolean(activeRun),
      lastRun,
      recentRuns: this.repository.getRecentRuns(10),
    };
  }

  startManualSync(): ManualSyncStartResponse {
    const existingRun = this.repository.getActiveRun();
    if (this.activeRunId || existingRun) {
      throw new SyncAlreadyRunningError(existingRun?.id ?? this.activeRunId ?? undefined);
    }

    const runId = randomUUID();
    const startedAt = this.now().toISOString();

    this.repository.createRun({
      id: runId,
      eid: this.config.yzj.eid,
      appId: this.config.yzj.appId,
      triggerType: 'manual',
      status: 'running',
      startedAt,
    });

    this.activeRunId = runId;
    queueMicrotask(() => {
      void this.executeManualSync(runId);
    });

    return {
      runId,
      status: 'running',
      message: '已开始手动同步在职人员',
    };
  }

  private async executeManualSync(runId: string): Promise<void> {
    const progress: SyncProgress = {
      pageCount: 0,
      fetchedCount: 0,
      upsertedCount: 0,
      skippedCount: 0,
    };

    try {
      const accessToken = await this.client.getAccessToken({
        eid: this.config.yzj.eid,
        secret: this.config.yzj.orgReadSecret,
      });

      let begin = 0;
      while (true) {
        const employees = await this.client.listActiveEmployees({
          accessToken,
          eid: this.config.yzj.eid,
          begin,
          count: PAGE_SIZE,
        });

        progress.pageCount += 1;
        progress.fetchedCount += employees.length;

        for (const employee of employees) {
          this.persistEmployee(employee, progress);
        }

        if (employees.length < PAGE_SIZE) {
          break;
        }

        begin += PAGE_SIZE;
      }

      this.repository.completeRun(runId, {
        finishedAt: this.now().toISOString(),
        pageCount: progress.pageCount,
        fetchedCount: progress.fetchedCount,
        upsertedCount: progress.upsertedCount,
        skippedCount: progress.skippedCount,
        errorMessage: null,
      });
    } catch (error) {
      this.repository.failRun(runId, {
        finishedAt: this.now().toISOString(),
        pageCount: progress.pageCount,
        fetchedCount: progress.fetchedCount,
        upsertedCount: progress.upsertedCount,
        skippedCount: progress.skippedCount,
        errorMessage: getErrorMessage(error),
      });
    } finally {
      this.activeRunId = null;
    }
  }

  private persistEmployee(employee: YzjEmployee, progress: SyncProgress): void {
    if (employee.status !== '1' || !employee.openId) {
      progress.skippedCount += 1;
      return;
    }

    this.repository.upsertEmployee({
      eid: this.config.yzj.eid,
      appId: this.config.yzj.appId,
      openId: employee.openId,
      uid: employee.uid ?? null,
      name: employee.name ?? null,
      phone: employee.phone ?? null,
      email: employee.email ?? null,
      jobTitle: employee.jobTitle ?? null,
      status: employee.status ?? null,
      syncedAt: this.now().toISOString(),
      rawPayloadJson: JSON.stringify(employee),
    });

    progress.upsertedCount += 1;
  }
}

export function getRunIdFromConflict(error: unknown): string | undefined {
  if (error instanceof SyncAlreadyRunningError && error.details && typeof error.details === 'object') {
    const runId = (error.details as { runId?: string }).runId;
    return runId;
  }

  return undefined;
}
