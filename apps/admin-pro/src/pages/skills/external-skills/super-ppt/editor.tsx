import { useLocation } from '@umijs/max';
import { Result, Spin, Typography } from 'antd';
import { useEffect } from 'react';
import { getSuperPptEditorUrl } from '@/utils/superPptEditor';

const SuperPptEditorRedirectPage = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const jobId = query.get('jobId')?.trim() || '';

  useEffect(() => {
    if (!jobId) {
      return;
    }

    window.location.replace(getSuperPptEditorUrl(jobId));
  }, [jobId]);

  if (!jobId) {
    return (
      <Result
        status="warning"
        title="缺少 jobId"
        subTitle="请从 super-ppt 调试结果页重新打开独立编辑器。"
      />
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <Spin size="large" />
        <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
          正在跳转到独立 PPT 编辑器页面...
        </Typography.Paragraph>
      </div>
    </div>
  );
};

export default SuperPptEditorRedirectPage;
