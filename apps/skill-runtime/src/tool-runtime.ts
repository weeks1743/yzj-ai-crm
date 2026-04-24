import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { checkPptxQuality } from './pptx-quality-check.js';
import { renderDeckToPptx } from './pptx-deck-renderer.js';
import { parseDeckSpec, planDeck, type DeckSpec, type PptxMode } from './pptx-deck.js';
import type {
  ChatCompletionClient,
  ChatMessage,
  ChatToolDefinition,
  FetchLike,
  JobArtifact,
  JobEvent,
  LoadedSkill,
  StoredJobRecord,
  SupportedDeepseekModel,
  WebSearchClient,
} from './contracts.js';
import { BadRequestError, ExternalServiceError } from './errors.js';
import { runLocalCommand } from './local-command.js';
import { assertPathWithinRoots, resolveUserSuppliedPath } from './path-utils.js';
import { fetchAndExtract } from './web-fetch.js';

const DEFAULT_MAX_TOOL_TURNS = 12;
const MAX_FILE_RETURN_CHARS = 40_000;
const PPTX_TEXT_EXTENSIONS = new Set(['.pptx', '.potx']);
const GENERIC_TEXT_EXTENSIONS = new Set([
  '.md',
  '.markdown',
  '.txt',
  '.csv',
  '.json',
  '.yaml',
  '.yml',
  '.html',
  '.htm',
]);
const MARKITDOWN_SOURCE_EXTENSIONS = new Set([
  '.pdf',
  '.docx',
  '.pptx',
  '.potx',
]);

export interface ExecutionPaths {
  jobHomeDir: string;
  workspaceDir: string;
  inputsDir: string;
  outputsDir: string;
  skillDir: string;
  artifactDir: string;
}

export interface ToolExecutionContext {
  job: StoredJobRecord;
  skill: LoadedSkill;
  paths: ExecutionPaths;
  webSearchClient: WebSearchClient;
  fetchImpl?: FetchLike;
  emitEvent(
    type: JobEvent['type'],
    message: string,
    data?: unknown,
  ): void;
  publishTextArtifact(fileName: string, content: string, mimeType?: string): JobArtifact;
  publishFileArtifact(sourcePath: string, fileName?: string, mimeType?: string): JobArtifact;
}

export interface RuntimeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(args: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface ToolExecutionRecord {
  id: string;
  name: string;
  arguments: unknown;
  result: unknown;
  turn: number;
}

export interface ToolLoopResult {
  finalText: string | null;
  turns: number;
  messages: ChatMessage[];
  toolExecutions: ToolExecutionRecord[];
}

interface ToolLoopStopDecision {
  stop: boolean;
  finalText?: string | null;
}

function expectObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestError('tool 参数必须是对象');
  }

  return value as Record<string, unknown>;
}

function expectString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestError(`tool 参数 ${key} 必须是非空字符串`);
  }

  return value.trim();
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new BadRequestError(`tool 参数 ${key} 必须是字符串`);
  }

  return value.trim();
}

function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new BadRequestError(`tool 参数 ${key} 必须是布尔值`);
  }

  return value;
}

function optionalInteger(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value)) {
    throw new BadRequestError(`tool 参数 ${key} 必须是整数`);
  }

  return Number(value);
}

