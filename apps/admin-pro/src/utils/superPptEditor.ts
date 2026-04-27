const SUPER_PPT_EDITOR_BASE_URL =
  (process.env.SUPER_PPT_EDITOR_BASE_URL || 'http://127.0.0.1:8001').replace(/\/+$/, '');

export function getSuperPptEditorUrl(jobId: string): string {
  const url = new URL(`${SUPER_PPT_EDITOR_BASE_URL}/`);
  url.searchParams.set('jobId', jobId);
  return url.toString();
}
