import { theme } from 'antd';
import React from 'react';

export function useMarkdownTheme() {
  const token = theme.useToken();

  const isLightMode = React.useMemo(() => token?.theme?.id === 0, [token]);

  const className = React.useMemo(
    () => (isLightMode ? 'x-markdown-light' : 'x-markdown-dark'),
    [isLightMode],
  );

  return [className] as const;
}