function coerceQualitySlideType(value: unknown): string {
  if (typeof value !== 'string') {
    return 'company_overview';
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  switch (normalized) {
    case 'summary':
    case 'agenda':
    case 'executive_summary':
      return 'agenda_or_summary';
    case 'overview':
    case 'company_profile':
    case 'company_summary':
      return 'company_overview';
    case 'kpi':
    case 'metrics':
      return 'kpi_strip';
    case 'risk':
    case 'risk_grid':
    case 'risk_matrix':
      return 'risk_summary';
    default:
      return normalized;
  }
}

function createQualityCheckDeckSpec(rawValue: unknown): DeckSpec | undefined {
  const root = expectObject(rawValue);
  const rawMeta = root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta)
    ? root.meta as Record<string, unknown>
    : {};
  const rawSlides = Array.isArray(root.slides) ? root.slides : [];

  const slides: DeckSpec['slides'] = [];
  for (const item of rawSlides) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    slides.push({
      type: coerceQualitySlideType((item as Record<string, unknown>).type) as DeckSpec['slides'][number]['type'],
      goal: '',
      headline: '',
      supportingPoints: [],
      evidence: [],
      visualKind: '',
      sourceNote: '',
    });
  }

  if (slides.length === 0) {
    return undefined;
  }

  return {
    meta: {
      title: '',
      subtitle: '',
      audience: '',
      purpose: '',
      language: typeof rawMeta.language === 'string' ? rawMeta.language : '',
    },
    theme: {
      pageRatio: '16:9' as const,
      palette: {
        background: '',
        surface: '',
        surfaceAlt: '',
        text: '',
        muted: '',
        accent: '',
        accentSoft: '',
        success: '',
        warning: '',
        border: '',
        dark: '',
      },
      typography: {
        display: '',
        heading: '',
        body: '',
        monospace: '',
      },
      spacing: {
        safeMarginX: 0.72,
        safeMarginY: 0.5,
        sectionGap: 0.24,
        cardGap: 0.18,
      },
    },
    slides,
  };
}

function truncateText(text: string, maxChars = MAX_FILE_RETURN_CHARS): {
  content: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) {
    return { content: text, truncated: false };
  }

  return {
    content: `${text.slice(0, maxChars)}\n\n...[truncated ${text.length - maxChars} chars]`,
    truncated: true,
  };
}

function readTextFile(pathValue: string): { content: string; truncated: boolean } {
  const content = readFileSync(pathValue, 'utf8');
  return truncateText(content);
}

function resolveReadablePath(
  inputPath: string,
  context: ToolExecutionContext,
): string {
  return resolveUserSuppliedPath(
    inputPath,
    context.paths.workspaceDir,
    [context.paths.workspaceDir, context.paths.inputsDir, context.paths.outputsDir],
    '读取路径',
  );
}

function resolveWritablePath(
  inputPath: string,
  context: ToolExecutionContext,
): string {
  const candidate = inputPath.startsWith('/')
    ? resolve(inputPath)
    : resolve(context.paths.workspaceDir, inputPath);
  return assertPathWithinRoots(
    candidate,
    [context.paths.workspaceDir, context.paths.outputsDir],
    '写入路径',
  );
}

function resolveWritablePathFromBase(
  inputPath: string,
  baseDir: string,
  context: ToolExecutionContext,
): string {
  const candidate = inputPath.startsWith('/')
    ? resolve(inputPath)
    : resolve(baseDir, inputPath);
  return assertPathWithinRoots(candidate, [context.paths.workspaceDir, context.paths.outputsDir], '写入路径');
}

function resolveSkillPath(
  relativePath: string,
  context: ToolExecutionContext,
): string {
  return assertPathWithinRoots(
    resolve(context.paths.skillDir, relativePath),
    [context.paths.skillDir],
    'skill 文件路径',
  );
}

function listFilesWithPrefix(prefixPath: string): string[] {
  const directory = dirname(prefixPath);
  const prefixName = basename(prefixPath);
  try {
    return readdirSync(directory)
      .filter((fileName) => fileName.startsWith(`${prefixName}-`) && fileName.endsWith('.jpg'))
      .map((fileName) => join(directory, fileName))
      .sort();
  } catch {
    return [];
  }
}

function summarizeResult(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateText(value, 3000).content;
  }

  const json = JSON.stringify(value);
  if (json.length <= 3000) {
    return value;
  }

  return truncateText(json, 3000).content;
}

