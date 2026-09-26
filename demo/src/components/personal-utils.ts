export async function personalRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api/personal${path}`, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let data: { error?: string };
  try { data = await response.json(); } catch { throw new Error('The local server connection was interrupted. Please try again when it reconnects.'); }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}
export function relativeDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function safeExternalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? value : undefined; } catch { return undefined; }
}
export function domainLabel(value: string) {
  try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return 'Source'; }
}
