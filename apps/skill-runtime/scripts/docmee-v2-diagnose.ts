import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadAppConfig } from '../src/config.js';
import { DocmeeClient, type DocmeeOptionItem } from '../src/docmee-client.js';
import {
  createSuperPptRuntimeToken,
  DEFAULT_SUPER_PPT_PROMPT,
  resolveSuperPptPrompt,
  runOfficialDocmeeLayoutFlow,
} from '../src/super-ppt-docmee.js';

interface ParsedArgs {
  input: string;
  templateId?: string;
  prompt?: string;
  requestText: string;
  outputDir?: string;
}

interface FetchLogEntry {
  index: number;
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  requestBody: unknown;
  responseStatus: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  createdAt: string;
}

const DEFAULT_REQUEST_TEXT = '请基于附件生成适合管理层阅读的企业研究汇报 PPT';

function printUsage(): never {
  throw new Error(
    [
      'Usage:',
      '  pnpm --filter @yzj-ai-crm/skill-runtime exec tsx scripts/docmee-v2-diagnose.ts \\',
      '    --input /abs/path/report.md [--templateId tpl-xxx] [--prompt "提示词"] [--outputDir /abs/path]',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): ParsedArgs {
  const result: Partial<ParsedArgs> = {
    requestText: DEFAULT_REQUEST_TEXT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const next = argv[index + 1];

    if (item === '--input' && next) {
      result.input = resolve(next);
      index += 1;
      continue;
    }
    if (item === '--templateId' && next) {
      result.templateId = next.trim();
      index += 1;
      continue;
    }
    if (item === '--prompt' && next) {
      result.prompt = next;
      index += 1;
      continue;
    }
    if (item === '--requestText' && next) {
      result.requestText = next;
      index += 1;
      continue;
    }
    if (item === '--outputDir' && next) {
      result.outputDir = resolve(next);
      index += 1;
      continue;
    }
    if (item === '--help' || item === '-h') {
      printUsage();
    }
  }

  if (!result.input) {
    printUsage();
  }

  return result as ParsedArgs;
}

function resolveDocmeeOptionValue(
  items: DocmeeOptionItem[],
  preferredValue: string,
  fallbackValue: string,
): string {
  const matchedItem = items.find((item) => item.value === preferredValue || item.name === preferredValue);
  return matchedItem?.value || fallbackValue || items[0]?.value;
}

function resolveDocmeeQuestion(requestText: string): string {
  const candidate = requestText.replace(/\s+/g, ' ').trim();
  if (candidate.length > 0) {
    return `${candidate}\n\n请严格基于完整原始材料生成，不要截断、压缩或省略关键信息。`;
  }

  return '请严格基于完整原始材料生成一份适合管理层审阅的企业研究汇报 PPT，不要截断、压缩或省略关键信息。';
}

function pickDocmeeContentText(payload: {
  text?: string;
  markdown?: string;
}, fallbackText?: string): string {
  const content = payload.markdown?.trim() || payload.text?.trim() || fallbackText?.trim() || '';
  if (!content) {
    throw new Error('Docmee 未返回可用的 Markdown 内容');
  }

  return content;
}

function serializeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return headers;
}

function serializeBody(body: BodyInit | null | undefined): unknown {
  if (!body) {
    return null;
  }

  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  if (body instanceof FormData) {
    const entries: Array<Record<string, unknown>> = [];
    for (const [key, value] of body.entries()) {
      if (typeof value === 'string') {
        entries.push({ key, value });
        continue;
      }

      entries.push({
        key,
        fileName: value.name,
        fileType: value.type,
        fileSize: value.size,
      });
    }
    return entries;
  }

  if (body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries());
  }

  if (body instanceof Blob) {
    return {
      type: body.type,
      size: body.size,
    };
  }

  return String(body);
}

