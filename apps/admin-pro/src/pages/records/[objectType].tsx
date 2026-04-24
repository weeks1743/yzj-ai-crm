import { Navigate, useParams } from '@umijs/max';
import { Result } from 'antd';

const redirectMap = {
  customers: '/skills/record-skills/customer',
  contacts: '/skills/record-skills/contact',
  opportunities: '/skills/record-skills/opportunity',
  followups: '/skills/record-skills/followup',
} as const;

const LegacyRecordObjectPage = () => {
  const params = useParams<{ objectType: string }>();
  const target = params.objectType
    ? redirectMap[params.objectType as keyof typeof redirectMap]
    : undefined;

  if (!target) {
    return <Result status="404" title="对象治理页不存在" />;
  }

  return <Navigate to={target} replace />;
};

export default LegacyRecordObjectPage;
