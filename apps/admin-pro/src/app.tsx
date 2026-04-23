import {
  BellOutlined,
  ClusterOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { RunTimeLayoutConfig } from '@umijs/max';
import { Link } from '@umijs/max';
import { Avatar, Button, Space, Tag, Tooltip } from 'antd';
import { tenantContext } from '@shared';

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
    title: 'YZJ AI CRM Admin',
    layout: 'mix',
    contentWidth: 'Fluid',
    fixedHeader: true,
    fixSiderbar: true,
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
    menuItemRender: (item, dom) =>
      item.path ? (
        <Link to={item.path} prefetch>
          {dom}
        </Link>
      ) : (
        dom
      ),
    menuHeaderRender: (_, title) => (
      <Space size={10}>
        <Avatar
          shape="square"
          size={36}
          style={{
            background: 'linear-gradient(135deg, #1677ff 0%, #2f54eb 100%)',
            fontWeight: 700,
          }}
        >
          YZ
        </Avatar>
        <Space direction="vertical" size={0}>
          <strong>{title}</strong>
          <span style={{ color: 'rgba(0, 0, 0, 0.45)', fontSize: 12 }}>
            管理员后台
          </span>
        </Space>
      </Space>
    ),
  };
};
