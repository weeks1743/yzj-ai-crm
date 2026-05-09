import type { AppConfig } from './contracts.js';

export interface AgentIsolationTenant {
  eid: string;
  appId: string;
}

export function resolveAgentIsolationTenant(
  config: AppConfig,
  input: { eid?: string | null } = {},
): AgentIsolationTenant {
  return {
    eid: input.eid?.trim() || config.yzj.eid,
    appId: config.yzj.lightCloud.appId.trim() || config.yzj.appId,
  };
}

export function buildAgentIsolationKey(config: AppConfig, input: { eid?: string | null } = {}): string {
  const tenant = resolveAgentIsolationTenant(config, input);
  return `${tenant.eid}:${tenant.appId}`;
}

export function resolveLegacyAgentAppIds(config: AppConfig): string[] {
  const canonicalAppId = resolveAgentIsolationTenant(config).appId;
  const seen = new Set<string>();
  return [config.yzj.appId]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || value === canonicalAppId || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}
