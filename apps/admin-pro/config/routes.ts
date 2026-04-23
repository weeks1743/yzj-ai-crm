export default [
  {
    path: '/',
    redirect: '/dashboard/analysis',
  },
  {
    name: '运营看板',
    path: '/dashboard',
    icon: 'dashboard',
    routes: [
      {
        path: '/dashboard',
        redirect: '/dashboard/analysis',
      },
      {
        name: '分析页',
        path: '/dashboard/analysis',
        icon: 'barChart',
        component: './dashboard/analysis',
      },
      {
        name: '运行监控',
        path: '/dashboard/monitor',
        icon: 'monitor',
        component: './dashboard/monitor',
      },
      {
        name: '工作台',
        path: '/dashboard/workplace',
        icon: 'desktop',
        component: './dashboard/workplace',
      },
    ],
  },
  {
    name: '记录系统',
    path: '/records',
    icon: 'database',
    routes: [
      {
        name: '客户',
        path: '/records/customers',
        icon: 'team',
        component: './records/[objectType]',
      },
      {
        name: '联系人',
        path: '/records/contacts',
        icon: 'user',
        component: './records/[objectType]',
      },
      {
        name: '商机',
        path: '/records/opportunities',
        icon: 'wallet',
        component: './records/[objectType]',
      },
      {
        name: '商机跟进记录',
        path: '/records/followups',
        icon: 'profile',
        component: './records/[objectType]',
      },
    ],
  },
  {
    name: 'AI 资产',
    path: '/assets',
    icon: 'appstore',
    routes: [
      {
        name: '会话任务',
        path: '/assets/sessions',
        icon: 'message',
        component: './assets/[assetType]',
      },
      {
        name: '录音分析资产',
        path: '/assets/audio-analysis',
        icon: 'audio',
        component: './assets/[assetType]',
      },
      {
        name: '公司研究快照',
        path: '/assets/research-snapshots',
        icon: 'book',
        component: './assets/[assetType]',
      },
      {
        name: '拜访材料结果',
        path: '/assets/visit-briefs',
        icon: 'fileSearch',
        component: './assets/[assetType]',
      },
    ],
  },
  {
    name: '技能与编排',
    path: '/skills',
    icon: 'tool',
    routes: [
      {
        name: '工具注册表',
        path: '/skills/tool-registry',
        icon: 'api',
        component: './skills/[skillPage]',
      },
      {
        name: '场景技能',
        path: '/skills/scene-skills',
        icon: 'deploymentUnit',
        component: './skills/[skillPage]',
      },
      {
        name: '外部技能',
        path: '/skills/external-skills',
        icon: 'cloud',
        component: './skills/[skillPage]',
      },
      {
        name: '写回确认策略',
        path: '/skills/writeback-policies',
        icon: 'safetyCertificate',
        component: './skills/[skillPage]',
      },
    ],
  },
  {
    name: '系统设置',
    path: '/settings',
    icon: 'setting',
    routes: [
      {
        name: '租户 / 应用',
        path: '/settings/tenant-app',
        icon: 'cluster',
        component: './settings/[settingKey]',
      },
      {
        name: '云之家接入',
        path: '/settings/yzj-auth',
        icon: 'api',
        component: './settings/[settingKey]',
      },
      {
        name: '组织同步',
        path: '/settings/org-sync',
        icon: 'apartment',
        component: './settings/[settingKey]',
      },
      {
        name: '模型 / 转写 / 研究 / 存储',
        path: '/settings/models',
        icon: 'robot',
        component: './settings/[settingKey]',
      },
      {
        name: '可观测性',
        path: '/settings/observability',
        icon: 'fundProjectionScreen',
        component: './settings/[settingKey]',
      },
      {
        name: '安全与运营',
        path: '/settings/security',
        icon: 'safety',
        component: './settings/[settingKey]',
      },
    ],
  },
  {
    path: '/*',
    component: '404',
  },
];
