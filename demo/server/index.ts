import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { z } from 'zod';
import { TOPICS, type AppState, type ContentItem } from '../src/domain/types.ts';
import { defaultProfile } from '../src/domain/seeds.ts';
import { rankItems } from '../src/domain/ranking.ts';
import { config, demoRoot } from './config.ts';
import { createStore } from './store.ts';
import { addItem, editProfile, exportFeedback, giveFeedback, undoFeedback } from './service.ts';
import { extractSource, validateUrl } from './extract.ts';
import { startPipeline } from './pipeline.ts';
import { createBurstService } from './burst.ts';
import { BURST_CORPUS } from '../src/domain/burst-corpus.ts';
import { createPersonalHttp } from './personal-http.ts';
import { PersonalError } from './personal-service.ts';

const store = createStore(process.env.VALUERANK_DB_PATH || undefined);
const burst = createBurstService({ configuration: () => { const c = config(); return { apiKey: c.jevKey, model: c.jevModel, provider: c.jevProvider }; }, persistencePath: process.env.VALUERANK_BURST_PATH || (process.env.VALUERANK_DB_PATH ? `${process.env.VALUERANK_DB_PATH}.burst.json` : resolve(demoRoot, '.data/burst.json')) });
store.update(s => { if (s.run?.status === 'running') { s.run.status = 'failed'; s.run.finishedAt = new Date().toISOString(); for (const event of s.run.events) if (event.status === 'running') event.status = 'failed'; } for (const item of s.items) if (item.status === 'processing') { item.status = 'error'; item.error = 'Server restarted during processing. Run the engine again.'; } });
function state(): AppState {
  const saved = store.get(); const c = config();
  return { profile: saved.profile, items: rankItems(saved.items, saved.profile), feedback: saved.feedback, run: saved.run, connections: { llm: Boolean(c.gatewayKey), jev: Boolean(c.jevKey), jevProvider: c.jevProvider, llmModel: c.llmModel, jevModel: c.jevModel } };
}
function json(response: ServerResponse, status: number, data: unknown) { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); response.end(JSON.stringify(data)); }
async function body(request: IncomingMessage, maxBytes = 250_000) {
  if (!request.headers['content-type']?.includes('application/json')) throw new Error('Send application/json.');
  let bytes = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) { bytes += chunk.length; if (bytes > maxBytes) throw new Error('Request is too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
const profileSchema = z.object({ goal: z.string().trim().min(5).max(400).optional(), knownConcepts: z.array(z.string().trim().min(2).max(90)).max(80).optional(), interests: z.record(z.enum(TOPICS), z.number().min(0).max(1)).optional() }).strict();
const sourceSchema = z.object({ title: z.string().trim().max(200).optional(), url: z.string().trim().max(2000).optional(), text: z.string().trim().max(50_000).optional() }).strict();
const personal = createPersonalHttp({profile:()=>store.get().profile,legacyBusy:()=>store.get().run?.status==='running'||burst.snapshot()?.status==='running',json,body});
const server = createServer(async (request, response) => {
  try {
    const host = request.headers.host?.split(':')[0];
    if (!['localhost', '127.0.0.1'].includes(host ?? '')) { json(response, 403, { error: 'This prototype serves the local machine only.' }); return; }
    if (request.headers.origin) {
      const origin = new URL(request.headers.origin);
      if (!['localhost', '127.0.0.1'].includes(origin.hostname)) { json(response, 403, { error: 'Cross-origin requests are not allowed.' }); return; }
    }
    const url = new URL(request.url ?? '/', 'http://localhost'); const path = url.pathname;
    if (await personal.handle(request,response,path)) return;
    if (request.method === 'GET' && path === '/api/state') { json(response, 200, state()); return; }
    if (request.method === 'GET' && path === '/api/burst') { json(response, 200, { job: burst.snapshot() }); return; }
    if (request.method === 'POST' && path === '/api/burst') {
      const input = z.object({ goal: z.string().trim().min(5).max(400), knownConcepts: z.array(z.string().trim().min(2).max(90)).max(80) }).strict().parse(await body(request));
      if (personal.isRunning()) throw new Error('Wait for the personal search or image import to finish first.');
      if (store.get().run?.status === 'running') throw new Error('Wait for the reading engine before starting a screening run.');
      const profile = { ...structuredClone(store.get().profile), ...input };
      const { job } = burst.start(profile); json(response, 202, { job }); return;
    }
    if (request.method === 'POST' && path === '/api/burst/cancel') { await body(request); json(response, 200, { job: burst.cancel() }); return; }
    if (request.method === 'POST' && path === '/api/burst/save') {
      const input = z.object({ jobId: z.string(), itemIds: z.array(z.string()).min(1).max(5) }).strict().parse(await body(request));
      const job = burst.snapshot();
      if (!job || job.id !== input.jobId || job.status === 'running') throw new Error('Wait for this screening run to finish before saving.');
      if (store.get().run?.status === 'running') throw new Error('Wait for the reading engine before saving a session.');
      const ids = [...new Set(input.itemIds)];
      if (ids.some(id => !job.items.some(item => item.id === id && item.status === 'completed'))) throw new Error('Only successfully screened sources can be saved.');
      let added = 0, contextMatched = false;
      store.update(saved => {
        const newItems = ids.map(id => BURST_CORPUS.find(item => item.id === id)!).filter(item => !saved.items.some(prior => prior.id === item.id || prior.url === item.url));
        if (saved.items.length + newItems.length > 100) throw new Error('This local prototype supports up to 100 sources.');
        const sameContext = saved.profile.goal === job.profile.goal && saved.profile.version === job.profile.version && JSON.stringify(saved.profile.knownConcepts) === JSON.stringify(job.profile.knownConcepts) && JSON.stringify(saved.profile.interests) === JSON.stringify(job.profile.interests);
        contextMatched = sameContext;
        for (const item of newItems) {
          saved.items.push({ ...structuredClone(item), addedAt: new Date().toISOString(), decision: sameContext ? job.items.find(i => i.id === item.id)!.decision : null });
          added++;
        }
      });
      json(response, 200, { added, contextMatched }); return;
    }
    if (request.method === 'GET' && path === '/api/export') {
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Disposition': 'attachment; filename="valuerank-feedback.jsonl"', 'Cache-Control': 'no-store' }); response.end(exportFeedback(store)); return;
    }
    if (request.method === 'PUT' && path === '/api/profile') { editProfile(store, profileSchema.parse(await body(request))); json(response, 200, state()); return; }
    if (request.method === 'POST' && path === '/api/feedback') {
      const data = z.object({ itemId: z.string(), kind: z.enum(['useful', 'known', 'not_useful']) }).strict().parse(await body(request));
      giveFeedback(store, data.itemId, data.kind); json(response, 200, state()); return;
    }
    if (request.method === 'DELETE' && path.startsWith('/api/feedback/')) { undoFeedback(store, decodeURIComponent(path.slice('/api/feedback/'.length))); json(response, 200, state()); return; }
    if (request.method === 'POST' && path === '/api/items') {
      const input = sourceSchema.parse(await body(request));
      if (!input.text && !input.url) throw new Error('Paste source text or provide a public URL.');
      if (input.url) validateUrl(input.url);
      let text = input.text ?? ''; let title = input.title; let finalUrl = input.url ?? '';
      if (!text) { const extracted = await extractSource(finalUrl); text = extracted.text; title ||= extracted.title; finalUrl = extracted.url; }
      if (text.length < 100) throw new Error('Add at least 100 characters of source text.');
      const item: ContentItem = { id: randomUUID(), title: title || 'Untitled reading note', url: finalUrl, publisher: finalUrl ? new URL(finalUrl).hostname.replace(/^www\./, '') : 'Your notes', kind: finalUrl ? 'article' : 'note', text, addedAt: new Date().toISOString(), provenance: input.text ? 'user-paste' : 'url-extraction', analysis: null, decision: null, feedback: null, status: 'unprocessed', error: null };
      addItem(store, item); json(response, 201, state()); return;
    }
    if (request.method === 'POST' && path === '/api/run') {
      const input = z.object({ itemIds: z.array(z.string()).max(8).optional() }).strict().parse(await body(request));
      if (personal.isRunning()) throw new Error('Wait for the personal search or image import to finish first.');
      if (burst.snapshot()?.status === 'running') throw new Error('Wait for the Signal Lab screening run before starting the reading engine.');
      const { runId } = startPipeline(store, input.itemIds); json(response, 202, { runId }); return;
    }
    if (request.method === 'POST' && path === '/api/reset') {
      await body(request);
      if (store.get().run?.status === 'running') throw new Error('Wait for the current run before resetting feedback.');
      store.update(s => { const version = s.profile.version + 1; s.profile = { ...structuredClone(defaultProfile), version }; s.baseProfile = structuredClone(s.profile); s.feedbackHistory.push({ id: randomUUID(), operation: 'reset', at: new Date().toISOString(), event: null }); s.feedback = []; s.knowledgeExclusions = []; s.items.forEach(item => { item.feedback = null; }); });
      json(response, 200, state()); return;
    }
    if (path.startsWith('/api/')) { json(response, 404, { error: 'Unknown endpoint.' }); return; }
    const dist = resolve(demoRoot, 'dist');
    const file = resolve(dist, `.${decodeURIComponent(path)}`);
    if (file !== dist && !file.startsWith(dist + sep)) throw new Error('Invalid path.');
    const target = extname(path) ? file : resolve(dist, 'index.html');
    try {
      const contents = await readFile(target);
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' }); response.end(contents);
    } catch { json(response, 404, { error: 'Run npm run dev, or build the frontend before npm start.' }); }
  } catch (error) {
    const message = error instanceof z.ZodError ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error ? error.message : 'Request failed.';
    json(response, error instanceof PersonalError ? error.status : 400, { error: message });
  }
});
const port = Number(process.env.API_PORT || 8787);
server.listen(port, '127.0.0.1', () => console.log(`ValueRank API: http://127.0.0.1:${port} · credentials stay on the server`));