function createLoggedFetch(logs: FetchLogEntry[]) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    const response = await fetch(input, init);
    const cloned = response.clone();
    let responseBody = '';
    try {
      responseBody = await cloned.text();
    } catch {
      responseBody = '[unreadable body]';
    }

    logs.push({
      index: logs.length + 1,
      url,
      method,
      requestHeaders: serializeHeaders(init?.headers),
      requestBody: serializeBody(init?.body),
      responseStatus: response.status,
      responseHeaders: Object.fromEntries(response.headers.entries()),
      responseBody,
      createdAt: new Date().toISOString(),
    });

    return response;
  };
}

function readEnterprisePromptState(envFilePath: string): {
  templateId: string | null;
  storedPrompt: string | null;
} {
  const envDir = dirname(envFilePath);
  const sqlitePath = resolve(envDir, process.env.ORG_SYNC_SQLITE_PATH || '.local/admin-api.sqlite');
  if (!existsSync(sqlitePath)) {
    return {
      templateId: null,
      storedPrompt: null,
    };
  }

  const database = new DatabaseSync(sqlitePath);

  try {
    const templateRow = database
      .prepare(
        `
          SELECT template_id
          FROM enterprise_ppt_templates
          WHERE is_active = 1
          LIMIT 1
        `,
      )
      .get() as { template_id?: string } | undefined;
    const promptRow = database
      .prepare(
        `
          SELECT default_prompt
          FROM enterprise_ppt_template_settings
          WHERE singleton_id = 1
          LIMIT 1
        `,
      )
      .get() as { default_prompt?: string } | undefined;

    return {
      templateId: templateRow?.template_id?.trim() || null,
      storedPrompt: promptRow?.default_prompt?.trim() || null,
    };
  } finally {
    database.close();
  }
}

function ensureOutputDir(baseDir: string) {
  mkdirSync(baseDir, { recursive: true });
}

function writeJson(outputDir: string, fileName: string, value: unknown) {
  writeFileSync(join(outputDir, fileName), JSON.stringify(value, null, 2), 'utf8');
}

function writeText(outputDir: string, fileName: string, value: string) {
  writeFileSync(join(outputDir, fileName), value, 'utf8');
}

async function runCurrentChain(params: {
  client: DocmeeClient;
  runtimeToken: string;
  sourcePath: string;
  sourceMarkdown: string;
  templateId?: string;
  prompt: string;
  requestText: string;
  outputDir: string;
}) {
  const task = await params.client.createTask({
    type: 2,
    files: [
      {
        fileName: basename(params.sourcePath),
        file: readFileSync(params.sourcePath),
        mimeType: 'text/markdown; charset=utf-8',
      },
    ],
  }, params.runtimeToken);
  const options = await params.client.options(params.runtimeToken);
  const scene = resolveDocmeeOptionValue(options.scene, '公司介绍', '公司介绍');
  const audience = resolveDocmeeOptionValue(options.audience, '大众', '大众');
  const lang = resolveDocmeeOptionValue(options.lang, 'zh', 'zh');
  const generated = await params.client.generateContent({
    id: task.id,
    stream: false,
    outlineType: 'MD',
    questionMode: false,
    isNeedAsk: false,
    length: 'short',
    scene,
    audience,
    lang,
    prompt: params.prompt,
    aiSearch: false,
    isGenImg: false,
  }, params.runtimeToken);
  const generatedOutline = pickDocmeeContentText(generated, params.sourceMarkdown);
  const updated = await params.client.updateContent({
    id: task.id,
    stream: false,
    markdown: generatedOutline,
    question: resolveDocmeeQuestion(params.requestText),
  }, params.runtimeToken);
  const finalMarkdown = pickDocmeeContentText(updated, generatedOutline);
  const pptInfo = await params.client.generatePptx({
    id: task.id,
    markdown: finalMarkdown,
    templateId: params.templateId,
  }, params.runtimeToken);
  const latestData = await params.client.latestData(task.id, params.runtimeToken).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const convertResult = await params.client.getConvertResult(task.id, params.runtimeToken).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const downloaded = await params.client.downloadPptxBinary(pptInfo.id, params.runtimeToken);

  writeText(params.outputDir, 'generated-content.md', generatedOutline);
  writeText(params.outputDir, 'final-markdown.md', finalMarkdown);
  writeJson(params.outputDir, 'generated-content.json', generated);
  writeJson(params.outputDir, 'updated-content.json', updated);
  writeJson(params.outputDir, 'latest-data.json', latestData);
  writeJson(params.outputDir, 'convert-result.json', convertResult);
  writeJson(params.outputDir, 'ppt-info.json', pptInfo);
  writeFileSync(join(params.outputDir, 'final.pptx'), downloaded.file);

  return {
    taskId: task.id,
    pptId: pptInfo.id,
    templateId: pptInfo.templateId || downloaded.metadata.templateId || params.templateId || null,
    finalMarkdownLength: finalMarkdown.length,
    finalMarkdownPath: join(params.outputDir, 'final-markdown.md'),
    pptPath: join(params.outputDir, 'final.pptx'),
  };
}

