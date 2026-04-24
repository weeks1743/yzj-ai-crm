import assert from 'node:assert/strict';
import test from 'node:test';
import { YzjApiError } from '../src/errors.js';
import { LightCloudClient } from '../src/lightcloud-client.js';

test('LightCloudClient gets team token and reads search/list/batchSave payloads', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = new LightCloudClient({
    baseUrl: 'https://stub.yzj.local',
    now: () => 1234567890123,
    fetchImpl: async (input, init) => {
      const requestUrl = String(input);
      calls.push({ input: requestUrl, init });

      if (requestUrl.includes('getAccessToken')) {
        return new Response(
          JSON.stringify({
            success: true,
            errorCode: 0,
            data: {
              accessToken: 'lightcloud-token',
              expireIn: 6400,
            },
          }),
          { status: 200 },
        );
      }

      if (requestUrl.includes('searchList')) {
        return new Response(
          JSON.stringify({
            success: true,
            errorCode: 0,
            data: {
              pageNumber: 1,
              totalPages: 1,
              pageSize: 10,
              totalElements: 1,
              content: [
                {
                  id: 'form-inst-001',
                  important: {
                    标题: '华东制造样板客户',
                  },
                  fieldContent: [],
                },
              ],
            },
          }),
          { status: 200 },
        );
      }

      if (requestUrl.includes('batchSave')) {
        return new Response(
          JSON.stringify({
            success: true,
            errorCode: 0,
            data: {
              hasException: false,
              formInstIds: [null],
              exceptions: {},
            },
          }),
          { status: 200 },
        );
      }

      if (requestUrl.includes('batchDelete')) {
        return new Response(
          JSON.stringify({
            success: true,
            errorCode: 0,
            data: ['form-inst-001'],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          errorCode: 200,
          data: [
            {
              id: 'form-inst-001',
              important: {
                标题: '华东制造样板客户',
              },
              fieldContent: [
                {
                  codeId: 'Te_0',
                  title: '客户名称',
                  type: 'textWidget',
                  value: '华东制造样板客户',
                  rawValue: '华东制造样板客户',
                  parentCodeId: null,
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const accessToken = await client.getTeamAccessToken({
    eid: '21024647',
    appId: 'lightcloud-app-id',
    secret: 'lightcloud-app-secret',
  });
  const page = await client.searchList({
    accessToken,
    body: {
      eid: '21024647',
      oid: 'oid-1',
      formCodeId: 'customer-form-001',
      pageNumber: 1,
      pageSize: 10,
      searchItems: [],
    },
  });
  const records = await client.listRecords({
    accessToken,
    body: {
      eid: '21024647',
      formCodeId: 'customer-form-001',
      formInstIds: ['form-inst-001'],
    },
  });
  const formInstIds = await client.batchSave({
    accessToken,
    body: {
      eid: '21024647',
      formCodeId: 'customer-form-001',
      oid: 'oid-1',
      data: [
        {
          formInstId: 'form-inst-001',
          widgetValue: {
            Ra_3: 'EeFfGgHh',
          },
        },
      ],
    },
  });
  const deletedFormInstIds = await client.batchDelete({
    accessToken,
    body: {
      eid: '21024647',
      formCodeId: 'customer-form-001',
      oid: 'oid-1',
      formInstIds: ['form-inst-001'],
    },
  });

  assert.equal(accessToken, 'lightcloud-token');
  assert.equal(page.content[0]?.id, 'form-inst-001');
  assert.equal(records[0]?.fieldContent?.[0]?.codeId, 'Te_0');
  assert.deepEqual(formInstIds, ['form-inst-001']);
  assert.deepEqual(deletedFormInstIds, ['form-inst-001']);
  assert.match(calls[0]?.input ?? '', /getAccessToken/);
  assert.match(calls[1]?.input ?? '', /searchList/);
  assert.match(calls[2]?.input ?? '', /data\/list/);
  assert.match(calls[3]?.input ?? '', /data\/batchSave/);
  assert.match(calls[4]?.input ?? '', /data\/batchDelete/);
});

test('LightCloudClient maps failed payload to YzjApiError', async () => {
  const client = new LightCloudClient({
    baseUrl: 'https://stub.yzj.local',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: false,
          errorCode: 3001,
          error: 'invalid request',
        }),
        { status: 200 },
      ),
  });

  await assert.rejects(
    () =>
      client.searchList({
        accessToken: 'bad-token',
        body: {
          eid: '21024647',
          oid: 'oid-1',
          formCodeId: 'customer-form-001',
          pageNumber: 1,
          pageSize: 10,
          searchItems: [],
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof YzjApiError);
      assert.match(error.message, /查询轻云单据列表失败/);
      return true;
    },
  );
});

test('LightCloudClient tolerates invalid numeric exception keys in batchSave responses', async () => {
  const client = new LightCloudClient({
    baseUrl: 'https://stub.yzj.local',
    fetchImpl: async () =>
      new Response(
        '{"success":false,"errorCode":0,"data":{"hasException":true,"formInstIds":[null],"exceptions":{0:"1101032:主表单控件输入值类型错误"}}}',
        { status: 200 },
      ),
  });

  await assert.rejects(
    () =>
      client.batchSave({
        accessToken: 'bad-token',
        body: {
          eid: '21024647',
          formCodeId: 'customer-form-001',
          oid: 'oid-1',
          data: [
            {
              formInstId: 'form-inst-001',
              widgetValue: {
                Bd_1: 'CON-001',
              },
            },
          ],
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof YzjApiError);
      assert.match(error.message, /写入轻云单据失败/);
      assert.deepEqual((error as YzjApiError).details, {
        status: 200,
        payload: {
          success: false,
          errorCode: 0,
          data: {
            hasException: true,
            formInstIds: [null],
            exceptions: {
              '0': '1101032:主表单控件输入值类型错误',
            },
          },
        },
      });
      return true;
    },
  );
});

test('LightCloudClient falls back to requested formInstIds when batchDelete succeeds with null data', async () => {
  const client = new LightCloudClient({
    baseUrl: 'https://stub.yzj.local',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: true,
          errorCode: 0,
          data: null,
        }),
        { status: 200 },
      ),
  });

  const deletedFormInstIds = await client.batchDelete({
    accessToken: 'good-token',
    body: {
      eid: '21024647',
      formCodeId: 'opportunity-form-001',
      oid: 'oid-1',
      formInstIds: ['form-inst-001'],
    },
  });

  assert.deepEqual(deletedFormInstIds, ['form-inst-001']);
});
