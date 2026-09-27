import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { demoRoot } from './config.ts';
import { validateUrl } from './extract.ts';
import { CATALOG_KINDS, type CatalogBatch, type CatalogCollection, type CatalogCollectionSummary, type CatalogInputItem, type CatalogItem, type CatalogSource, type CatalogSummary } from '../src/domain/catalog.ts';

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/);
const publicUrl = z.string().max(4000).transform(value => { const url = validateUrl(value); url.hash = ''; return url.href; });
const kind = z.enum(CATALOG_KINDS);
const collectionSchema = z.object({ id, title: z.string().trim().min(1).max(240), kind, description: z.string().max(2000) }).strict();
const sourceSchema = z.object({ id, label: z.string().min(1).max(150), homeUrl: publicUrl, kind, status: z.enum(['collected', 'partial', 'blocked']), checkedAt: z.string().datetime(), note: z.string().max(4000) }).strict();
const itemSchema = z.object({ sourceId: id, externalId: z.string().max(500).optional(), kind, collectionIds: z.array(id).min(1).max(30), title: z.string().trim().min(1).max(500), url: publicUrl, creator: z.string().max(2000).optional(), description: z.string().max(2000).optional(), imageUrl: publicUrl.optional(), observedAt: z.string().datetime(), listingUrl: publicUrl, attributes: z.record(z.string().max(100), z.union([z.string().max(2000), z.number().finite()])).refine(v => Object.keys(v).length <= 50), extraction: z.enum(['browser-dom', 'official-api']) }).strict();
export const catalogBatchSchema = z.object({ source: sourceSchema, collections: z.array(collectionSchema).max(200), items: z.array(itemSchema).max(20000) }).strict();
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const catalogIdentity = (item: Pick<CatalogInputItem, 'sourceId' | 'externalId' | 'url'>) => `cat-${digest([item.sourceId, item.externalId || item.url]).slice(0, 28)}`;

