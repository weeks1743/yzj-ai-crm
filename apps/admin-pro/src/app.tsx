import {
  BellOutlined,
  ClusterOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { RunTimeLayoutConfig } from '@umijs/max';
import { Link } from '@umijs/max';
import { Avatar, Button, Space, Tag, Tooltip } from 'antd';
import { tenantContext } from '@shared';

const adminBrandTitle = 'AI销售助手管理侧';

const AiTrendLogo = () => (
  <svg
    width="36"
    height="36"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="ai-sales-admin-logo" x1="8" y1="6" x2="40" y2="42" gradientUnits="userSpaceOnUse">
        <stop stopColor="#0EA5E9" />
        <stop offset="1" stopColor="#1D4ED8" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="40" height="40" rx="14" fill="url(#ai-sales-admin-logo)" />
    <rect x="12" y="27" width="4.5" height="9" rx="2.25" fill="rgba(255,255,255,0.78)" />
    <rect x="20" y="22" width="4.5" height="14" rx="2.25" fill="rgba(255,255,255,0.84)" />
    <rect x="28" y="17" width="4.5" height="19" rx="2.25" fill="rgba(255,255,255,0.9)" />
    <path
      d="M11.5 18.5L18.5 16L24.5 20L36 12.5"
      stroke="white"
      strokeWidth="2.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="36" cy="12.5" r="2.3" fill="#F8FAFC" />
  </svg>
);

export async function getInitialState() {
  return {
    tenantContext,
    settings: {
      colorPrimary: '#1677ff',
    },
  };
}

export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  return {
    menu: {
      locale: false,
    },
    title: adminBrandTitle,
    layout: 'mix',
    contentWidth: 'Fluid',
    fixedHeader: true,
    fixSiderbar: true,
    logo: false,
    bgLayoutImgList: [
      {
        src: 'https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/D2LWSqNny4sAAAAAAAAAAAAAFl94AQBr',
        left: 85,
        bottom: 100,
        height: '303px',
      },
      {
        src: 'https://mdn.alipayobjects.com/huamei_iwk9zp/afts/img/C2TWRpJpiC0AAAAAAAAAAAAAFl94AQBr',
        bottom: -68,
        right: -45,
        height: '303px',
      },
    ],
    actionsRender: () => [
      <Tag key="tenant" color="blue" bordered={false}>
        {initialState?.tenantContext?.tenantName}
      </Tag>,
      <Tag key="eid" bordered={false}>
        <ClusterOutlined /> {initialState?.tenantContext?.eid}
      </Tag>,
      <Tooltip key="notice" title="系统通知">
        <Button type="text" icon={<BellOutlined />} />
      </Tooltip>,
      <Tooltip key="help" title="查看产品说明">
        <Button type="text" icon={<QuestionCircleOutlined />} />
      </Tooltip>,
    ],
    avatarProps: {
      src: undefined,
      title: initialState?.tenantContext?.owner,
      render: (_, children) => (
        <Space>
          <Avatar style={{ backgroundColor: '#1677ff' }}>
            {initialState?.tenantContext?.owner?.slice(0, 1)}
          </Avatar>
          {children}
        </Space>
      ),
    },
    headerTitleRender: () => (
      <Link
        to="/dashboard/analysis"
        prefetch
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          color: 'inherit',
        }}
      >
        <AiTrendLogo />
        <span
          style={{
            color: 'rgba(0, 0, 0, 0.88)',
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: '0.02em',
          }}
        >
          {adminBrandTitle}
        </span>
      </Link>
    ),
    menuItemRender: (item, dom) =>
      item.path ? (
        <Link to={item.path} prefetch>
          {dom}
        </Link>
      ) : (
        dom
      ),
    menuHeaderRender: false,
  };
};
