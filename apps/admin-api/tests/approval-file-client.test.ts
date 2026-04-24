import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ApprovalFileClient } from '../src/approval-file-client.js';

test('ApprovalFileClient gets resGroupSecret token and uploads multipart file', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'yzj-approval-file-'));
  const filePath = join(tempDir, 'fixture.txt');
  writeFileSync(filePath, 'fixture', 'utf8');

  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = new ApprovalFileClient({
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
              accessToken: 'file-token',
              expireIn: 7200,
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
              fileId: 'file-001',
              fileType: 'doc',
              isEncrypted: false,
              fileName: 'fixture.txt',
              length: 7,
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  try {
    const accessToken = await client.getResourceAccessToken({
      eid: '21024647',
      secret: 'file-secret',
    });
    const uploaded = await client.uploadFile({
      accessToken,
      filePath,
      bizKey: 'cloudflow',
    });

    assert.equal(accessToken, 'file-token');
    assert.equal(uploaded.fileId, 'file-001');
    assert.equal(uploaded.fileType, 'doc');
    assert.match(calls[0]?.input ?? '', /getAccessToken/);
    assert.match(calls[1]?.input ?? '', /uploadfile/);
    assert.ok(calls[1]?.init?.body instanceof FormData);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
