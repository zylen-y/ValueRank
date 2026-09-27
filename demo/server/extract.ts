import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import ipaddr from 'ipaddr.js';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function validateUrl(input: string) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Use a public HTTP or HTTPS URL without credentials or custom ports.');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Private network URLs are not allowed.');
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new Error('Private network addresses are not allowed.');
  return url;
}
async function download(input: string, redirects = 0, signal = AbortSignal.timeout(20_000)): Promise<{ text: string; type: string; url: string }> {
  if (redirects > 3) throw new Error('Too many redirects. Paste the article text instead.');
  const url = validateUrl(input);
  signal.throwIfAborted();
  const addresses = await Promise.race([
    lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true }),
    new Promise<never>((_resolve, reject) => {
      const abort = () => reject(new Error('Source extraction timed out. Paste the text instead.'));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    }),
  ]);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('The URL resolves to a private or reserved network.');
  const chosen = addresses[0];
  return new Promise((resolve, reject) => {
    // Pin the validated DNS answer for the actual connection (including TLS).
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      headers: { 'User-Agent': 'ValueRankPrototype/1.0 (personal reading assistant)', Accept: 'text/html,text/plain' },
      lookup: (_host, options, callback) => {
        if (typeof options === 'object' && options.all) callback(null, [chosen]);
        else callback(null, chosen.address, chosen.family);
      },
      signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        void download(new URL(response.headers.location, url).href, redirects + 1, signal).then(resolve, reject); return;
      }
      if ((response.statusCode ?? 500) >= 400) { response.resume(); reject(new Error(`Source returned HTTP ${response.statusCode}. Paste the text to continue.`)); return; }
      const type = response.headers['content-type'] ?? '';
      if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) { response.resume(); reject(new Error('Only HTML and plain-text sources are supported. Paste text from PDFs or videos.')); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1_000_000) { request.destroy(new Error('Source is too large. Paste a shorter excerpt.')); return; } chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ text: Buffer.concat(chunks).toString('utf8'), type, url: url.href }));
    });
    request.on('error', reject); request.end();
  });
}
export async function extractSource(url: string) {
  const source = await download(url);
  if (source.type.includes('text/plain')) return { title: new URL(source.url).hostname, text: source.text.slice(0, 50_000), url: source.url };
  const { document } = parseHTML(source.text);
  // No scripts execute in linkedom. Strip executable/non-content nodes before parsing.
  document.querySelectorAll('script,style,iframe,object,embed,noscript').forEach(element => element.remove());
  const article = new Readability(document as unknown as Document).parse();
  const text = article?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  if (text.length < 100) throw new Error('Readable text was not found. Paste the relevant passage instead.');
  return { title: article?.title || new URL(source.url).hostname, text: text.slice(0, 50_000), url: source.url };
}
