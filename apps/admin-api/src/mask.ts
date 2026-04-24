export function maskValue(value: string | undefined | null): string {
  if (!value) {
    return '未配置';
  }

  if (value.length <= 4) {
    return `${value[0]}***${value[value.length - 1]}`;
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}***${value.slice(-2)}`;
  }

  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
