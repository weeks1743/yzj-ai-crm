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
        name: '会话任务',
        path: '/agent-governance/sessions',
        icon: 'message',
        component: './assets/[assetType]',
      },
      {
        name: '计划模板',
        path: '/agent-governance/plan-templates',
        icon: 'deploymentUnit',
        component: './agent-governance/[governancePage]',
      },
      {
        name: '策略与确认',
        path: '/agent-governance/policies-confirmation',
        icon: 'safetyCertificate',
        component: './agent-governance/[governancePage]',
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
        redirect: '/agent-governance/policies-confirmation',
      },
    ],
  },
  {
    path: '/skills/external-skills/super-ppt/editor',
    hideInMenu: true,
    layout: false,
    component: './skills/external-skills/super-ppt/editor',
  },
  {
    path: '/skills/scene-assembly',
    hideInMenu: true,
    redirect: '/agent-governance/plan-templates',
  },
  {
    path: '/skills/writeback-policies',
    hideInMenu: true,
    redirect: '/agent-governance/policies-confirmation',
  },
  {
    path: '/assets',
    hideInMenu: true,
    redirect: '/agent-governance/sessions',
  },
  {
    path: '/assets/sessions',
    hideInMenu: true,
    redirect: '/agent-governance/sessions',
  },
  {
    path: '/*',
    component: '404',
  },
];
