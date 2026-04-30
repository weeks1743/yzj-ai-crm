import { DatabaseSync } from 'node:sqlite';
import type {
  OrgEmployeeRecord,
  OrgSyncRunStatus,
  OrgSyncRunSummary,
} from './contracts.js';

interface OrgSyncRunRow {
  id: string;
  trigger_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  page_count: number;
  fetched_count: number;
  upserted_count: number;
  skipped_count: number;
  error_message: string | null;
}

interface OrgEmployeeRow {
  eid: string;
  app_id: string;
  open_id: string;
  uid: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  job_title: string | null;
  status: string | null;
  synced_at: string;
}

export interface OrgEmployeeCandidate {
  eid: string;
  appId: string;
  openId: string;
  uid: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  jobTitle: string | null;
  status: string | null;
  syncedAt: string;
}

function mapRunRow(row: OrgSyncRunRow): OrgSyncRunSummary {
  return {
    id: row.id,
    triggerType: row.trigger_type as OrgSyncRunSummary['triggerType'],
    status: row.status as OrgSyncRunStatus,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    pageCount: row.page_count,
    fetchedCount: row.fetched_count,
    upsertedCount: row.upserted_count,
    skippedCount: row.skipped_count,
    errorMessage: row.error_message,
  };
}

function mapEmployeeRow(row: OrgEmployeeRow): OrgEmployeeCandidate {
  return {
    eid: row.eid,
    appId: row.app_id,
    openId: row.open_id,
    uid: row.uid,
    name: row.name,
    phone: row.phone,
    email: row.email,
    jobTitle: row.job_title,
    status: row.status,
    syncedAt: row.synced_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export class OrgSyncRepository {
  constructor(private readonly database: DatabaseSync) {}

  markRunningRunsAsFailed(message: string): void {
    this.database
      .prepare(
        `
          UPDATE org_sync_runs
          SET status = 'failed',
              finished_at = CURRENT_TIMESTAMP,
              error_message = COALESCE(error_message, ?)
          WHERE status = 'running'
        `,
      )
      .run(message);
  }

  createRun(run: {
    id: string;
    eid: string;
    appId: string;
    triggerType: 'manual';
    status: 'running';
    startedAt: string;
  }): void {
    this.database
      .prepare(
        `
          INSERT INTO org_sync_runs (
            id, eid, app_id, trigger_type, status, started_at, finished_at,
            page_count, fetched_count, upserted_count, skipped_count, error_message
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, 0, 0, 0, NULL)
        `,
      )
      .run(run.id, run.eid, run.appId, run.triggerType, run.status, run.startedAt);
  }

  completeRun(runId: string, stats: Omit<OrgSyncRunSummary, 'id' | 'triggerType' | 'status' | 'startedAt'>): void {
    this.database
      .prepare(
        `
          UPDATE org_sync_runs
          SET status = 'completed',
              finished_at = ?,
              page_count = ?,
              fetched_count = ?,
              upserted_count = ?,
              skipped_count = ?,
              error_message = NULL
          WHERE id = ?
        `,
      )
      .run(
        stats.finishedAt,
        stats.pageCount,
        stats.fetchedCount,
        stats.upsertedCount,
        stats.skippedCount,
        runId,
      );
  }

  failRun(
    runId: string,
    params: {
      finishedAt: string;
      pageCount: number;
      fetchedCount: number;
      upsertedCount: number;
      skippedCount: number;
      errorMessage: string;
    },
  ): void {
    this.database
      .prepare(
        `
          UPDATE org_sync_runs
          SET status = 'failed',
              finished_at = ?,
              page_count = ?,
              fetched_count = ?,
              upserted_count = ?,
              skipped_count = ?,
              error_message = ?
          WHERE id = ?
        `,
      )
      .run(
        params.finishedAt,
        params.pageCount,
        params.fetchedCount,
        params.upsertedCount,
        params.skippedCount,
        params.errorMessage,
        runId,
      );
  }

  upsertEmployee(employee: OrgEmployeeRecord): void {
    this.database
      .prepare(
        `
          INSERT INTO org_employees (
            eid, app_id, open_id, uid, name, phone, email, job_title, status, synced_at, raw_payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(eid, app_id, open_id) DO UPDATE SET
            uid = excluded.uid,
            name = excluded.name,
            phone = excluded.phone,
            email = excluded.email,
            job_title = excluded.job_title,
            status = excluded.status,
            synced_at = excluded.synced_at,
            raw_payload_json = excluded.raw_payload_json
        `,
      )
      .run(
        employee.eid,
        employee.appId,
        employee.openId,
        employee.uid,
        employee.name,
        employee.phone,
        employee.email,
        employee.jobTitle,
        employee.status,
        employee.syncedAt,
        employee.rawPayloadJson,
      );
  }

  countEmployees(eid: string, appId: string): number {
    const row = this.database
      .prepare(
        `
          SELECT COUNT(*) as count
          FROM org_employees
          WHERE eid = ? AND app_id = ?
        `,
      )
      .get(eid, appId) as { count: number };

    return row.count;
  }

  findEmployees(input: {
    eid: string;
    appId: string;
    keyword: string;
    limit?: number;
  }): OrgEmployeeCandidate[] {
    const keyword = input.keyword.trim();
    if (!keyword) {
      return [];
    }
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const scopedRows = this.findEmployeeRows({
      ...input,
      keyword,
      limit,
      restrictApp: true,
    });
    const rows = scopedRows.length
      ? scopedRows
      : this.findEmployeeRows({
          ...input,
          keyword,
          limit,
          restrictApp: false,
        });

    return rows.map(mapEmployeeRow);
  }

  private findEmployeeRows(input: {
    eid: string;
    appId: string;
    keyword: string;
    limit: number;
    restrictApp: boolean;
  }): OrgEmployeeRow[] {
    return this.database
      .prepare(
        `
          SELECT eid, app_id, open_id, uid, name, phone, email, job_title, status, synced_at
          FROM org_employees
          WHERE eid = ?
            ${input.restrictApp ? 'AND app_id = ?' : ''}
            AND (
              name LIKE ? ESCAPE '\\'
              OR open_id = ?
              OR uid = ?
              OR phone = ?
              OR lower(COALESCE(email, '')) = lower(?)
            )
          ORDER BY
            CASE WHEN status = '1' OR lower(COALESCE(status, '')) = 'active' THEN 1 ELSE 0 END DESC,
            CASE WHEN name = ? THEN 1 ELSE 0 END DESC,
            length(COALESCE(name, '')) ASC,
            open_id ASC
          LIMIT ?
        `,
      )
      .all(
        input.eid,
        ...(input.restrictApp ? [input.appId] : []),
        `%${escapeLike(input.keyword)}%`,
        input.keyword,
        input.keyword,
        input.keyword,
        input.keyword,
        input.keyword,
        input.limit,
      ) as unknown as OrgEmployeeRow[];
  }

  getLatestRun(): OrgSyncRunSummary | null {
    const row = this.database
      .prepare(
        `
          SELECT id, trigger_type, status, started_at, finished_at, page_count, fetched_count,
                 upserted_count, skipped_count, error_message
          FROM org_sync_runs
          ORDER BY started_at DESC
          LIMIT 1
        `,
      )
      .get() as OrgSyncRunRow | undefined;

    return row ? mapRunRow(row) : null;
  }

  getActiveRun(): OrgSyncRunSummary | null {
    const row = this.database
      .prepare(
        `
          SELECT id, trigger_type, status, started_at, finished_at, page_count, fetched_count,
                 upserted_count, skipped_count, error_message
          FROM org_sync_runs
          WHERE status = 'running'
          ORDER BY started_at DESC
          LIMIT 1
        `,
      )
      .get() as OrgSyncRunRow | undefined;

    return row ? mapRunRow(row) : null;
  }

  getRecentRuns(limit = 10): OrgSyncRunSummary[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, trigger_type, status, started_at, finished_at, page_count, fetched_count,
                 upserted_count, skipped_count, error_message
          FROM org_sync_runs
          ORDER BY started_at DESC
          LIMIT ?
        `,
      )
      .all(limit) as unknown as OrgSyncRunRow[];

    return rows.map(mapRunRow);
  }
}