function createReadSkillFileTool(): RuntimeTool {
  return {
    name: 'read_skill_file',
    description: 'Read a text file bundled with the current skill.',
    inputSchema: {
      type: 'object',
      properties: {
        relativePath: {
          type: 'string',
          description: 'Path relative to the skill root, such as template.md or editing.md',
        },
      },
      required: ['relativePath'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const relativePath = expectString(args, 'relativePath');
      const filePath = resolveSkillPath(relativePath, context);
      const { content, truncated } = readTextFile(filePath);
      return {
        path: filePath,
        content,
        truncated,
      };
    },
  };
}

function createReadSourceFileTool(): RuntimeTool {
  return {
    name: 'read_source_file',
    description: 'Read or extract source content from markdown, text, pdf, docx, or pptx inputs.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const sourcePath = resolveReadablePath(expectString(args, 'path'), context);
      const extension = extname(sourcePath).toLowerCase();

      if (GENERIC_TEXT_EXTENSIONS.has(extension)) {
        const { content, truncated } = readTextFile(sourcePath);
        return {
          path: sourcePath,
          extractionMethod: 'utf8',
          content,
          truncated,
        };
      }

      if (MARKITDOWN_SOURCE_EXTENSIONS.has(extension)) {
        const { stdout } = runLocalCommand('python3', ['-m', 'markitdown', sourcePath]);
        const { content, truncated } = truncateText(stdout);
        return {
          path: sourcePath,
          extractionMethod: 'markitdown',
          content,
          truncated,
        };
      }

      throw new BadRequestError(`暂不支持读取该附件类型: ${extension || sourcePath}`);
    },
  };
}

function createReadWorkspaceFileTool(): RuntimeTool {
  return {
    name: 'read_workspace_file',
    description: 'Read a UTF-8 text file from the current job workspace, inputs, or outputs.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const pathValue = expectString(args, 'path');
      const filePath = resolveReadablePath(pathValue, context);
      const { content, truncated } = readTextFile(filePath);
      return {
        path: filePath,
        content,
        truncated,
      };
    },
  };
}

function createWriteWorkspaceFileTool(): RuntimeTool {
  return {
    name: 'write_workspace_file',
    description: 'Write a UTF-8 text file into the current job workspace or outputs directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const pathValue = expectString(args, 'path');
      const content = expectString(args, 'content');
      const filePath = resolveWritablePath(pathValue, context);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
      return {
        path: filePath,
        byteSize: Buffer.byteLength(content, 'utf8'),
      };
    },
  };
}

function createPptxPlanningTool(): RuntimeTool {
  return {
    name: 'pptx_plan_deck',
    description: 'Normalize slide briefs into a concise, business-ready deckSpec with mandatory cover/summary/closing structure. Use only the canonical deck DSL fields: type, headline, goal, supportingPoints, evidence, visualKind, sourceNote.',
    inputSchema: {
      type: 'object',
      properties: {
        meta: {
          type: 'object',
          additionalProperties: true,
        },
        theme: {
          type: 'object',
          additionalProperties: true,
        },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
          },
        },
      },
      required: ['slides'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const result = planDeck(rawArgs);
      context.emitEvent('deck_planned', 'Deck 规划完成', {
        slideCount: result.deckSpec.slides.length,
        notes: result.notes,
      });
      return result;
    },
  };
}

function createPptxRenderDeckTool(): RuntimeTool {
  return {
    name: 'pptx_render_deck',
    description: 'Render a normalized deckSpec into a 16:9 business PPTX using the controlled local renderer. For two_column_claim put left-column points in supportingPoints and right-column points in evidence; for risk_summary put risks in supportingPoints and watch items in evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        deckSpec: {
          type: 'object',
          additionalProperties: true,
        },
        outputPath: {
          type: 'string',
        },
      },
      required: ['deckSpec'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const deckSpec = parseDeckSpec(args.deckSpec);
      const outputPath = resolveWritablePathFromBase(
        optionalString(args, 'outputPath') || 'final-deck.pptx',
        context.paths.outputsDir,
        context,
      );
      const rendered = await renderDeckToPptx({
        deckSpec,
        outputPath,
      });
      context.emitEvent('deck_rendered', 'Deck 已渲染为最终 PPTX', {
        outputPath,
        slideCount: rendered.slideCount,
      });
      return {
        ...rendered,
        deckSpec,
      };
    },
  };
}

