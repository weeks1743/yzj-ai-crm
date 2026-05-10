export default [
  {
    path: '/',
    redirect: '/dashboard/analysis',
  },
  {
    name: '分析运营看板',
    path: '/dashboard/analysis',
    icon: 'dashboard',
    component: './dashboard/analysis',
  },
  {
    path: '/dashboard',
    hideInMenu: true,
    redirect: '/dashboard/analysis',
  },
  {
    path: '/dashboard/monitor',
    hideInMenu: true,
    redirect: '/dashboard/analysis',
  },
  {
    path: '/dashboard/workplace',
    hideInMenu: true,
    redirect: '/dashboard/analysis',
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
    name: '技能目录',
    path: '/skills',
    icon: 'appstoreAdd',
    routes: [
      {
        path: '/skills',
        redirect: '/skills/record-skills',
      },
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
        name: '外部技能',
        path: '/skills/external-skills',
        icon: 'cloud',
        component: './skills/[skillPage]',
      },
    ],
  },
  {
    name: 'Agent 治理',
    path: '/agent-governance',
    icon: 'tool',
    routes: [
      {
        path: '/agent-governance',
        redirect: '/agent-governance/tools-objects',
      },
      {
        name: '工具与对象',
        path: '/agent-governance/tools-objects',
        icon: 'api',
        component: './agent-governance/[governancePage]',
      },
      {
        path: '/agent-governance/tools-objects/:objectKey',
        hideInMenu: true,
        component: './skills/record-skills/[objectKey]',
      },
      {
        path: '/agent-governance/sessions',
        hideInMenu: true,
        redirect: '/agent-governance/runtime-observability',
      },
      {
        path: '/agent-governance/plan-templates',
        hideInMenu: true,
        redirect: '/agent-governance/tools-objects',
      },
      {
        path: '/agent-governance/policies-confirmation',
        hideInMenu: true,
        redirect: '/agent-governance/runtime-observability',
      },
      {
        name: '运行观测',
        path: '/agent-governance/runtime-observability',
        icon: 'fundProjectionScreen',
        component: './agent-governance/[governancePage]',
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
        name: '录音处理服务',
        path: '/settings/recording-service',
        icon: 'audio',
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
        path: '/settings/models',
        hideInMenu: true,
        redirect: '/agent-governance/tools-objects',
      },
      {
        path: '/settings/observability',
        hideInMenu: true,
        redirect: '/agent-governance/runtime-observability',
      },
      {
        path: '/settings/security',
        hideInMenu: true,
        redirect: '/agent-governance/runtime-observability',
      },
    ],
  },
  {
    path: '/skills/scene-assembly',
    hideInMenu: true,
    redirect: '/agent-governance/tools-objects',
  },
  {
    path: '/skills/scene-assembly/:sceneKey',
    hideInMenu: true,
    redirect: '/agent-governance/tools-objects',
  },
  {
    path: '/skills/writeback-policies',
    hideInMenu: true,
    redirect: '/agent-governance/runtime-observability',
  },
  {
    path: '/assets',
    hideInMenu: true,
    redirect: '/agent-governance/runtime-observability',
  },
  {
    path: '/assets/sessions',
    hideInMenu: true,
    redirect: '/agent-governance/runtime-observability',
  },
  {
    path: '/*',
    component: '404',
  },
];
