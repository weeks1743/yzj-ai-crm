import assert from 'node:assert/strict';
import test from 'node:test';
import type { YzjEmployee } from '../src/contracts.js';
import { OrgSyncRepository } from '../src/org-sync-repository.js';
import { OrgSyncService } from '../src/org-sync-service.js';
import { YzjClient } from '../src/yzj-client.js';
import { createInMemoryDatabase, createTestConfig } from './test-helpers.js';

function createRepository(): OrgSyncRepository {
  return new OrgSyncRepository(createInMemoryDatabase());
}

class StubYzjClient extends YzjClient {
  constructor(
    private readonly pages: YzjEmployee[][],
    private readonly onAccessToken?: () => Promise<void> | void,
  ) {
    super({ baseUrl: 'https://stub.yzj.local' });
  }

  override async getAccessToken(): Promise<string> {
    await this.onAccessToken?.();
    return 'access-token';
  }

  override async listActiveEmployees(params: {
    accessToken: string;
    eid: string;
    begin: number;
    count: number;
  }): Promise<YzjEmployee[]> {
    const index = params.begin / params.count;
    return this.pages[index] ?? [];
  }
}

async function waitForCompletion(service: OrgSyncService, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = service.getSettings();
    if (!state.isSyncing) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('同步未在预期时间内结束');
}

test('OrgSyncService completes single-page sync and skips non-active employees', async () => {
  const repository = createRepository();
  const service = new OrgSyncService({
    config: createTestConfig(),
    repository,
    client: new StubYzjClient([
      [
        {
          openId: 'open-1',
          uid: 'uid-1',
          name: '张三',
          status: '1',
          email: 'zhangsan@example.com',
        },
        {
          openId: 'open-2',
          uid: 'uid-2',
          name: '李四',
          status: '0',
        },
      ],
    ]),
    now: () => new Date('2026-04-23T09:00:00.000Z'),
  });

  service.startManualSync();
  await waitForCompletion(service);

  const settings = service.getSettings();
  assert.equal(settings.employeeCount, 1);
  assert.equal(settings.lastRun?.status, 'completed');
  assert.equal(settings.lastRun?.fetchedCount, 2);
  assert.equal(settings.lastRun?.upsertedCount, 1);
  assert.equal(settings.lastRun?.skippedCount, 1);
});

test('OrgSyncService paginates and upserts existing employees without duplication', async () => {
  const repository = createRepository();
  const page1 = Array.from({ length: 1000 }, (_, index) => ({
    openId: `open-${index}`,
    uid: `uid-${index}`,
    name: `员工${index}`,
    status: '1',
  }));
  const page2 = [
    {
      openId: 'open-1',
      uid: 'uid-1',
      name: '员工1-更新',
      status: '1',
    },
  ];

  const service = new OrgSyncService({
    config: createTestConfig(),
    repository,
    client: new StubYzjClient([page1, page2]),
    now: () => new Date('2026-04-23T09:00:00.000Z'),
  });

  service.startManualSync();
  await waitForCompletion(service);

  const settings = service.getSettings();
  assert.equal(settings.employeeCount, 1000);
  assert.equal(settings.lastRun?.pageCount, 2);
  assert.equal(settings.lastRun?.fetchedCount, 1001);
  assert.equal(settings.lastRun?.upsertedCount, 1001);
});

test('OrgSyncService rejects concurrent manual sync attempts', async () => {
  let release!: () => void;
  const repository = createRepository();
  const service = new OrgSyncService({
    config: createTestConfig(),
    repository,
    client: new StubYzjClient(
      [[{ openId: 'open-1', status: '1' }]],
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    ),
    now: () => new Date('2026-04-23T09:00:00.000Z'),
  });

  service.startManualSync();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.throws(() => service.startManualSync(), /已有同步进行中/);

  release();
  await waitForCompletion(service);
});

test('OrgSyncRepository finds employee candidates within current tenant and app', () => {
  const repository = createRepository();
  const syncedAt = '2026-04-29T00:00:00.000Z';
  repository.upsertEmployee({
    eid: '21024647',
    appId: '501037729',
    openId: 'open-chen-weirong',
    uid: 'uid-chen-weirong',
    name: '陈伟荣',
    phone: '13800000002',
    email: 'chenweirong@example.com',
    jobTitle: '销售',
    status: '1',
    syncedAt,
    rawPayloadJson: '{}',
  });
  repository.upsertEmployee({
    eid: '21024647',
    appId: '501037729',
    openId: 'open-chen-weigang',
    uid: 'uid-chen-weigang',
    name: '陈伟刚',
    phone: '13800000003',
    email: 'chenweigang@example.com',
    jobTitle: '销售',
    status: '1',
    syncedAt,
    rawPayloadJson: '{}',
  });
  repository.upsertEmployee({
    eid: 'other-eid',
    appId: '501037729',
    openId: 'open-other-tenant',
    uid: 'uid-other-tenant',
    name: '陈伟',
    phone: '13800000004',
    email: 'chenwei-other@example.com',
    jobTitle: '销售',
    status: '1',
    syncedAt,
    rawPayloadJson: '{}',
  });
  repository.upsertEmployee({
    eid: '21024647',
    appId: 'historical-app',
    openId: 'open-chen-history',
    uid: 'uid-chen-history',
    name: '陈伟历史',
    phone: '13800000005',
    email: 'chenwei-history@example.com',
    jobTitle: '销售',
    status: '1',
    syncedAt,
    rawPayloadJson: '{}',
  });

  const fuzzy = repository.findEmployees({
    eid: '21024647',
    appId: '501037729',
    keyword: '陈伟',
  });
  assert.deepEqual(
    fuzzy.map((employee) => employee.openId),
    ['open-chen-weigang', 'open-chen-weirong'],
  );

  const byPhone = repository.findEmployees({
    eid: '21024647',
    appId: '501037729',
    keyword: '13800000003',
  });
  assert.deepEqual(byPhone.map((employee) => employee.openId), ['open-chen-weigang']);

  const byEmail = repository.findEmployees({
    eid: '21024647',
    appId: '501037729',
    keyword: 'CHENWEIRONG@EXAMPLE.COM',
  });
  assert.deepEqual(byEmail.map((employee) => employee.openId), ['open-chen-weirong']);

  const fallback = repository.findEmployees({
    eid: '21024647',
    appId: 'new-app-without-synced-employees',
    keyword: '陈伟',
  });
  assert.deepEqual(
    fallback.map((employee) => employee.openId),
    ['open-chen-weigang', 'open-chen-weirong', 'open-chen-history'],
  );
});