function createPptxQualityCheckTool(): RuntimeTool {
  return {
    name: 'pptx_quality_check',
    description: 'Run saved-PPTX structural QA and return a bounded report with failures and warnings.',
    inputSchema: {
      type: 'object',
      properties: {
        pptxPath: { type: 'string' },
        deckSpec: {
          type: 'object',
          additionalProperties: true,
        },
      },
      required: ['pptxPath'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const pptxPath = resolveReadablePath(expectString(args, 'pptxPath'), context);
      let deckSpec;
      if (args.deckSpec) {
        try {
          deckSpec = parseDeckSpec(args.deckSpec);
        } catch {
          deckSpec = createQualityCheckDeckSpec(args.deckSpec);
        }
      }
      const report = checkPptxQuality({
        pptxPath,
        deckSpec,
      });
      context.emitEvent(
        'qa_report',
        report.passed ? 'PPTX QA 通过' : 'PPTX QA 未通过',
        {
          passed: report.passed,
          failures: report.failures,
          warnings: report.warnings,
        },
      );
      return report;
    },
  };
}

function createPptxRenderPreviewsTool(): RuntimeTool {
  return {
    name: 'pptx_render_previews',
    description: 'Render preview artifacts for a PPTX: PDF and per-slide JPG images.',
    inputSchema: {
      type: 'object',
      properties: {
        pptxPath: { type: 'string' },
        outputDir: { type: 'string' },
        outputPrefix: { type: 'string' },
      },
      required: ['pptxPath'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const pptxPath = resolveReadablePath(expectString(args, 'pptxPath'), context);
      const outputDir = resolveWritablePathFromBase(
        optionalString(args, 'outputDir') || dirname(pptxPath),
        context.paths.outputsDir,
        context,
      );
      const outputPrefix = resolveWritablePathFromBase(
        optionalString(args, 'outputPrefix') || join(outputDir, 'slide'),
        context.paths.outputsDir,
        context,
      );
      mkdirSync(outputDir, { recursive: true });

      const sofficeScript = resolveSkillPath('scripts/office/soffice.py', context);
      runLocalCommand('python3', [
        sofficeScript,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outputDir,
        pptxPath,
      ]);

      const pdfPath = join(outputDir, `${basename(pptxPath, extname(pptxPath))}.pdf`);
      runLocalCommand('pdftoppm', ['-jpeg', '-r', '150', pdfPath, outputPrefix]);
      const createdFiles = [pdfPath, ...listFilesWithPrefix(outputPrefix)];
      context.emitEvent('previews_rendered', 'PPTX 预览产物已生成', {
        pdfPath,
        imageCount: createdFiles.length - 1,
      });
      return {
        pdfPath,
        createdFiles,
      };
    },
  };
}

function createPptxExtractTextTool(): RuntimeTool {
  return {
    name: 'pptx_extract_text',
    description: 'Extract text from a .pptx or .potx file using markitdown.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputPath = resolveReadablePath(expectString(args, 'inputPath'), context);
      const extension = extname(inputPath).toLowerCase();
      if (!PPTX_TEXT_EXTENSIONS.has(extension)) {
        throw new BadRequestError('pptx_extract_text 仅支持 .pptx 或 .potx 文件');
      }

      const { stdout } = runLocalCommand('python3', ['-m', 'markitdown', inputPath]);
      const { content, truncated } = truncateText(stdout);
      return {
        inputPath,
        content,
        truncated,
      };
    },
  };
}

function createPptxThumbnailTool(): RuntimeTool {
  return {
    name: 'pptx_thumbnail',
    description: 'Render a PPTX thumbnail grid jpg using the skill bundled script.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string' },
        outputPrefix: { type: 'string' },
        cols: { type: 'integer', minimum: 1, maximum: 6 },
      },
      required: ['inputPath', 'outputPrefix'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputPath = resolveReadablePath(expectString(args, 'inputPath'), context);
      const outputPrefix = resolveWritablePath(expectString(args, 'outputPrefix'), context);
      const cols = optionalInteger(args, 'cols');
      const scriptPath = resolveSkillPath('scripts/thumbnail.py', context);
      const commandArgs = [scriptPath, inputPath, outputPrefix];
      if (cols) {
        commandArgs.push('--cols', String(cols));
      }
      runLocalCommand('python3', commandArgs);
      const createdFiles = [
        `${outputPrefix}.jpg`,
        ...listFilesWithPrefix(outputPrefix),
      ].filter((filePath, index, self) => self.indexOf(filePath) === index && statSync(filePath, { throwIfNoEntry: false })?.isFile());
      return {
        outputPrefix,
        createdFiles,
      };
    },
  };
}

