import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CatalogBatch, CatalogInputItem } from '../src/domain/catalog.ts';
import { catalogIdentity, createCatalogStore } from './catalog-store.ts';

const early = '2026-09-26T10:00:00.000Z';
const late = '2026-09-27T10:00:00.000Z';
const item = (overrides: Partial<CatalogInputItem> = {}): CatalogInputItem => ({ sourceId: 'fixture-books', externalId: 'one', kind: 'books', collectionIds: ['books-a'], title: 'An authored test book', url: 'https://example.com/books/one', creator: 'Test Author', observedAt: early, listingUrl: 'https://example.com/books', attributes: { year: 2000 }, extraction: 'browser-dom', ...overrides });
const batch = (items: CatalogInputItem[] = [item()]): CatalogBatch => ({ source: { id: 'fixture-books', label: 'Authored test fixture', homeUrl: 'https://example.com', kind: 'books', status: 'collected', checkedAt: early, note: 'Synthetic test records, never imported into the application catalog.' }, collections: [{ id: 'books-a', title: 'Test books A', kind: 'books', description: 'Authored fixture' }], items });
const stores: ReturnType<typeof createCatalogStore>[] = [];
const directories: string[] = [];
const setup = (path = ':memory:') => { const store = createCatalogStore(path); stores.push(store); return store; };
afterEach(() => { stores.splice(0).forEach(store => store.close()); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

describe('public catalog ingestion', () => {
  it('replays an identical batch without duplicating observations, items or versions', () => {
    const store = setup(); const input = batch(); const first = store.ingest(input);
    expect(first).toMatchObject({ inserted: 1, updated: 0, unchanged: 0, replayed: false });
    expect(store.ingest(input)).toMatchObject({ id: first.id, replayed: true });
    expect(store.summary()).toMatchObject({ total: 1, byKind: { books: 1 } });
    expect(store.summary().runs).toHaveLength(1);
    expect(store.versions(catalogIdentity(input.items[0]))).toHaveLength(1);
  });

  it('unions collection memberships for one external identity without duplicating the item or content version', () => {
    const store = setup(); store.ingest(batch());
    const input = batch([item({ collectionIds: ['books-b'], listingUrl: 'https://example.com/books/another-list', observedAt: late })]);
    input.collections = [{ id: 'books-b', title: 'Test books B', kind: 'books', description: 'Another observed listing' }];
    expect(store.ingest(input)).toMatchObject({ inserted: 0, updated: 0, unchanged: 1 });
    const a = store.items('books-a')[0]; const b = store.items('books-b')[0];
    expect(a.id).toBe(b.id); expect(a.collectionIds).toEqual(['books-a', 'books-b']);
    expect(store.summary().total).toBe(1); expect(store.versions(a.id)).toHaveLength(1);
    expect(a.lastSeenAt).toBe(late);
  });

  it('keeps original immutable metadata when a newer observation creates a revision', () => {
    const store = setup(); const original = item(); store.ingest(batch([original]));
    const id = catalogIdentity(original); const v1 = store.versions(id)[0];
    store.ingest(batch([item({ title: 'Corrected observed title', attributes: { year: 2001 }, observedAt: late })]));
    expect(store.item(id)).toMatchObject({ title: 'Corrected observed title', version: 2, firstSeenAt: early, lastSeenAt: late });
    expect(store.versions(id)[0]).toEqual(v1);
    expect(store.versions(id).map(v => v.version)).toEqual([1, 2]);
  });

  it('does not roll back newer item or source observations when an older batch arrives', () => {
    const store = setup(); const newer = batch([item({ title: 'New observed title', observedAt: late })]);
    newer.source = { ...newer.source, checkedAt: late, note: 'Most recent observation' };
    store.ingest(newer); store.ingest(batch());
    const record = store.items('books-a')[0];
    expect(record).toMatchObject({ title: 'New observed title', observedAt: late, lastSeenAt: late, version: 1 });
    expect(store.summary().sources[0]).toMatchObject({ checkedAt: late, note: 'Most recent observation' });
    expect(store.versions(record.id)).toHaveLength(1);
  });

  it('rolls back all source and collection writes when a later collection conflicts', () => {
    const store = setup(); store.ingest(batch()); const before = store.exportData();
    const bad: CatalogBatch = { source: { ...batch().source, id: 'other-source', kind: 'music' }, collections: [{ id: 'new-collection', kind: 'music', title: 'Would be inserted', description: '' }, { id: 'books-a', kind: 'music', title: 'Invalid category change', description: '' }], items: [] };
    expect(() => store.ingest(bad)).toThrow(/kind/);
    const after = store.exportData();
    expect(after.sources).toEqual(before.sources); expect(after.collections).toEqual(before.collections);
    expect(after.items).toEqual(before.items); expect(after.runs).toEqual(before.runs);
  });

  it.each(['http://127.0.0.1/private', 'javascript:alert(1)'])('rejects unsafe item URL %s without a partial import', url => {
    const store = setup(); expect(() => store.ingest(batch([item(), item({ externalId: 'bad', url })]))).toThrow();
    expect(store.summary()).toMatchObject({ total: 0, sources: [], collections: [], runs: [] });
  });

  it('rejects undeclared memberships and source mismatches without persisting anything', () => {
    const store = setup();
    expect(() => store.ingest(batch([item({ collectionIds: ['missing'] })]))).toThrow(/membership/);
    expect(() => store.ingest(batch([item({ sourceId: 'different-source' })]))).toThrow(/source/);
    expect(store.summary().total).toBe(0); expect(store.summary().runs).toHaveLength(0);
  });

  it('records blocked access as zero collected items and rejects a contradictory blocked batch', () => {
    const store = setup(); const blocked = batch([]); blocked.source.status = 'blocked'; blocked.source.note = 'Login required'; blocked.collections = [];
    store.ingest(blocked);
    expect(store.summary().sources[0]).toMatchObject({ status: 'blocked', count: 0 });
    expect(store.summary().total).toBe(0);
    const contradictory = batch(); contradictory.source.status = 'blocked';
    expect(() => store.ingest(contradictory)).toThrow(/blocked/i);
    expect(store.summary().total).toBe(0);
  });

  it('persists item revisions and provenance across database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'valuerank-catalog-test-')); directories.push(directory);
    const path = join(directory, 'catalog.sqlite'); const store = setup(path);
    store.ingest(batch()); store.ingest(batch([item({ title: 'Second title', observedAt: late })]));
    const before = store.versions(catalogIdentity(item())); store.close(); stores.splice(stores.indexOf(store), 1);
    const reopened = setup(path); expect(reopened.versions(catalogIdentity(item()))).toEqual(before);
    expect(reopened.items('books-a')[0]).toMatchObject({ title: 'Second title', version: 2, extraction: 'browser-dom', listingUrl: 'https://example.com/books' });
  });
});
