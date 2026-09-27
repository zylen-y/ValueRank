import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { PersonalError } from './personal-service.ts';
import { researchBriefMarkdown, type ResearchService } from './research-service.ts';
import { decisionMarkdown } from './research-decisions.ts';

export function createResearchHttp(research: ResearchService, dependencies: {
  json: (response: ServerResponse, status: number, data: unknown) => void;
  body: (request: IncomingMessage, maxBytes?: number) => Promise<unknown>;
  requireIdle: () => void;
}) {
  const { json, body, requireIdle } = dependencies;
  return async (request: IncomingMessage, response: ServerResponse, path: string): Promise<boolean> => {
    if (path !== '/api/personal/projects' && !path.startsWith('/api/personal/projects/')) return false;
    const [id, resource, itemId, action] = path.slice('/api/personal/projects'.length).split('/').filter(Boolean).map(decodeURIComponent);
    const method = request.method;
    if (!id && method === 'GET') { json(response, 200, { projects: research.list() }); return true; }
    if (!id && method === 'POST') { json(response, 201, { project: research.create(await body(request)) }); return true; }
    if (id && !resource) {
      if (method === 'GET') { json(response, 200, research.detail(id)); return true; }
      if (method === 'PUT') { json(response, 200, { project: research.update(id, await body(request)) }); return true; }
      if (method === 'DELETE') { requireIdle(); research.remove(id); json(response, 200, { deleted: true }); return true; }
    }
    if (id && resource === 'saved') {
      if (!itemId && method === 'POST') {
        const input = z.object({ sessionId: z.string(), unitId: z.string(), unitVersion: z.number().int().positive(), note: z.string().max(2000).optional() }).strict().parse(await body(request));
        json(response, 201, { saved: research.save(id, input) }); return true;
      }
      if (itemId === 'order' && method === 'PUT') { const input = z.object({ ids: z.array(z.string()).max(500) }).strict().parse(await body(request)); json(response, 200, { saved: research.reorder(id, input.ids) }); return true; }
      if (itemId && method === 'PUT') { const input = z.object({ note: z.string().max(2000) }).strict().parse(await body(request)); json(response, 200, { saved: research.note(id, itemId, input.note) }); return true; }
      if (itemId && method === 'DELETE') { research.removeSave(id, itemId); json(response, 200, { deleted: true }); return true; }
    }
    if (id && resource === 'decisions') {
      if (!itemId && method === 'POST') { json(response, 201, { decision: research.decisions.record(id, await body(request)) }); return true; }
      if (itemId && method === 'DELETE') { research.decisions.remove(id, itemId); json(response, 200, { deleted: true }); return true; }
      if (itemId && method === 'GET') {
        const record = research.decisions.get(id, itemId);
        if (action === 'markdown') { response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="valuerank-my-decision.md"', 'Cache-Control': 'no-store' }); response.end(decisionMarkdown(record)); return true; }
        if (!action) { json(response, 200, { decision: record }); return true; }
      }
    }
    if (id && resource === 'briefs') {
      if (!itemId && method === 'POST') { const input = z.object({ savedIds: z.array(z.string()).min(1).max(8).optional() }).strict().parse(await body(request)); requireIdle(); json(response, 202, { brief: research.startBrief(id, input.savedIds) }); return true; }
      if (itemId && action === 'cancel' && method === 'POST') { await body(request); const brief = research.detail(id).briefs.find(item => item.id === itemId); if (!brief) throw new PersonalError('Decision brief not found.', 404); research.cancel(itemId); json(response, 200, { cancelled: true }); return true; }
      if (itemId && method === 'GET') {
        const brief = research.detail(id).briefs.find(item => item.id === itemId);
        if (!brief) throw new PersonalError('Decision brief not found.', 404);
        if (action === 'markdown') { const text = researchBriefMarkdown(brief); response.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="valuerank-decision-brief.md"', 'Cache-Control': 'no-store' }); response.end(text); return true; }
        json(response, 200, { brief }); return true;
      }
    }
    throw new PersonalError('Research project endpoint not found.', 404);
  };
}
