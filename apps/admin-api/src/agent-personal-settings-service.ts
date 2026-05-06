import type { QueryResultRow } from 'pg';
import type {
  AgentPersonalSettingsResponse,
  AgentPersonalSettingsUpdateRequest,
  AppConfig,
} from './contracts.js';
import type { DatabaseConnection } from './database.js';
import { BadRequestError } from './errors.js';
import type { OrgSyncRepository } from './org-sync-repository.js';

export const DEFAULT_SOUL_PROMPT = `我是金蝶云之家的销售，主推“制造业一体化协同办公平台解决方案”。当我研究客户公司、生成销售速览、拜访建议或后续跟进内容时，请始终站在金蝶云之家销售推进视角，而不是只做中立公司百科摘要。

我方方案核心价值：
- 帮助制造企业建设一体化协同办公平台，围绕统一平台、统一流程、统一沟通协作、统一业务管理、统一数据分析和业务安全管控展开。
- 重点解决异构系统多、账号入口分散、人找事效率低、流程不规范、业务断点多、数据割裂、文件共享不安全、知识沉淀不足等问题。
- 重点能力包括三端统一门户、千人千面门户、流程引擎、知识中心、AI 智能知识助理、融合中心、ERP/OA 单据融合、群组业务协作、轻云零代码、BI 与流程效率分析、登录/文件/群组/操作安全。
- 面向制造业时，优先关注离散制造和流程制造的不同痛点：研发、生产、采购、销售、质量、供应链、仓储、设备维保、费用管控、文控体系和跨部门协同。

输出要求：
- 不要泛泛介绍客户公司，要把客户公开信息转成销售可用判断。
- 优先输出可能痛点、我方切入点、建议提问、潜在异议和下一步推进动作。
- 用“公开资料事实”和“销售判断/建议”区分确定信息与推断。
- 语言务实、具体、适合销售拜访前快速阅读。`;

const TEST_OPERATOR_OPEN_ID = '69e75eb5e4b0e65b61c014da';
const TEST_OPERATOR_DISPLAY_NAME = '陈伟棠';
const DEFAULT_ROLE_LABEL = '金蝶云之家销售';

interface AgentPersonalSettingsRow extends QueryResultRow {
  soul_prompt: string;
  updated_at: string;
}

export class AgentPersonalSettingsService {
  constructor(
    private readonly options: {
      config: AppConfig;
      database: DatabaseConnection;
      orgSyncRepository?: Pick<OrgSyncRepository, 'findEmployees'>;
    },
  ) {}

  async getSettings(operatorOpenId?: string): Promise<AgentPersonalSettingsResponse> {
    const normalizedOpenId = normalizeOperatorOpenId(operatorOpenId);
    const row = await this.options.database.queryMaybeOne<AgentPersonalSettingsRow>(
      `
        SELECT soul_prompt, updated_at
        FROM ${this.options.database.table('agent_personal_settings')}
        WHERE eid = $1 AND operator_open_id = $2
      `,
      [this.options.config.yzj.eid, normalizedOpenId],
    );

    return this.buildResponse(normalizedOpenId, row);
  }

  async updateSettings(request: AgentPersonalSettingsUpdateRequest): Promise<AgentPersonalSettingsResponse> {
    const normalizedOpenId = normalizeOperatorOpenId(request.operatorOpenId);
    const soulPrompt = request.soulPrompt?.trim() ?? '';
    const now = new Date().toISOString();

    if (!soulPrompt) {
      await this.options.database.query(
        `
          DELETE FROM ${this.options.database.table('agent_personal_settings')}
          WHERE eid = $1 AND operator_open_id = $2
        `,
        [this.options.config.yzj.eid, normalizedOpenId],
      );
      return this.buildResponse(normalizedOpenId, null);
    }

    const row = await this.options.database.queryOne<AgentPersonalSettingsRow>(
      `
        INSERT INTO ${this.options.database.table('agent_personal_settings')} (
          eid,
          app_id,
          operator_open_id,
          soul_prompt,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (eid, operator_open_id)
        DO UPDATE SET
          app_id = EXCLUDED.app_id,
          soul_prompt = EXCLUDED.soul_prompt,
          updated_at = EXCLUDED.updated_at
        RETURNING soul_prompt, updated_at
      `,
      [
        this.options.config.yzj.eid,
        this.options.config.yzj.appId,
        normalizedOpenId,
        soulPrompt,
        now,
      ],
    );

    return this.buildResponse(normalizedOpenId, row);
  }

  private async buildResponse(
    operatorOpenId: string,
    row: AgentPersonalSettingsRow | null,
  ): Promise<AgentPersonalSettingsResponse> {
    return {
      eid: this.options.config.yzj.eid,
      appId: this.options.config.yzj.appId,
      operatorOpenId,
      displayName: await this.resolveDisplayName(operatorOpenId),
      roleLabel: DEFAULT_ROLE_LABEL,
      soulPrompt: row?.soul_prompt?.trim() || DEFAULT_SOUL_PROMPT,
      isDefaultSoulPrompt: !row?.soul_prompt?.trim(),
      updatedAt: row?.updated_at ?? null,
    };
  }

  private async resolveDisplayName(operatorOpenId: string): Promise<string> {
    const candidates = await this.options.orgSyncRepository?.findEmployees({
      eid: this.options.config.yzj.eid,
      appId: this.options.config.yzj.appId,
      keyword: operatorOpenId,
      limit: 5,
    }) ?? [];
    const exact = candidates.find((candidate) => candidate.openId === operatorOpenId);
    if (exact?.name?.trim()) {
      return exact.name.trim();
    }
    if (operatorOpenId === TEST_OPERATOR_OPEN_ID) {
      return TEST_OPERATOR_DISPLAY_NAME;
    }
    return '当前用户';
  }
}

function normalizeOperatorOpenId(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new BadRequestError('operatorOpenId 不能为空');
  }
  return normalized;
}
