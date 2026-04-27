import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DocmeeClient,
  extractDocmeeHtmlCandidate,
  extractDocmeeMarkdownCandidate,
  extractDocmeeStatusCandidate,
} from '../src/docmee-client.js';
import { createSuperPptDocmeeUid } from '../src/super-ppt-docmee.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  return new Response(chunks.join('\n\n'), {
    status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
    },
  });
}

test('DocmeeClient supports runtime token, SSE content generation, and AI layout parsing', async () => {
  const seen: Array<{ url: string; method: string; bodyText?: string | null; token?: string | null }> = [];
  let receivedCreateTaskType: string | null = null;
  let receivedCreateTaskFileName: string | null = null;
  let receivedGenerateContentOutlineType: string | null = null;
  let receivedGeneratePptxByAiTemplateId: string | null = null;
  let receivedGeneratePptxByAiData: string | null = null;

  const client = new DocmeeClient({
    baseUrl: 'https://docmee.example',
    apiKey: 'docmee-key',
    fetchImpl: (async (input, init) => {
      const url = String(input);
      const method = init?.method || 'GET';
      let bodyText: string | null = null;
      if (typeof init?.body === 'string') {
        bodyText = init.body;
      }

      const headers = init?.headers instanceof Headers
        ? init.headers
        : new Headers(init?.headers as HeadersInit | undefined);

      seen.push({
        url,
        method,
        bodyText,
        token: headers.get('token') || headers.get('Api-Key'),
      });

      if (url === 'https://docmee.example/api/user/createApiToken') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            token: 'sk-docmee-session',
            expireTime: 3600,
          },
        });
      }

      if (url === 'https://docmee.example/api/ppt/v2/options') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            reference: [{ name: '保持原文', value: '保持原文' }],
            audience: [{ name: '大众', value: '大众' }],
            lang: [{ name: '简体中文', value: 'zh' }],
            scene: [{ name: '公司介绍', value: '公司介绍' }],
          },
        });
      }

      if (url === 'https://docmee.example/api/ppt/v2/createTask') {
        const form = init?.body as FormData;
        receivedCreateTaskType = String(form.get('type'));
        const upload = form.get('file');
        receivedCreateTaskFileName = upload instanceof File ? upload.name : null;
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: { id: 'task-001' },
        });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generateContent') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { outlineType?: string };
        receivedGenerateContentOutlineType = body.outlineType ?? null;
        return sseResponse([
          'data: {"status":1,"text":"# 研究报告"}',
          'data: {"status":4,"text":"","result":"{\\"title\\":\\"研究报告\\",\\"slides\\":[{\\"headline\\":\\"公司概况\\"}]}"}',
        ]);
      }

      if (url === 'https://docmee.example/api/ppt/v2/updateContent') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: { text: '# Updated Outline' },
        });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptxByAi') {
        const form = init?.body as FormData;
        receivedGeneratePptxByAiTemplateId = String(form.get('templateId') || '');
        receivedGeneratePptxByAiData = String(form.get('data') || '');
        return sseResponse([
          'event: message',
          'data: {"status":"running","payload":{"page_num":"1","html":"<article>page-1</article>"}}',
          '',
          'event: message',
          'data: {"status":"completed","payload":{"page_num":"2","html":"<article>page-2</article>"}}',
        ]);
      }

      if (url === 'https://docmee.example/api/ppt/v2/latestData?taskId=task-001') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: { status: 'running', payload: { htmlMap: { 1: '<article>page-1</article>' } } },
        });
      }

      if (url === 'https://docmee.example/api/ppt/v2/getConvertResult?taskId=task-001') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: { status: 2 },
        });
      }

      if (url === 'https://docmee.example/api/ppt/v2/generatePptx') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            pptInfo: {
              id: 'ppt-001',
              subject: '测试PPT',
              fileUrl: 'https://files.example/ppt-001.pptx',
              templateId: 'tpl-001',
            },
          },
        });
      }

      if (url === 'https://docmee.example/api/ppt/downloadPptx') {
        return jsonResponse({
          code: 0,
          message: 'ok',
          data: {
            id: 'ppt-001',
            subject: '测试PPT',
            fileUrl: 'https://files.example/ppt-001.pptx',
          },
        });
      }

      if (url === 'https://files.example/ppt-001.pptx') {
        return new Response(Buffer.from('pptx-bytes'), {
          status: 200,
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          },
        });
      }

      throw new Error(`Unexpected fetch url: ${url}`);
    }) as any,
  });

  const token = await client.createApiToken({
    uid: 'yzj-ai-crm-super-ppt-job-001',
    limit: 5,
    timeOfHours: 1,
  });
  const options = await client.options(token.token);
  const task = await client.createTask({
    type: 2,
    files: [
      {
        fileName: 'source.md',
        file: Buffer.from('# Test'),
        mimeType: 'text/markdown; charset=utf-8',
      },
    ],
  }, token.token);
  const generated = await client.generateContent({
    id: task.id,
    stream: true,
    outlineType: 'JSON',
    questionMode: false,
    isNeedAsk: false,
    length: 'short',
    scene: '公司介绍',
    audience: '大众',
    lang: 'zh',
    prompt: '请基于完整材料生成专业汇报PPT',
    aiSearch: false,
    isGenImg: false,
  }, token.token);
  const updated = await client.updateContent({
    id: task.id,
    stream: false,
    markdown: generated.text || '',
    question: '整理为企业研究汇报',
  }, token.token);
  const aiLayout = await client.generatePptxByAi({
    id: task.id,
    data: generated.result,
    templateId: 'tpl-enterprise-001',
  }, token.token);
  const latestData = await client.latestData(task.id, token.token);
  const convertResult = await client.getConvertResult(task.id, token.token);
  const pptInfo = await client.generatePptx({
    id: task.id,
    markdown: '# AI Markdown\n\n## 核心结论',
    templateId: 'tpl-enterprise-001',
  }, token.token);
  const binary = await client.downloadPptxBinary(pptInfo.id, token.token);

  assert.equal(options.scene[0]?.value, '公司介绍');
  assert.equal(task.id, 'task-001');
  assert.equal(receivedCreateTaskType, '2');
  assert.equal(receivedCreateTaskFileName, 'source.md');
  assert.equal(receivedGenerateContentOutlineType, 'JSON');
  assert.equal(updated.text, '# Updated Outline');
  assert.equal(receivedGeneratePptxByAiTemplateId, 'tpl-enterprise-001');
  assert.equal(
    receivedGeneratePptxByAiData,
    JSON.stringify({
      title: '研究报告',
      slides: [{ headline: '公司概况' }],
    }),
  );
  assert.equal(generated.events?.length, 2);
  assert.deepEqual(generated.result, {
    title: '研究报告',
    slides: [{ headline: '公司概况' }],
  });
  assert.match(generated.streamLog || '', /status":4/);
  assert.ok((aiLayout.events?.length || 0) >= 2);
  assert.equal(aiLayout.inferredMarkdown, null);
  assert.equal(aiLayout.inferredHtml, '<article>page-2</article>');
  assert.equal(aiLayout.inferredStatus, 'completed');
  assert.equal((latestData.status as string), 'running');
  assert.equal((convertResult.status as number), 2);
  assert.equal(pptInfo.id, 'ppt-001');
  assert.equal(binary.file.toString('utf8'), 'pptx-bytes');
  assert.equal(binary.metadata.subject, '测试PPT');
  assert.ok(seen.some((item) => item.url.endsWith('/api/user/createApiToken') && item.token === 'docmee-key'));
  assert.ok(
    seen.some(
      (item) =>
        item.url === 'https://docmee.example/api/ppt/v2/generateContent'
        && item.token === 'sk-docmee-session',
    ),
  );
});

