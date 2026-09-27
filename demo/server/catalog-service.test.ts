import { afterEach, describe, expect, it } from 'vitest';
import type { CatalogBatch, CatalogInputItem } from '../src/domain/catalog.ts';
import { createCatalogStore } from './catalog-store.ts';
import { CATALOG_SCHEMA, catalogFeatures, catalogUnit, createCatalogService } from './catalog-service.ts';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService } from './personal-service.ts';

const date = '2026-09-27T00:00:00.000Z';
const fixture = (): CatalogBatch => ({ source: { id: 'fixture-books', label: 'Authored fixture', kind: 'books', homeUrl: 'https://example.com', status: 'collected', checkedAt: date, note: 'Synthetic test data only' }, collections: [{ id: 'books-a', title: 'Test books', kind: 'books', description: 'Authored test data' }], items: ['Gardening flowers nature', 'Algorithms programming computers', 'Painting sculpture drawing', 'Chemistry biology physics'].map((title, index): CatalogInputItem => ({ sourceId: 'fixture-books', externalId: String(index), kind: 'books', collectionIds: ['books-a'], title, url: `https://example.com/books/${index}`, creator: `Author ${index}`, observedAt: date, listingUrl: 'https://example.com/books', attributes: { year: 1980 + index * 10, price: 10 + index * 15 }, extraction: 'browser-dom' })) });
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(close => close()));
function setup() {
  const catalog = createCatalogStore(':memory:'); const ledger = createPersonalStore(':memory:');
  cleanups.push(() => { catalog.close(); ledger.close(); });
  catalog.ingest(fixture()); const personal = createPersonalService(ledger, { now: () => date, random: () => 0.8 });
  return { catalog, ledger, personal, service: createCatalogService(catalog, personal) };
}

