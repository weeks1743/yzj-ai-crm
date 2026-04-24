import { join } from 'node:path';
import { defineConfig } from '@umijs/max';
import routes from './routes';

export default defineConfig({
  hash: true,
  npmClient: 'pnpm',
  publicPath: '/',
  esbuildMinifyIIFE: true,
  routes,
  alias: {
    '@': join(__dirname, '../src'),
    '@shared': join(__dirname, '../../../packages/shared/src'),
  },
  fastRefresh: true,
  model: {},
  initialState: {},
  proxy: {
    '/api': {
      target: `http://127.0.0.1:${process.env.ADMIN_API_PORT || '3001'}`,
      changeOrigin: true,
    },
  },
  layout: {
    locale: false,
    title: 'AI销售助手',
    siderWidth: 236,
    splitMenus: false,
  },
  antd: {
    configProvider: {
      theme: {
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 12,
          fontFamily:
            '"Alibaba Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
        },
      },
    },
  },
});
