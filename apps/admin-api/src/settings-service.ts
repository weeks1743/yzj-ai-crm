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
    aiApp: {
      appId: config.yzj.appId,
      appName: 'AI销售助手',
      isolationKey: `${config.yzj.eid}:${config.yzj.appId}`,
    },
    lightCloudRecordApp: {
      appId: config.yzj.lightCloud.appId,
      appName: '轻云AI销售助手记录系统',
      configured: Boolean(
        config.yzj.lightCloud.appId
        && config.yzj.lightCloud.appSecret
        && config.yzj.lightCloud.secret,
      ),
    },
  };
}

export function getYzjAuthSettings(config: AppConfig): YzjAuthSettingsResponse {
  return {
    yzjServerBaseUrl: config.yzj.baseUrl,
    tokenScopes: ['app', 'team', 'resGroupSecret'],
    tokenEndpoint: `${config.yzj.baseUrl}/gateway/oauth2/token/getAccessToken`,
    ticketResolveEndpoint: `${config.yzj.baseUrl}/gateway/ticket/user/acquirecontext`,
    employeeEndpoint: `${config.yzj.baseUrl}/gateway/openimport/open/person/getall`,
    lightCloudEndpoint: `${config.yzj.baseUrl}/gateway/lightcloud/data`,
    credentials: [
      {
        key: 'aiAppId',
        label: 'AI轻应用 App ID',
        configured: Boolean(config.yzj.appId),
        maskedValue: maskValue(config.yzj.appId),
        description: '用于云之家轻应用 SSO、AI 会话和 Agent 运行隔离。',
        group: 'ai_app',
      },
      {
        key: 'aiAppSecret',
        label: 'AI轻应用 App Secret',
        configured: Boolean(config.yzj.appSecret),
        maskedValue: maskValue(config.yzj.appSecret),
        description: '用于换取 app 级 AccessToken 并解析一次性 ticket。',
        group: 'ai_app',
      },
      {
        key: 'aiSignKey',
        label: 'AI轻应用 Sign Key',
        configured: Boolean(config.yzj.signKey),
        maskedValue: maskValue(config.yzj.signKey),
        description: 'AI轻应用签名密钥，本轮只读展示配置状态。',
        group: 'ai_app',
      },
      {
        key: 'lightCloudAppId',
        label: '记录系统 App ID',
        configured: Boolean(config.yzj.lightCloud.appId),
        maskedValue: maskValue(config.yzj.lightCloud.appId),
        description: '轻云AI销售助手记录系统应用，用于记录对象读写。',
        group: 'lightcloud_record_app',
      },
      {
        key: 'lightCloudAppSecret',
        label: '记录系统 App Secret',
        configured: Boolean(config.yzj.lightCloud.appSecret),
        maskedValue: maskValue(config.yzj.lightCloud.appSecret),
        description: '用于换取轻云 team 级 AccessToken。',
        group: 'lightcloud_record_app',
      },
      {
        key: 'lightCloudSecret',
        label: '记录系统 Sign Key',
        configured: Boolean(config.yzj.lightCloud.secret),
        maskedValue: maskValue(config.yzj.lightCloud.secret),
        description: '轻云记录系统密钥，保持与 AI 轻应用密钥隔离。',
        group: 'lightcloud_record_app',
      },
      {
        key: 'orgReadSecret',
        label: '组织可读密钥',
        configured: Boolean(config.yzj.orgReadSecret),
        maskedValue: maskValue(config.yzj.orgReadSecret),
        description: '用于换取 resGroupSecret 级别 AccessToken 并发起在职人员全量同步。',
        group: 'org_sync',
      },
    ],
  };
}
