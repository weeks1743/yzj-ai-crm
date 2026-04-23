import { Result } from 'antd';

const NotFoundPage = () => {
  return (
    <Result
      status="404"
      title="404"
      subTitle="当前后台页面不存在，请返回菜单继续操作。"
    />
  );
};

export default NotFoundPage;
