import type {
  AgentPlannerInput,
  AgentToolDefinition,
  AgentToolSelection,
  GenericIntentFrame,
  ToolArbitrationCandidateTrace,
  ToolArbitrationProbeControl,
  ToolArbitrationTrace,
} from './agent-core.js';

export interface ToolArbitrationRuleMatch {
  mode: 'direct' | 'ambiguous';
  intentCode: string;
  subjectType?: string;
  subjectName?: string;
  directToolCode?: string;
  reason: string;
  confidence?: number;
}

export interface ToolArbitrationRule {
  ruleCode: string;
  conflictGroup: string;
  priority?: number;
  readOnlyProbeToolCode?: string;
  match(input: {
    query: string;
    intentFrame: GenericIntentFrame;
    contextFrame: AgentPlannerInput['contextFrame'];
    resolvedContext: AgentPlannerInput['resolvedContext'];
  }): ToolArbitrationRuleMatch | null;
  buildToolInput(input: {
    tool: AgentToolDefinition;
    match: ToolArbitrationRuleMatch;
    intentFrame: GenericIntentFrame;
    query: string;
  }): Record<string, unknown>;
}

export interface ToolSemanticArbitrationDecision {
  selectedTool: AgentToolSelection;
  trace: ToolArbitrationTrace;
}

export function arbitrateToolSemantic(input: {
  query: string;
  intentFrame: GenericIntentFrame;
  availableTools: AgentToolDefinition[];
  rules: ToolArbitrationRule[];
  contextFrame?: AgentPlannerInput['contextFrame'];
  resolvedContext?: AgentPlannerInput['resolvedContext'];
}): ToolSemanticArbitrationDecision | null {
  const rules = [...input.rules].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));
  for (const rule of rules) {
    const match = rule.match({
      query: input.query,
      intentFrame: input.intentFrame,
      contextFrame: input.contextFrame ?? null,
      resolvedContext: input.resolvedContext ?? null,
    });
    if (!match) {
      continue;
    }

    const candidates = findCandidates({
      tools: input.availableTools,
      rule,
      match,
    });
    if (!candidates.length) {
      continue;
    }

    const selectedTool = match.mode === 'direct'
      ? resolveDirectTool(match, candidates)
      : resolveProbeTool(rule, candidates);
    if (!selectedTool) {
      continue;
    }

    const trace = buildTrace({
      rule,
      match,
      action: match.mode === 'direct' ? 'direct_tool' : 'read_only_probe',
      selectedTool,
      candidates,
    });
    const toolInput = rule.buildToolInput({
      tool: selectedTool,
      match,
      intentFrame: input.intentFrame,
      query: input.query,
    });

    return {
      selectedTool: {
        toolCode: selectedTool.code,
        reason: match.reason,
        input: match.mode === 'ambiguous'
          ? withToolArbitrationProbeControl(toolInput, {
              enabled: true,
              ruleCode: rule.ruleCode,
              conflictGroup: rule.conflictGroup,
              subjectType: match.subjectType,
              subjectName: match.subjectName,
              intentCode: match.intentCode,
              query: input.query,
              probeToolCode: selectedTool.code,
              candidateToolCodes: candidates.map((tool) => tool.code),
            })
          : toolInput,
        confidence: match.confidence ?? (match.mode === 'direct' ? 0.86 : 0.82),
      },
      trace,
    };
  }
  return null;
}

export function readToolArbitrationProbeControl(input: Record<string, unknown>): ToolArbitrationProbeControl | null {
  const agentControl = readObject(input.agentControl);
  const control = readObject(agentControl.toolArbitrationProbe);
  if (!control.enabled || typeof control.ruleCode !== 'string' || typeof control.conflictGroup !== 'string') {
    return null;
  }
  return {
    enabled: Boolean(control.enabled),
    ruleCode: control.ruleCode,
    conflictGroup: control.conflictGroup,
    subjectType: typeof control.subjectType === 'string' ? control.subjectType : undefined,
    subjectName: typeof control.subjectName === 'string' ? control.subjectName : undefined,
    intentCode: typeof control.intentCode === 'string' ? control.intentCode : undefined,
    query: typeof control.query === 'string' ? control.query : undefined,
    probeToolCode: typeof control.probeToolCode === 'string' ? control.probeToolCode : undefined,
    candidateToolCodes: Array.isArray(control.candidateToolCodes)
      ? control.candidateToolCodes.filter((item): item is string => typeof item === 'string')
      : undefined,
  };
}