describe('catalog preference-learning integration', () => {
  it('starts neutral in source order and browsing creates neither labels nor model claims', () => {
    const { service, personal } = setup(); const result = service.page('books-a');
    expect(result).toMatchObject({ modelVersion: 0, trainingCount: 0, total: 4 });
    expect(result.items.map(item => item.sourceRank)).toEqual([1, 2, 3, 4]);
    expect(new Set(result.items.map(item => item.score)).size).toBe(1);
    expect(result.rankingBasis).toContain('no personal choices');
    expect(personal.snapshot().models).toHaveLength(0); expect(personal.trainingRows()).toHaveLength(0);
    expect(personal.exportData().units).toHaveLength(0);
  });

  it('learns a real choice, reranks that pair, and undo restores neutral scores and weights', () => {
    const { service, personal } = setup(); const before = service.page('books-a');
    const first = before.items[0]; const last = before.items[3];
    const { pair } = service.practice('books-a', [first.id, last.id]);
    const choice = pair.a.entityId === last.id ? 'a' : 'b';
    const answer = personal.answer({ exposureId: pair.exposure.id, choice });
    const after = service.page('books-a');
    expect(after).toMatchObject({ modelVersion: 1, trainingCount: 1 });
    expect(after.items.find(item => item.id === last.id)!.rank).toBeLessThan(after.items.find(item => item.id === first.id)!.rank);
    expect(personal.snapshot().models[0].weights.some(value => value !== 0)).toBe(true);
    personal.undo(answer.comparison.id);
    const undone = service.page('books-a');
    expect(undone).toMatchObject({ modelVersion: 2, trainingCount: 0 });
    expect(undone.items.map(item => item.id)).toEqual(before.items.map(item => item.id));
    expect(undone.items.map(item => item.score)).toEqual(before.items.map(item => item.score));
    expect(personal.snapshot().models[0].weights.every(value => value === 0)).toBe(true);
  });

  it('treats already browsable items as learning-only, locks outstanding pairs and hides precommitted predictions', () => {
    const { service, personal } = setup(); const first = service.practice('books-a');
    expect(first.dataset.itemRefs.every(item => item.partition === 'train')).toBe(true);
    expect(() => personal.startComparison({ datasetId: first.dataset.id, mode: 'test' })).toThrow(/held-out/i);
    expect(service.practice('books-a').pair.exposure.id).toBe(first.pair.exposure.id);
    expect('prediction' in first.pair).toBe(false);
    expect(personal.exportData().predictions).toHaveLength(0);
  });

  it('freezes training inputs at their original version when catalog metadata changes', () => {
    const { catalog, service, personal } = setup(); const first = service.practice('books-a');
    personal.answer({ exposureId: first.pair.exposure.id, choice: 'a' });
    const oldRows = personal.trainingRows(); const oldUnits = personal.exportData().units;
    const update = fixture(); update.items[0] = { ...update.items[0], title: 'Changed observed gardening title', observedAt: '2026-09-28T00:00:00.000Z' };
    catalog.ingest(update);
    const next = service.practice('books-a');
    expect(next.dataset.id).not.toBe(first.dataset.id);
    expect(personal.trainingRows()).toEqual(oldRows);
    expect(personal.datasets().find(dataset => dataset.id === first.dataset.id)?.itemRefs).toEqual(first.dataset.itemRefs);
    for (const old of oldUnits) expect(personal.exportData().units.find(unit => unit.id === old.id && unit.version === old.version)).toEqual(old);
    const changed = next.dataset.itemRefs.find(ref => ref.version === 2)!;
    expect(personal.exportData().units.filter(unit => unit.id === changed.id).map(unit => unit.version)).toEqual([1, 2]);
  });

  it('isolates category models and excludes source rank from learnable features', () => {
    const { catalog, service, personal } = setup(); const books = catalog.items('books-a');
    expect(catalogFeatures({ ...books[0], attributes: { ...books[0].attributes, sourceRank: 1 } })).toEqual(catalogFeatures({ ...books[0], attributes: { ...books[0].attributes, sourceRank: 99 } }));
    const other: CatalogBatch = { source: { ...fixture().source, id: 'fixture-music', kind: 'music' }, collections: [{ id: 'music-a', title: 'Music fixture', kind: 'music', description: '' }], items: fixture().items.map(item => ({ ...item, sourceId: 'fixture-music', kind: 'music', collectionIds: ['music-a'] })) };
    catalog.ingest(other);
    const { pair } = service.practice('books-a'); personal.answer({ exposureId: pair.exposure.id, choice: 'a' });
    expect(personal.snapshot().models[0]).toMatchObject({ domain: 'catalog-books', schemaId: CATALOG_SCHEMA, trainingCount: 1 });
    expect(service.page('music-a')).toMatchObject({ modelVersion: 0, trainingCount: 0 });
    expect(new Set(service.page('music-a').items.map(item => item.score)).size).toBe(1);
  });

  it('rejects invalid selections without inserting preference records', () => {
    const { service, personal } = setup(); const itemId = service.page('books-a').items[0].id;
    expect(() => service.practice('books-a', [itemId, itemId])).toThrow(/distinct/);
    expect(() => service.practice('books-a', [itemId, 'unknown'])).toThrow(/collection/);
    expect(() => service.practice('books-a', [itemId])).toThrow(/two/);
    expect(personal.datasets()).toHaveLength(0); expect(personal.exportData().units).toHaveLength(0);
  });

  it('lets a two-item catalog selection reopen after undo without reusing its answered exposure', () => {
    const { service, personal } = setup(); const ids = service.page('books-a').items.slice(0, 2).map(item => item.id);
    const first = service.practice('books-a', ids);
    const result = personal.answer({ exposureId: first.pair.exposure.id, choice: 'a' });
    personal.undo(result.comparison.id);
    const reopened = service.practice('books-a', ids);
    expect(reopened.dataset.id).toBe(first.dataset.id);
    expect(reopened.pair.exposure.id).not.toBe(first.pair.exposure.id);
    const corrected = personal.answer({ exposureId: reopened.pair.exposure.id, choice: 'b' });
    expect(corrected.modelVersion).toBe(3);
    expect(service.page('books-a').trainingCount).toBe(1);
    expect(personal.trainingRows()[0].exposureId).toBe(reopened.pair.exposure.id);
  });

  it('preserves existing private facts, training evidence and model weights through catalog import and learning', () => {
    const { catalog, service, personal } = setup();
    const privateUnits = catalog.items('books-a').slice(0, 2).map((item, index) => ({ ...catalogUnit(item), id: `private-${index}`, entityId: `private-${index}`, domain: 'content', sourceIds: [] }));
    const pack = personal.createDataset({ id: 'private-reading', title: 'Prior private collection', domain: 'content', prompt: 'Pick', units: privateUnits, evaluation: false, provenance: 'Authored private fixture' });
    personal.setFact({ kind: 'value', value: 'Prefer actionable research', domain: 'content' });
    const originalPair = personal.startComparison({ datasetId: pack.id });
    personal.answer({ exposureId: originalPair.exposure.id, choice: 'a' });
    const before = personal.exportData();
    const update = fixture(); update.items[0] = { ...update.items[0], observedAt: '2026-09-28T00:00:00.000Z', title: 'New public metadata' };
    catalog.ingest(update); service.page('books-a');
    expect(personal.exportData()).toEqual(before);
    const { pair } = service.practice('books-a'); personal.answer({ exposureId: pair.exposure.id, choice: 'b' });
    const after = personal.exportData();
    expect(after.facts).toEqual(before.facts);
    expect(after.units.filter(item => item.domain === 'content')).toEqual(before.units);
    expect(after.models.filter(model => model.domain === 'content')).toEqual(before.models);
    expect(after.trainingRows.filter(row => row.domain === 'content')).toEqual(before.trainingRows);
    expect(after.exposures.find(exposure => exposure.id === originalPair.exposure.id)).toEqual(originalPair.exposure);
    expect(after.comparisons.find(comparison => comparison.exposureId === originalPair.exposure.id)).toEqual(before.comparisons[0]);
  });
});
