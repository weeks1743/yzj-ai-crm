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
    path: '/records',
    hideInMenu: true,
    redirect: '/skills/record-skills',
  },
  {
    path: '/records/customers',
    hideInMenu: true,
    component: './records/[objectType]',
  },
  {
    path: '/records/contacts',
    hideInMenu: true,
    component: './records/[objectType]',
  },
  {
    path: '/records/opportunities',
    hideInMenu: true,
    component: './records/[objectType]',
  },
  {
    path: '/records/followups',
    hideInMenu: true,
    component: './records/[objectType]',
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
        name: '记录系统技能',
        path: '/skills/record-skills',
        icon: 'api',
        component: './skills/record-skills/index',
      },
      {
        path: '/skills/record-skills/:objectKey',
        hideInMenu: true,
        component: './skills/record-skills/[objectKey]',
      },
      {
        name: '场景组装准备',
        path: '/skills/scene-assembly',
        icon: 'deploymentUnit',
        component: './skills/scene-assembly/index',
      },
      {
        path: '/skills/scene-assembly/:sceneKey',
        hideInMenu: true,
        component: './skills/scene-assembly/[sceneKey]',
      },
      {
        name: '外部技能',
        path: '/skills/external-skills',
        icon: 'cloud',
        component: './skills/[skillPage]',
      },
      {
        path: '/skills/external-skills/super-ppt/editor',
        hideInMenu: true,
        layout: false,
        component: './skills/external-skills/super-ppt/editor',
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
        name: '企业PPT模板',
        path: '/settings/ppt-templates',
        icon: 'filePpt',
        component: './settings/ppt-templates/index',
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
