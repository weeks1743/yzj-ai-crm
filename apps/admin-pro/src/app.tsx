import {
  BellOutlined,
  ClusterOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { RunTimeLayoutConfig } from '@umijs/max';
import { Link } from '@umijs/max';
import { Avatar, Button, Space, Tag, Tooltip } from 'antd';
import { brandTitle } from '@shared';
import type { YzjAuthIdentityResponse } from '@shared/types';
import { applyDocumentBranding } from '@shared/dom-branding';
import brandLogo from '@shared/assets/logo.png';
import { resolveAdminIdentity } from '@/utils/yzjIdentity';

const adminBrandTitle = brandTitle;
const fallbackIdentity: YzjAuthIdentityResponse = {
  source: 'local_fixed',
  eid: '未解析',
  displayEid: '未解析',
  appId: '未解析',
  operatorOpenId: '未解析',
  userId: null,
  userName: '云之家用户',
  networkId: null,
  deviceId: null,
};

export async function getInitialState() {
  const currentUser = await resolveAdminIdentity().catch(() => fallbackIdentity);

  return {
    currentUser,
    settings: {
      colorPrimary: '#1677ff',
    },
  };
}

export const layout: RunTimeLayoutConfig = ({ initialState }) => {
  applyDocumentBranding(adminBrandTitle, brandLogo);

  return {
    menu: {
      locale: false,
    },
    title: adminBrandTitle,
    pageTitleRender: () => adminBrandTitle,
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
      <Tag key="eid" bordered={false}>
        <ClusterOutlined /> {initialState?.currentUser?.displayEid || initialState?.currentUser?.eid}
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
      title: initialState?.currentUser?.userName,
      render: (_, children) => (
        <Space>
          <Avatar style={{ backgroundColor: '#1677ff' }}>
            {initialState?.currentUser?.userName?.slice(0, 1)}
          </Avatar>
          {children}
        </Space>
      ),
    },
    onPageChange: () => {
      applyDocumentBranding(adminBrandTitle, brandLogo);
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
        <img
          src={brandLogo}
          alt={adminBrandTitle}
          style={{
            width: 36,
            height: 36,
            display: 'block',
            borderRadius: 10,
            objectFit: 'cover',
          }}
        />
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