async function runOfficialChain(params: {
  client: DocmeeClient;
  runtimeToken: string;
  sourcePath: string;
  templateId?: string;
  prompt: string;
  outputDir: string;
}) {
  const task = await params.client.createTask({
    type: 2,
    files: [
      {
        fileName: basename(params.sourcePath),
        file: readFileSync(params.sourcePath),
        mimeType: 'text/markdown; charset=utf-8',
      },
    ],
  }, params.runtimeToken);
  const options = await params.client.options(params.runtimeToken);
  const scene = resolveDocmeeOptionValue(options.scene, '公司介绍', '公司介绍');
  const audience = resolveDocmeeOptionValue(options.audience, '大众', '大众');
  const lang = resolveDocmeeOptionValue(options.lang, 'zh', 'zh');
  const generated = await params.client.generateContent({
    id: task.id,
    stream: true,
    outlineType: 'JSON',
    questionMode: false,
    isNeedAsk: false,
    length: 'short',
    scene,
    audience,
    lang,
    prompt: params.prompt,
    aiSearch: false,
    isGenImg: false,
  }, params.runtimeToken);
  if (typeof generated.result === 'undefined') {
    throw new Error('Docmee generateContent 未返回 result');
  }

  const {
    aiLayout,
    latestData,
    convertResult,
    latestDataError,
    convertResultError,
    layoutState,
  } = await runOfficialDocmeeLayoutFlow({
    docmeeClient: params.client,
    taskId: task.id,
    runtimeToken: params.runtimeToken,
    data: generated.result,
    templateId: params.templateId,
  });
  const markdownGenerated = await params.client.generateContent({
    id: task.id,
    stream: false,
    outlineType: 'MD',
    questionMode: false,
    isNeedAsk: false,
    length: 'short',
    scene,
    audience,
    lang,
    prompt: params.prompt,
    aiSearch: false,
    isGenImg: false,
  }, params.runtimeToken);
  const finalMarkdown = pickDocmeeContentText(markdownGenerated);
  const pptInfo = await params.client.generatePptx({
    id: task.id,
    markdown: finalMarkdown,
    templateId: params.templateId,
  }, params.runtimeToken);
  const downloaded = await params.client.downloadPptxBinary(pptInfo.id, params.runtimeToken);

  writeJson(params.outputDir, 'generateContent.result.json', generated.result);
  writeJson(params.outputDir, 'generateContent.full.json', generated);
  writeJson(params.outputDir, 'generateContent.md.json', markdownGenerated);
  writeText(params.outputDir, 'generatePptxByAi.sse.log', aiLayout.streamLog);
  writeJson(params.outputDir, 'generatePptxByAi.final.json', aiLayout.finalEventData ?? null);
  writeJson(params.outputDir, 'latest-data.json', latestData);
  writeJson(params.outputDir, 'convert-result.json', convertResult);
  writeJson(params.outputDir, 'polling-state.json', {
    latestDataError,
    convertResultError,
    layoutStatus: layoutState.status,
    layoutSource: layoutState.source,
  });
  writeText(params.outputDir, 'final-markdown.md', finalMarkdown);
  writeJson(params.outputDir, 'ppt-info.json', pptInfo);
  writeFileSync(join(params.outputDir, 'final.pptx'), downloaded.file);

  return {
    taskId: task.id,
    pptId: pptInfo.id,
    templateId: pptInfo.templateId || downloaded.metadata.templateId || params.templateId || null,
    finalMarkdownLength: finalMarkdown.length,
    finalMarkdownSource: 'markdown_generate',
    convertStatus: layoutState.status,
    finalMarkdownPath: join(params.outputDir, 'final-markdown.md'),
    pptPath: join(params.outputDir, 'final.pptx'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadAppConfig();
  if (!config.docmee.apiKey) {
    throw new Error('DOCMEE_API_KEY 未配置，无法执行 Docmee V2 诊断');
  }

  if (!existsSync(args.input)) {
    throw new Error(`输入文件不存在: ${args.input}`);
  }
  if (extname(args.input).toLowerCase() !== '.md') {
    throw new Error(`当前仅支持 .md 输入: ${args.input}`);
  }

  const enterpriseState = readEnterprisePromptState(config.meta.envFilePath);
  const resolvedPrompt = resolveSuperPptPrompt(args.prompt || enterpriseState.storedPrompt || DEFAULT_SUPER_PPT_PROMPT);
  const templateId = args.templateId || enterpriseState.templateId || undefined;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = args.outputDir
    ? resolve(args.outputDir)
    : resolve(config.meta.rootDir, '.local/docmee-diagnostics', timestamp);
  ensureOutputDir(outputDir);

  const currentChainDir = join(outputDir, 'current-chain');
  const officialChainDir = join(outputDir, 'official-v2-main-flow');
  ensureOutputDir(currentChainDir);
  ensureOutputDir(officialChainDir);

  const currentLogs: FetchLogEntry[] = [];
  const officialLogs: FetchLogEntry[] = [];
  const currentClient = new DocmeeClient({
    baseUrl: config.docmee.baseUrl,
    apiKey: config.docmee.apiKey,
    fetchImpl: createLoggedFetch(currentLogs),
  });
  const officialClient = new DocmeeClient({
    baseUrl: config.docmee.baseUrl,
    apiKey: config.docmee.apiKey,
    fetchImpl: createLoggedFetch(officialLogs),
  });
  const sourceMarkdown = readFileSync(args.input, 'utf8');

  const currentRuntimeToken = await createSuperPptRuntimeToken(currentClient, 'diagnose-current');
  const currentResult = await (async () => {
    try {
      return await runCurrentChain({
        client: currentClient,
        runtimeToken: currentRuntimeToken,
        sourcePath: args.input,
        sourceMarkdown,
        templateId,
        prompt: resolvedPrompt.effectivePrompt,
        requestText: args.requestText,
        outputDir: currentChainDir,
      });
    } finally {
      writeJson(currentChainDir, 'http-trace.json', currentLogs);
    }
  })();

  const officialRuntimeToken = await createSuperPptRuntimeToken(officialClient, 'diagnose-official');
  const officialResult = await (async () => {
    try {
      return await runOfficialChain({
        client: officialClient,
        runtimeToken: officialRuntimeToken,
        sourcePath: args.input,
        templateId,
        prompt: resolvedPrompt.effectivePrompt,
        outputDir: officialChainDir,
      });
    } finally {
      writeJson(officialChainDir, 'http-trace.json', officialLogs);
    }
  })();

  writeJson(outputDir, 'summary.json', {
    input: args.input,
    outputDir,
    templateId: templateId || null,
    prompt: resolvedPrompt,
    sourceFileName: basename(args.input),
    sourceMarkdownCharLength: sourceMarkdown.length,
    currentChain: currentResult,
    officialV2MainFlow: officialResult,
  });

  console.log([
    `Docmee V2 诊断完成`,
    `- 输出目录: ${outputDir}`,
    `- 当前链路 PPT: ${currentResult.pptPath}`,
    `- 官方链路 PPT: ${officialResult.pptPath}`,
    `- 当前链路 markdown 长度: ${currentResult.finalMarkdownLength}`,
    `- 官方链路 markdown 长度: ${officialResult.finalMarkdownLength}`,
    `- 官方链路 markdown 来源: ${officialResult.finalMarkdownSource}`,
  ].join('\n'));
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