test('DocmeeClient repairs markdown-decorated keys in JSON outline results', async () => {
  const malformedOutline = [
    '{',
    '  "overall_theme": "测试汇报",',
    '  "pages": [',
    '    {',
    '      "page_number": 1,',
    '      "title": "封面"',
    '    },',
    '    {',
    '      **page_number**: 2,',
    '      **title**: "研发协作",',
    '      **page_type**: "content",',
    '      **content**: {',
    '        "text": "**研发**内容"',
    '      }',
    '    }',
    '  ]',
    '}',
  ].join('\n');

  const client = new DocmeeClient({
    baseUrl: 'https://docmee.example',
    apiKey: 'docmee-key',
    fetchImpl: (async (input) => {
      if (String(input) !== 'https://docmee.example/api/ppt/v2/generateContent') {
        throw new Error(`Unexpected fetch url: ${String(input)}`);
      }

      return sseResponse([
        `data: ${JSON.stringify({
          status: 4,
          outlineType: 'JSON',
          text: '',
          result: malformedOutline,
        })}`,
      ]);
    }) as any,
  });

  const generated = await client.generateContent({
    id: 'task-001',
    stream: true,
    outlineType: 'JSON',
    questionMode: false,
    isNeedAsk: false,
    length: 'short',
    scene: '公司介绍',
    audience: '大众',
    lang: 'zh',
    prompt: '请基于完整材料生成专业汇报PPT',
    aiSearch: false,
    isGenImg: false,
  }, 'sk-docmee-session');

  assert.deepEqual(generated.result, {
    overall_theme: '测试汇报',
    pages: [
      {
        page_number: 1,
        title: '封面',
      },
      {
        page_number: 2,
        title: '研发协作',
        page_type: 'content',
        content: {
          text: '**研发**内容',
        },
      },
    ],
  });
});

test('createSuperPptDocmeeUid is deterministic for the same job seed', () => {
  const uidA = createSuperPptDocmeeUid('d2edb9b0-9962-4b84-ac5f-47ead7c05596');
  const uidB = createSuperPptDocmeeUid('d2edb9b0-9962-4b84-ac5f-47ead7c05596');
  const uidC = createSuperPptDocmeeUid('job-002');

  assert.equal(uidA, uidB);
  assert.notEqual(uidA, uidC);
  assert.match(uidA, /^sp-[a-z0-9]+$/);
});

test('Docmee payload helpers extract markdown, html, and status from nested structures', () => {
  const payload = {
    data: {
      mdContent: '# Final Markdown',
      page: {
        html: '<section>ok</section>',
      },
      meta: {
        status: 'convert_success',
      },
    },
  };

  assert.equal(extractDocmeeMarkdownCandidate(payload), '# Final Markdown');
  assert.equal(extractDocmeeHtmlCandidate(payload), '<section>ok</section>');
  assert.equal(extractDocmeeStatusCandidate(payload), 'convert_success');
});