function createOfficeUnpackTool(): RuntimeTool {
  return {
    name: 'office_unpack',
    description: 'Unpack a PPTX file into an editable XML directory.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string' },
        outputDir: { type: 'string' },
      },
      required: ['inputPath', 'outputDir'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputPath = resolveReadablePath(expectString(args, 'inputPath'), context);
      const outputDir = resolveWritablePath(expectString(args, 'outputDir'), context);
      mkdirSync(outputDir, { recursive: true });
      const scriptPath = resolveSkillPath('scripts/office/unpack.py', context);
      const { stdout } = runLocalCommand('python3', [scriptPath, inputPath, outputDir]);
      return {
        inputPath,
        outputDir,
        summary: stdout.trim(),
      };
    },
  };
}

function createOfficePackTool(): RuntimeTool {
  return {
    name: 'office_pack',
    description: 'Pack an unpacked PPTX directory back into a .pptx file.',
    inputSchema: {
      type: 'object',
      properties: {
        inputDir: { type: 'string' },
        outputPath: { type: 'string' },
        originalPath: { type: 'string' },
        validate: { type: 'boolean' },
      },
      required: ['inputDir', 'outputPath'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputDir = resolveReadablePath(expectString(args, 'inputDir'), context);
      const outputPath = resolveWritablePath(expectString(args, 'outputPath'), context);
      const originalPathInput = optionalString(args, 'originalPath');
      const validate = optionalBoolean(args, 'validate');
      mkdirSync(dirname(outputPath), { recursive: true });
      const scriptPath = resolveSkillPath('scripts/office/pack.py', context);
      const commandArgs = [scriptPath, inputDir, outputPath];
      if (originalPathInput) {
        commandArgs.push('--original', resolveReadablePath(originalPathInput, context));
      }
      if (validate !== undefined) {
        commandArgs.push('--validate', String(validate));
      }
      const { stdout } = runLocalCommand('python3', commandArgs);
      return {
        inputDir,
        outputPath,
        summary: stdout.trim(),
      };
    },
  };
}

function createPptxCleanTool(): RuntimeTool {
  return {
    name: 'pptx_clean',
    description: 'Clean orphaned PPTX resources from an unpacked directory.',
    inputSchema: {
      type: 'object',
      properties: {
        inputDir: { type: 'string' },
      },
      required: ['inputDir'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputDir = resolveReadablePath(expectString(args, 'inputDir'), context);
      const scriptPath = resolveSkillPath('scripts/clean.py', context);
      const { stdout } = runLocalCommand('python3', [scriptPath, inputDir]);
      return {
        inputDir,
        summary: stdout.trim(),
      };
    },
  };
}

function createPptxAddSlideTool(): RuntimeTool {
  return {
    name: 'pptx_add_slide',
    description: 'Duplicate an existing slide or create a slide from a layout.',
    inputSchema: {
      type: 'object',
      properties: {
        inputDir: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['inputDir', 'source'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputDir = resolveReadablePath(expectString(args, 'inputDir'), context);
      const source = expectString(args, 'source');
      const scriptPath = resolveSkillPath('scripts/add_slide.py', context);
      const { stdout } = runLocalCommand('python3', [scriptPath, inputDir, source]);
      return {
        inputDir,
        source,
        summary: stdout.trim(),
      };
    },
  };
}

function createOfficeConvertPdfTool(): RuntimeTool {
  return {
    name: 'office_convert_pdf',
    description: 'Convert a PPTX file to PDF using the skill bundled soffice helper.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string' },
        outputDir: { type: 'string' },
      },
      required: ['inputPath'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputPath = resolveReadablePath(expectString(args, 'inputPath'), context);
      const outputDir = resolveWritablePathFromBase(
        optionalString(args, 'outputDir') || context.paths.outputsDir,
        context.paths.outputsDir,
        context,
      );
      mkdirSync(outputDir, { recursive: true });
      const scriptPath = resolveSkillPath('scripts/office/soffice.py', context);
      runLocalCommand('python3', [
        scriptPath,
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        outputDir,
        inputPath,
      ]);
      return {
        inputPath,
        outputPath: join(outputDir, `${basename(inputPath, extname(inputPath))}.pdf`),
      };
    },
  };
}

function createPdfToImageTool(): RuntimeTool {
  return {
    name: 'pdf_to_image',
    description: 'Convert a PDF into per-slide JPEG images using pdftoppm.',
    inputSchema: {
      type: 'object',
      properties: {
        inputPath: { type: 'string' },
        outputPrefix: { type: 'string' },
        firstPage: { type: 'integer', minimum: 1 },
        lastPage: { type: 'integer', minimum: 1 },
      },
      required: ['inputPath', 'outputPrefix'],
      additionalProperties: false,
    },
    async execute(rawArgs, context) {
      const args = expectObject(rawArgs);
      const inputPath = resolveReadablePath(expectString(args, 'inputPath'), context);
      const outputPrefix = resolveWritablePath(expectString(args, 'outputPrefix'), context);
      const firstPage = optionalInteger(args, 'firstPage');
      const lastPage = optionalInteger(args, 'lastPage');
      mkdirSync(dirname(outputPrefix), { recursive: true });
      const commandArgs = ['-jpeg', '-r', '150'];
      if (firstPage) {
        commandArgs.push('-f', String(firstPage));
      }
      if (lastPage) {
        commandArgs.push('-l', String(lastPage));
      }
      commandArgs.push(inputPath, outputPrefix);
      runLocalCommand('pdftoppm', commandArgs);
      return {
        inputPath,
        createdFiles: listFilesWithPrefix(outputPrefix),
      };
    },
  };
}

export function createCompanyResearchTools(): RuntimeTool[] {
  return [
    createReadSkillFileTool(),
    {
      name: 'web_search',
      description: 'Search the web for current public information and citations.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          maxResults: { type: 'integer', minimum: 1, maximum: 10 },
        },
        required: ['query'],
        additionalProperties: false,
      },
      async execute(rawArgs, context) {
        const args = expectObject(rawArgs);
        const query = expectString(args, 'query');
        const maxResults = optionalInteger(args, 'maxResults') ?? 5;
        return context.webSearchClient.search(query, { maxResults });
      },
    },
    {
      name: 'web_fetch_extract',
      description: 'Fetch a web page and extract its main content and links.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async execute(rawArgs, context) {
        const args = expectObject(rawArgs);
        const url = expectString(args, 'url');
        return fetchAndExtract(url, context.fetchImpl);
      },
    },
    {
      name: 'write_text_artifact',
      description: 'Persist the final markdown report as a downloadable artifact.',
      inputSchema: {
        type: 'object',
        properties: {
          fileName: { type: 'string' },
          content: { type: 'string' },
          mimeType: { type: 'string' },
        },
        required: ['fileName', 'content'],
        additionalProperties: false,
      },
      async execute(rawArgs, context) {
        const args = expectObject(rawArgs);
        const fileName = expectString(args, 'fileName');
        const content = expectString(args, 'content');
        const mimeType = optionalString(args, 'mimeType') || 'text/markdown';
        const artifact = context.publishTextArtifact(fileName, content, mimeType);
        return artifact;
      },
    },
  ];
}

