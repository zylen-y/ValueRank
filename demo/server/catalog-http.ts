import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { createCatalogService } from './catalog-service.ts';
type CatalogService = ReturnType<typeof createCatalogService>;
export function createCatalogHttp(service: CatalogService, helpers: { json: (res: ServerResponse, status: number, data: unknown) => void; body: (req: IncomingMessage, maxBytes?: number) => Promise<unknown>; requireIdle: () => void }) {
  return async (request: IncomingMessage, response: ServerResponse, path: string) => {
    if (!path.startsWith('/api/catalog')) return false;
    const url = new URL(request.url ?? '/', 'http://localhost'); const parts = path.slice('/api/catalog'.length).split('/').filter(Boolean).map(decodeURIComponent);
    if (!parts.length && request.method === 'GET') { helpers.json(response, 200, service.summary()); return true; }
    if (parts[0] === 'export' && request.method === 'GET') { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="valuerank-public-catalog.json"', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(service.store.exportData())); return true; }
    if (parts[0] === 'collections' && parts[1]) {
      if (request.method === 'GET' && !parts[2]) {
        const args = z.object({ query: z.string().max(300).optional(), sort: z.enum(['personal', 'source', 'recent']).optional(), offset: z.coerce.number().int().min(0).max(1_000_000).default(0), limit: z.coerce.number().int().min(1).max(60).default(24) }).parse(Object.fromEntries(url.searchParams));
        helpers.json(response, 200, service.page(parts[1], args)); return true;
      }
      if (request.method === 'POST' && parts[2] === 'practice') {
        const input = z.object({ itemIds: z.array(z.string()).min(2).max(200).optional() }).strict().parse(await helpers.body(request));
        helpers.requireIdle(); helpers.json(response, 201, service.practice(parts[1], input.itemIds)); return true;
      }
    }
    helpers.json(response, 404, { error: 'Catalog endpoint not found.' }); return true;
  };
}