export function buildProbeTrace(input: {
  control: ToolArbitrationProbeControl;
  tools: AgentToolDefinition[];
  selectedToolCode: string;
  count: number;
  summary: string;
}): ToolArbitrationTrace {
  const candidates = input.tools.filter((tool) => input.control.candidateToolCodes?.includes(tool.code));
  return {
    usedArbitration: true,
    ruleCode: input.control.ruleCode,
    conflictGroup: input.control.conflictGroup,
    intentCode: input.control.intentCode ?? 'unknown',
    subjectType: input.control.subjectType,
    subjectName: input.control.subjectName,
    action: 'clarify',
    selectedToolCode: input.selectedToolCode,
    probeToolCode: input.control.probeToolCode ?? input.selectedToolCode,
    candidateTools: candidates.map(toCandidateTrace),
    reason: '只读探测已完成，等待用户选择下一步工具。',
    probeResult: {
      status: input.count > 0 ? 'matched' : 'not_matched',
      count: input.count,
      summary: input.summary,
    },
  };
}

function findCandidates(input: {
  tools: AgentToolDefinition[];
  rule: ToolArbitrationRule;
  match: ToolArbitrationRuleMatch;
}): AgentToolDefinition[] {
  return input.tools
    .filter((tool) => {
      const profile = tool.semanticProfile;
      if (!profile?.conflictGroups?.includes(input.rule.conflictGroup)) {
        return false;
      }
      if (input.match.subjectType && profile.subjectTypes?.length && !profile.subjectTypes.includes(input.match.subjectType)) {
        return false;
      }
      if (input.match.intentCode && profile.intentCodes?.length && !profile.intentCodes.includes(input.match.intentCode)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => (right.semanticProfile?.priority ?? 0) - (left.semanticProfile?.priority ?? 0));
}

function resolveDirectTool(
  match: ToolArbitrationRuleMatch,
  candidates: AgentToolDefinition[],
): AgentToolDefinition | null {
  if (match.directToolCode) {
    return candidates.find((tool) => tool.code === match.directToolCode) ?? null;
  }
  return candidates[0] ?? null;
}

function resolveProbeTool(
  rule: ToolArbitrationRule,
  candidates: AgentToolDefinition[],
): AgentToolDefinition | null {
  if (rule.readOnlyProbeToolCode) {
    return candidates.find((tool) => tool.code === rule.readOnlyProbeToolCode) ?? null;
  }
  return candidates.find((tool) => tool.semanticProfile?.readOnlyProbe) ?? null;
}

function buildTrace(input: {
  rule: ToolArbitrationRule;
  match: ToolArbitrationRuleMatch;
  action: ToolArbitrationTrace['action'];
  selectedTool: AgentToolDefinition;
  candidates: AgentToolDefinition[];
}): ToolArbitrationTrace {
  return {
    usedArbitration: true,
    ruleCode: input.rule.ruleCode,
    conflictGroup: input.rule.conflictGroup,
    intentCode: input.match.intentCode,
    subjectType: input.match.subjectType,
    subjectName: input.match.subjectName,
    action: input.action,
    selectedToolCode: input.selectedTool.code,
    probeToolCode: input.action === 'read_only_probe' ? input.selectedTool.code : undefined,
    candidateTools: input.candidates.map(toCandidateTrace),
    reason: input.match.reason,
    probeResult: input.action === 'read_only_probe'
      ? { status: 'not_run' }
      : undefined,
  };
}

function toCandidateTrace(tool: AgentToolDefinition): ToolArbitrationCandidateTrace {
  return {
    toolCode: tool.code,
    type: tool.type,
    provider: tool.provider,
    priority: tool.semanticProfile?.priority ?? 0,
    risk: tool.semanticProfile?.risk,
    clarifyLabel: tool.semanticProfile?.clarifyLabel,
    readOnlyProbe: Boolean(tool.semanticProfile?.readOnlyProbe),
  };
}

function withToolArbitrationProbeControl(
  input: Record<string, unknown>,
  control: ToolArbitrationProbeControl,
): Record<string, unknown> {
  const agentControl = readObject(input.agentControl);
  return {
    ...input,
    agentControl: {
      ...agentControl,
      toolArbitrationProbe: control,
    },
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