/** Public catalog is separate from the private preference ledger. Revisions never rewrite training inputs. */
export function createCatalogStore(path = resolve(demoRoot, '.data/catalog.sqlite')) {
  if (path !== ':memory:') mkdirSync(resolve(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS catalog_sources(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_collections(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_items(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,kind TEXT NOT NULL,version INTEGER NOT NULL,hash TEXT NOT NULL,search_text TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS catalog_versions(item_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(item_id,version));
    CREATE TABLE IF NOT EXISTS catalog_memberships(collection_id TEXT NOT NULL,item_id TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(collection_id,item_id),FOREIGN KEY(collection_id) REFERENCES catalog_collections(id),FOREIGN KEY(item_id) REFERENCES catalog_items(id));
    CREATE TABLE IF NOT EXISTS catalog_runs(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,imported_at TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS catalog_kind ON catalog_items(kind);
    CREATE INDEX IF NOT EXISTS catalog_source ON catalog_items(source_id);
    CREATE INDEX IF NOT EXISTS catalog_membership_order ON catalog_memberships(collection_id,position);
  `);
  const parse = <T>(row: unknown): T | undefined => row ? JSON.parse((row as { payload: string }).payload) as T : undefined;
  const item = (itemId: string) => parse<CatalogItem>(db.prepare('SELECT payload FROM catalog_items WHERE id=?').get(itemId));
  const collection = (collectionId: string) => parse<CatalogCollection>(db.prepare('SELECT payload FROM catalog_collections WHERE id=?').get(collectionId));
  function ingest(raw: unknown) {
    const batch: CatalogBatch = catalogBatchSchema.parse(raw);
    if (batch.source.status === 'blocked' && batch.items.length) throw new Error('A blocked collection attempt cannot claim newly collected items.');
    const batchId = digest(batch); const previous = parse<{ id: string; inserted: number; updated: number; unchanged: number }>(db.prepare('SELECT payload FROM catalog_runs WHERE id=?').get(batchId));
    if (previous) return { ...previous, replayed: true };
    const collections = new Map(batch.collections.map(c => [c.id, c]));
    if (collections.size !== batch.collections.length) throw new Error('Collection IDs must be unique within an import.');
    for (const record of batch.items) {
      if (record.sourceId !== batch.source.id || record.kind !== batch.source.kind) throw new Error('An item must belong to its declared source and kind.');
      if (record.collectionIds.some(key => collections.get(key)?.kind !== record.kind)) throw new Error('Every membership must reference a declared collection of the same kind.');
    }
    let inserted = 0; let updated = 0; let unchanged = 0; const importedAt = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const priorSource = parse<CatalogSource>(db.prepare('SELECT payload FROM catalog_sources WHERE id=?').get(batch.source.id));
      if (priorSource && priorSource.kind !== batch.source.kind) throw new Error('An existing source cannot change item kind.');
      if (!priorSource || Date.parse(batch.source.checkedAt) >= Date.parse(priorSource.checkedAt)) db.prepare('INSERT INTO catalog_sources VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(batch.source.id, JSON.stringify(batch.source));
      for (const c of batch.collections) {
        const existing = collection(c.id); if (existing && existing.kind !== c.kind) throw new Error('An existing collection cannot change item kind.');
        db.prepare('INSERT INTO catalog_collections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(c.id, c.kind, JSON.stringify(c));
      }
      const positions = new Map<string, number>();
      for (const input of batch.items) {
        const itemId = catalogIdentity(input); const existing = item(itemId);
        if (existing && existing.kind !== input.kind) throw new Error('An item cannot change kind.');
        const collectionIds = [...new Set([...(existing?.collectionIds ?? []), ...input.collectionIds])];
        const incoming = existing && Date.parse(input.observedAt) < Date.parse(existing.lastSeenAt) ? existing : input;
        // Memberships and observation times can change without rewriting a content version.
        const contentHash = digest({ kind: incoming.kind, title: incoming.title, url: incoming.url, creator: incoming.creator, description: incoming.description, imageUrl: incoming.imageUrl, attributes: incoming.attributes, extraction: incoming.extraction });
        const oldHash = (db.prepare('SELECT hash FROM catalog_items WHERE id=?').get(itemId) as { hash: string } | undefined)?.hash;
        const changed = oldHash !== contentHash;
        const version = existing ? existing.version + (changed ? 1 : 0) : 1;
        const record: CatalogItem = { ...incoming, observedAt: !changed && existing ? existing.observedAt : incoming.observedAt, listingUrl: !changed && existing ? existing.listingUrl : incoming.listingUrl, collectionIds, id: itemId, version, firstSeenAt: existing?.firstSeenAt ?? input.observedAt, lastSeenAt: [existing?.lastSeenAt, input.observedAt].filter((v): v is string => !!v).sort().at(-1)! };
        const payload = JSON.stringify(record);
        const searchText = [record.title, record.creator, record.description, ...Object.values(record.attributes)].filter(Boolean).join(' ').normalize('NFKC').toLowerCase();
        db.prepare('INSERT INTO catalog_items VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,hash=excluded.hash,search_text=excluded.search_text,last_seen=excluded.last_seen,payload=excluded.payload').run(itemId, input.sourceId, input.kind, version, contentHash, searchText, record.firstSeenAt, record.lastSeenAt, payload);
        if (changed) db.prepare('INSERT INTO catalog_versions VALUES(?,?,?)').run(itemId, version, payload);
        for (const key of input.collectionIds) {
          const position = (positions.get(key) ?? 0) + 1; positions.set(key, position);
          db.prepare('INSERT OR IGNORE INTO catalog_memberships VALUES(?,?,?)').run(key, itemId, position);
        }
        if (!existing) inserted++; else if (changed) updated++; else unchanged++;
      }
      const run = { id: batchId, sourceId: batch.source.id, inserted, updated, unchanged, importedAt, observed: batch.items.length };
      db.prepare('INSERT INTO catalog_runs VALUES(?,?,?,?)').run(batchId, batch.source.id, importedAt, JSON.stringify(run));
      db.exec('COMMIT'); return { ...run, replayed: false };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function items(collectionId: string, query = '') {
    const needle = query.normalize('NFKC').toLowerCase().slice(0, 300);
    return db.prepare(`SELECT i.payload,m.position FROM catalog_memberships m JOIN catalog_items i ON i.id=m.item_id WHERE m.collection_id=? AND instr(i.search_text,?)>0 ORDER BY m.position,i.id`).all(collectionId, needle).map(row => ({ ...parse<CatalogItem>(row)!, sourceRank: Number(row.position) }));
  }
  function describeCollection(c: CatalogCollection): CatalogCollectionSummary {
    const count = Number((db.prepare('SELECT count(*) AS count FROM catalog_memberships WHERE collection_id=?').get(c.id) as {count:number}).count);
    const previewImages = db.prepare("SELECT json_extract(i.payload,'$.imageUrl') AS image FROM catalog_memberships m JOIN catalog_items i ON i.id=m.item_id WHERE m.collection_id=? AND json_extract(i.payload,'$.imageUrl') IS NOT NULL ORDER BY m.position LIMIT 4").all(c.id).map(r=>String(r.image));
    const sourceIds = db.prepare('SELECT DISTINCT i.source_id FROM catalog_memberships m JOIN catalog_items i ON i.id=m.item_id WHERE m.collection_id=?').all(c.id).map(r=>String(r.source_id));
    return { ...c, count, previewImages, sourceIds };
  }
  function collectionSummary(collectionId: string): CatalogCollectionSummary | undefined {
    const c = collection(collectionId);
    return c ? describeCollection(c) : undefined;
  }
  function summary(): CatalogSummary {
    const counts = db.prepare('SELECT kind,count(*) AS count FROM catalog_items GROUP BY kind').all() as { kind: CatalogItem['kind']; count: number }[];
    const sources = db.prepare('SELECT payload FROM catalog_sources ORDER BY id').all().map(row => { const source = parse<CatalogSource>(row)!; return { ...source, count: Number((db.prepare('SELECT count(*) AS count FROM catalog_items WHERE source_id=?').get(source.id) as { count: number }).count) }; });
    const collections = db.prepare('SELECT payload FROM catalog_collections ORDER BY id').all().map(row => describeCollection(parse<CatalogCollection>(row)!));
    return { total: counts.reduce((sum, c) => sum + Number(c.count), 0), byKind: Object.fromEntries(counts.map(c => [c.kind, Number(c.count)])), sources, collections, lastCollectedAt: sources.map(s => s.checkedAt).sort().at(-1) ?? null, database: 'SQLite', runs: db.prepare('SELECT payload FROM catalog_runs ORDER BY imported_at DESC LIMIT 20').all().map(row => parse<CatalogSummary['runs'][number]>(row)!) };
  }
  return { ingest, item, collection, collectionSummary, items, summary, versions: (itemId: string) => db.prepare('SELECT payload FROM catalog_versions WHERE item_id=? ORDER BY version').all(itemId).map(row => parse<CatalogItem>(row)!), exportData: () => ({ format: 'valuerank-catalog-v1', exportedAt: new Date().toISOString(), ...summary(), items: db.prepare('SELECT payload FROM catalog_items ORDER BY id').all().map(row => parse<CatalogItem>(row)!) }), close: () => db.close() };
}
export type CatalogStore = ReturnType<typeof createCatalogStore>;
