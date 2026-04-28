import type { AgentToolDefinition, AgentToolType } from './agent-core.js';

export const GENERIC_TOOL_CONTRACTS = [
  'record.object.search',
  'record.object.get',
  'record.object.preview_create',
  'record.object.preview_update',
  'record.object.commit_create',
  'record.object.commit_update',
  'external.company_research',
  'artifact.search',
  'meta.clarify_card',
  'meta.candidate_selection',
  'meta.plan_builder',
  'meta.confirm_writeback',
] as const;

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentToolDefinition>();

  register(tool: AgentToolDefinition): void {
    if (!tool.code.trim()) {
      throw new Error('Tool code cannot be empty');
    }
    if (tool.code.startsWith('scene.')) {
      throw new Error(`Runtime Tool Registry cannot register scene.* tools: ${tool.code}`);
    }
    if (this.tools.has(tool.code)) {
      throw new Error(`Duplicate tool code: ${tool.code}`);
    }

    this.tools.set(tool.code, tool);
  }

  list(type?: AgentToolType): AgentToolDefinition[] {
    const allTools = [...this.tools.values()].filter((tool) => tool.enabled);
    return type ? allTools.filter((tool) => tool.type === type) : allTools;
  }

  get(toolCode: string): AgentToolDefinition | undefined {
    const tool = this.tools.get(toolCode);
    return tool?.enabled ? tool : undefined;
  }

  assert(toolCode: string): AgentToolDefinition {
    const tool = this.get(toolCode);
    if (!tool) {
      throw new Error(`Unknown or disabled agent tool: ${toolCode}`);
    }
    return tool;
  }

  hasSceneTools(): boolean {
    return [...this.tools.keys()].some((code) => code.startsWith('scene.'));
  }
}
