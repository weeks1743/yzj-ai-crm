import assert from 'node:assert/strict';
import test from 'node:test';
import { YzjClient } from '../src/yzj-client.js';
import { YzjApiError } from '../src/errors.js';

test('YzjClient gets access token and employee list', async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = new YzjClient({
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
              accessToken: 'access-token',
              expireIn: 6400,
            },
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          errorCode: 100,
          data: [
            {
              openId: 'open-1',
              status: '1',
              name: '张三',
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const accessToken = await client.getAccessToken({
    eid: '21024647',
    secret: 'org-read-secret',
  });
  const employees = await client.listActiveEmployees({
    accessToken,
    eid: '21024647',
    begin: 0,
    count: 1000,
  });

  assert.equal(accessToken, 'access-token');
  assert.equal(employees.length, 1);
  assert.match(calls[0].input, /getAccessToken/);
  assert.match(String(calls[1].init?.body), /%22count%22%3A1000/);
});

test('YzjClient maps failed payload to YzjApiError', async () => {
  const client = new YzjClient({
    baseUrl: 'https://stub.yzj.local',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          success: false,
          errorCode: 3001,
          error: '用户名密码错误',
        }),
        { status: 200 },
      ),
  });

  await assert.rejects(
    () =>
      client.getAccessToken({
        eid: '21024647',
        secret: 'bad-secret',
      }),
    (error: unknown) => {
      assert.ok(error instanceof YzjApiError);
      assert.match(error.message, /AccessToken/);
      return true;
    },
  );
});