export function createPptxTools(mode: PptxMode): RuntimeTool[] {
  const commonTools: RuntimeTool[] = [
    createReadSkillFileTool(),
    createReadSourceFileTool(),
    createPptxQualityCheckTool(),
    createPptxRenderPreviewsTool(),
  ];

  if (mode === 'fresh_deck') {
    return [
      ...commonTools,
      createPptxPlanningTool(),
      createPptxRenderDeckTool(),
    ];
  }

  return [
    ...commonTools,
    createReadWorkspaceFileTool(),
    createWriteWorkspaceFileTool(),
    createPptxExtractTextTool(),
    createPptxThumbnailTool(),
    createOfficeUnpackTool(),
    createOfficePackTool(),
    createPptxCleanTool(),
    createPptxAddSlideTool(),
    createOfficeConvertPdfTool(),
    createPdfToImageTool(),
  ];
}

export async function runToolLoop(options: {
  client: ChatCompletionClient;
  model: SupportedDeepseekModel;
  systemPrompt: string;
  userPrompt: string;
  tools: RuntimeTool[];
  context: ToolExecutionContext;
  maxTurns?: number;
  stopWhen?: (state: {
    turn: number;
    messages: ChatMessage[];
    toolExecutions: ToolExecutionRecord[];
  }) => ToolLoopStopDecision | null;
}): Promise<ToolLoopResult> {
  const toolDefinitions: ChatToolDefinition[] = options.tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }));
  const toolMap = new Map(options.tools.map((tool) => [tool.name, tool]));
  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.userPrompt },
  ];
  const toolExecutions: ToolExecutionRecord[] = [];
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TOOL_TURNS;

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const response = await options.client.createChatCompletion({
      model: options.model,
      messages,
      tools: toolDefinitions,
    });

    messages.push({
      role: 'assistant',
      content: response.content,
      toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
    });

    if (response.content?.trim()) {
      options.context.emitEvent('message', response.content.trim());
    }

    if (response.toolCalls.length === 0) {
      return {
        finalText: response.content,
        turns: turn,
        messages,
        toolExecutions,
      };
    }

    for (const toolCall of response.toolCalls) {
      options.context.emitEvent('tool_call', `调用工具 ${toolCall.name}`, {
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      const tool = toolMap.get(toolCall.name);
      if (!tool) {
        throw new BadRequestError(`未知工具: ${toolCall.name}`);
      }

      let parsedArguments: unknown;
      try {
        parsedArguments = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
      } catch (error) {
        throw new BadRequestError(`工具参数不是合法 JSON: ${toolCall.name}`, {
          cause: error instanceof Error ? error.message : String(error),
          rawArguments: toolCall.arguments,
        });
      }

      const result = await tool.execute(parsedArguments, options.context);
      toolExecutions.push({
        id: toolCall.id,
        name: toolCall.name,
        arguments: parsedArguments,
        result,
        turn,
      });
      options.context.emitEvent('tool_result', `工具 ${toolCall.name} 执行完成`, {
        name: toolCall.name,
        result: summarizeResult(result),
      });

      messages.push({
        role: 'tool',
        toolCallId: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    const stopDecision = options.stopWhen?.({
      turn,
      messages,
      toolExecutions,
    });
    if (stopDecision?.stop) {
      return {
        finalText: stopDecision.finalText ?? response.content ?? null,
        turns: turn,
        messages,
        toolExecutions,
      };
    }
  }

  throw new ExternalServiceError('Tool loop 超出最大轮数，已中止');
}
