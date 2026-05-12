import dayjs from 'dayjs';

export function formatLocalDateTime(value: string | null | undefined) {
  if (!value) {
    return '-';
  }

  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : value;
}
