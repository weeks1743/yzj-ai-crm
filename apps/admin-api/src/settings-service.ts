import type {
  AppConfig,
  TenantAppSettingsResponse,
  YzjAuthSettingsResponse,
} from './contracts.js';
import { maskValue } from './mask.js';

export function getTenantAppSettings(config: AppConfig): TenantAppSettingsResponse {
  return {
    eid: config.yzj.eid,
    appId: config.yzj.appId,
    appName: 'AI销售助手',
    enabled: true,
    configSource: config.meta.configSource,
    isolationKey: `${config.yzj.eid}:${config.yzj.appId}`,
  };
}

export function getYzjAuthSettings(config: AppConfig): YzjAuthSettingsResponse {
  return {
    yzjServerBaseUrl: config.yzj.baseUrl,
    tokenScope: 'resGroupSecret',
    tokenEndpoint: `${config.yzj.baseUrl}/gateway/oauth2/token/getAccessToken`,
    employeeEndpoint: `${config.yzj.baseUrl}/gateway/openimport/open/person/getall`,
    credentials: [
      {
        key: 'appId',
        label: 'App ID',
        configured: Boolean(config.yzj.appId),
        maskedValue: maskValue(config.yzj.appId),
        description: '用于标识当前自建应用实例，仅展示脱敏摘要。',
      },
      {
        key: 'appSecret',
        label: 'App Secret',
        configured: Boolean(config.yzj.appSecret),
        maskedValue: maskValue(config.yzj.appSecret),
        description: '当前阶段只从本地 .env 读取，不在后台页明文展示。',
      },
      {
        key: 'signKey',
        label: 'Sign Key',
        configured: Boolean(config.yzj.signKey),
        maskedValue: maskValue(config.yzj.signKey),
        description: '用于后续签名校验预留，本轮只读展示配置状态。',
      },
      {
        key: 'orgReadSecret',
        label: '组织可读密钥',
        configured: Boolean(config.yzj.orgReadSecret),
        maskedValue: maskValue(config.yzj.orgReadSecret),
        description: '用于换取 resGroupSecret 级别 AccessToken 并发起在职人员全量同步。',
      },
    ],
  };
}
