import type { QueryResultRow } from 'pg';
import type { DatabaseConnection } from './database.js';
import type {
  OrgEmployeeRecord,
  OrgSyncRunStatus,
  OrgSyncRunSummary,
} from './contracts.js';

interface OrgSyncRunRow extends QueryResultRow {
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

interface OrgEmployeeRow extends QueryResultRow {
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

interface CountRow extends QueryResultRow {
  count: string | number;
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
  constructor(private readonly database: DatabaseConnection) {}

  async markRunningRunsAsFailed(message: string): Promise<void> {
    await this.database.query(
      `
        UPDATE ${this.database.table('org_sync_runs')}
        SET status = 'failed',
            finished_at = COALESCE(finished_at, $1),
            error_message = COALESCE(error_message, $2)
        WHERE status = 'running'
      `,
      [new Date().toISOString(), message],
    );
  }

  async createRun(run: {
    id: string;
    eid: string;
    appId: string;
    triggerType: 'manual';
    status: 'running';
    startedAt: string;
  }): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ${this.database.table('org_sync_runs')} (
          id, eid, app_id, trigger_type, status, started_at, finished_at,
          page_count, fetched_count, upserted_count, skipped_count, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, NULL, 0, 0, 0, 0, NULL)
      `,
      [run.id, run.eid, run.appId, run.triggerType, run.status, run.startedAt],
    );
  }

  async completeRun(
    runId: string,
    stats: Omit<OrgSyncRunSummary, 'id' | 'triggerType' | 'status' | 'startedAt'>,
  ): Promise<void> {
    await this.database.query(
      `
        UPDATE ${this.database.table('org_sync_runs')}
        SET status = 'completed',
            finished_at = $1,
            page_count = $2,
            fetched_count = $3,
            upserted_count = $4,
            skipped_count = $5,
            error_message = NULL
        WHERE id = $6
      `,
      [
        stats.finishedAt,
        stats.pageCount,
        stats.fetchedCount,
        stats.upsertedCount,
        stats.skippedCount,
        runId,
      ],
    );
  }

  async failRun(
    runId: string,
    params: {
      finishedAt: string;
      pageCount: number;
      fetchedCount: number;
      upsertedCount: number;
      skippedCount: number;
      errorMessage: string;
    },
  ): Promise<void> {
    await this.database.query(
      `
        UPDATE ${this.database.table('org_sync_runs')}
        SET status = 'failed',
            finished_at = $1,
            page_count = $2,
            fetched_count = $3,
            upserted_count = $4,
            skipped_count = $5,
            error_message = $6
        WHERE id = $7
      `,
      [
        params.finishedAt,
        params.pageCount,
        params.fetchedCount,
        params.upsertedCount,
        params.skippedCount,
        params.errorMessage,
        runId,
      ],
    );
  }

  async upsertEmployee(employee: OrgEmployeeRecord): Promise<void> {
    await this.database.query(
      `
        INSERT INTO ${this.database.table('org_employees')} (
          eid, app_id, open_id, uid, name, phone, email, job_title, status, synced_at, raw_payload_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
        ON CONFLICT (eid, app_id, open_id) DO UPDATE SET
          uid = EXCLUDED.uid,
          name = EXCLUDED.name,
          phone = EXCLUDED.phone,
          email = EXCLUDED.email,
          job_title = EXCLUDED.job_title,
          status = EXCLUDED.status,
          synced_at = EXCLUDED.synced_at,
          raw_payload_json = EXCLUDED.raw_payload_json
      `,
      [
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
      ],
    );
  }

  async countEmployees(eid: string, appId: string): Promise<number> {
    const row = await this.database.queryOne<CountRow>(
      `
        SELECT COUNT(*) AS count
        FROM ${this.database.table('org_employees')}
        WHERE eid = $1 AND app_id = $2
      `,
      [eid, appId],
    );

    return Number(row.count ?? 0);
  }

  async findEmployees(input: {
    eid: string;
    appId: string;
    keyword: string;
    limit?: number;
  }): Promise<OrgEmployeeCandidate[]> {
    const keyword = input.keyword.trim();
    if (!keyword) {
      return [];
    }
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const scopedRows = await this.findEmployeeRows({
      ...input,
      keyword,
      limit,
      restrictApp: true,
    });
    const rows = scopedRows.length
      ? scopedRows
      : await this.findEmployeeRows({
          ...input,
          keyword,
          limit,
          restrictApp: false,
        });

    return rows.map(mapEmployeeRow);
  }

  private async findEmployeeRows(input: {
    eid: string;
    appId: string;
    keyword: string;
    limit: number;
    restrictApp: boolean;
  }): Promise<OrgEmployeeRow[]> {
    const params: Array<string | number> = [input.eid];
    const restrictAppClause = input.restrictApp
      ? `AND app_id = $${params.push(input.appId)}`
      : '';
    const likeValue = `%${escapeLike(input.keyword)}%`;
    const likeIndex = params.push(likeValue);
    const openIdIndex = params.push(input.keyword);
    const uidIndex = params.push(input.keyword);
    const phoneIndex = params.push(input.keyword);
    const emailIndex = params.push(input.keyword);
    const exactNameIndex = params.push(input.keyword);
    const limitIndex = params.push(input.limit);

    return this.database.query<OrgEmployeeRow>(
      `
        SELECT eid, app_id, open_id, uid, name, phone, email, job_title, status, synced_at
        FROM ${this.database.table('org_employees')}
        WHERE eid = $1
          ${restrictAppClause}
          AND (
            name LIKE $${likeIndex} ESCAPE '\\'
            OR open_id = $${openIdIndex}
            OR uid = $${uidIndex}
            OR phone = $${phoneIndex}
            OR lower(COALESCE(email, '')) = lower($${emailIndex})
          )
        ORDER BY
          CASE WHEN status = '1' OR lower(COALESCE(status, '')) = 'active' THEN 1 ELSE 0 END DESC,
          CASE WHEN name = $${exactNameIndex} THEN 1 ELSE 0 END DESC,
          length(COALESCE(name, '')) ASC,
          open_id ASC
        LIMIT $${limitIndex}
      `,
      params,
    );
  }

  async getLatestRun(): Promise<OrgSyncRunSummary | null> {
    const row = await this.database.queryMaybeOne<OrgSyncRunRow>(
      `
        SELECT id, trigger_type, status, started_at, finished_at, page_count, fetched_count,
               upserted_count, skipped_count, error_message
        FROM ${this.database.table('org_sync_runs')}
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
    );

    return row ? mapRunRow(row) : null;
  }

  async getActiveRun(): Promise<OrgSyncRunSummary | null> {
    const row = await this.database.queryMaybeOne<OrgSyncRunRow>(
      `
        SELECT id, trigger_type, status, started_at, finished_at, page_count, fetched_count,
               upserted_count, skipped_count, error_message
        FROM ${this.database.table('org_sync_runs')}
        WHERE status = 'running'
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `,
    );

    return row ? mapRunRow(row) : null;
  }

  async getRecentRuns(limit = 10): Promise<OrgSyncRunSummary[]> {
    const rows = await this.database.query<OrgSyncRunRow>(
      `
        SELECT id, trigger_type, status, started_at, finished_at, page_count, fetched_count,
               upserted_count, skipped_count, error_message
        FROM ${this.database.table('org_sync_runs')}
        ORDER BY started_at DESC, id DESC
        LIMIT $1
      `,
      [limit],
    );

    return rows.map(mapRunRow);
  }
}
