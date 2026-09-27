import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogBatchSchema, catalogIdentity, createCatalogStore } from '../../server/catalog-store.ts';
import { CATALOG_BATCH_FILES } from '../../server/catalog-seed.ts';

const root = dirname(fileURLToPath(import.meta.url));
const demoRoot = resolve(root, '../..');
const outputPath = resolve(root, '../../../docs/prototype/catalog-expansion-verification.json');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'valuerank-catalog-audit-'));
const databasePath = join(temporaryDirectory, 'catalog.sqlite');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const batches = CATALOG_BATCH_FILES.map(file => ({ file, batch: catalogBatchSchema.parse(JSON.parse(readFileSync(resolve(demoRoot, 'catalog-crawl', file), 'utf8'))) }));
const socialBatches = batches.filter(({ file }) => file.startsWith('expansion/social/'));
if (socialBatches.length) {
  const observations = readFileSync(join(root, 'social/captures.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const observationKey = (source, item, observedAt, listingUrl) => JSON.stringify([source, item.externalId, item.url, item.imageUrl, observedAt, listingUrl]);
  const observed = new Set(observations.flatMap(capture => capture.items.map(item => observationKey(capture.source, item, capture.observedAt, capture.url))));
  for (const { file, batch } of socialBatches) {
    assert.ok(batch.items.every(item => observed.has(observationKey(item.sourceId, item, item.observedAt, item.listingUrl))), `Social URL/image provenance mismatch in ${file}`);
  }
}
let store = createCatalogStore(databasePath);
try {
  const imports = [];
  for (const { file, batch } of batches) {
    const identities = batch.items.map(catalogIdentity);
    assert.equal(new Set(identities).size, identities.length, `Duplicate identity inside ${file}`);
    const declared = new Set(batch.collections.map(collection => collection.id));
    assert.ok(batch.items.every(item => item.collectionIds.every(id => declared.has(id))), `Unresolved collection in ${file}`);
    assert.ok(batch.items.every(item => item.extraction === 'browser-dom'), `Unexpected extraction method in ${file}`);
    const run = store.ingest(batch);
    imports.push({ file, sourceId: batch.source.id, observed: batch.items.length, collections: batch.collections.length, inserted: run.inserted, updated: run.updated, unchanged: run.unchanged });
  }
  const before = store.exportData();
  const beforeHash = digest(before.items);
  for (const { file, batch } of batches) assert.equal(store.ingest(batch).replayed, true, `Non-idempotent batch ${file}`);
  const after = store.exportData();
  assert.equal(after.total, before.total);
  assert.equal(digest(after.items), beforeHash, 'Exact batch replay changed item snapshots');
  assert.equal(new Set(after.items.map(item => item.id)).size, after.total);
  assert.equal(imports.reduce((sum, run) => sum + run.inserted, 0), after.total);
  assert.ok(after.collections.every(collection => collection.count > 0), 'Empty captured collection');
  const netflix = after.items.filter(item => ['movies', 'series', 'anime'].includes(item.kind));
  const netflixIds = netflix.map(item => item.externalId);
  assert.ok(netflixIds.every(Boolean));
  assert.equal(new Set(netflixIds).size, netflixIds.length, 'Netflix title ID counted in multiple kinds');
  const identityKey = item => `${item.sourceId}:${item.externalId || item.url}`;
  assert.equal(new Set(after.items.map(identityKey)).size, after.total);
  const imageUrlsByKind = Object.fromEntries(Object.keys(after.byKind).map(kind => [kind, after.items.filter(item => item.kind === kind && item.imageUrl).length]));
  const report = {
    verifiedAt: new Date().toISOString(),
    method: 'Production schema, isolated on-disk SQLite ingestion, exact-batch replay and durable reopen. No main or private databases accessed.',
    originalCatalogItems: 2416,
    uniqueItems: after.total,
    growthMultiple: Number((after.total / 2416).toFixed(3)),
    collections: after.collections.length,
    populatedKinds: Object.keys(after.byKind).length,
    byKind: after.byKind,
    sourceStatus: after.sources.map(source => ({ id: source.id, kind: source.kind, status: source.status, count: source.count, checkedAt: source.checkedAt })),
    imageUrls: after.items.filter(item => item.imageUrl).length,
    imageUrlsByKind,
    extraction: { 'browser-dom': after.items.length },
    netflix: { uniqueTitles: netflixIds.length, crossKindDuplicateTitleIds: 0 },
    checks: { allBatchesSchemaValid: true, uniqueIdentitiesWithinEveryBatch: true, uniqueProviderIdentitiesAfterImport: true, allMembershipsResolve: true, noEmptyCapturedCollections: true, allBatchesReplayWithoutItemChanges: true, exactItemSnapshotChecksum: beforeHash, originalAndExpandedObservationsDeduplicated: true, socialUrlImageAndTimestampMatchBrowserEvidence: socialBatches.length > 0 },
    imports,
    collectionCounts: after.collections.map(collection => ({ id: collection.id, title: collection.title, kind: collection.kind, count: collection.count })),
    limits: ['Metadata verification does not certify availability, factual accuracy or recommendation quality of source content.', 'Remote image URL presence does not guarantee future image delivery or that image pixels were encoded.', 'No paid model calls or personal preference labels are created by this audit.'],
  };
  store.close();
  store = createCatalogStore(databasePath);
  assert.equal(digest(store.exportData().items), beforeHash, 'Durable reopen changed item snapshots');
  report.checks.durableReopenPreservesItems = true;
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ uniqueItems: report.uniqueItems, collections: report.collections, populatedKinds: report.populatedKinds, growthMultiple: report.growthMultiple, byKind: report.byKind, imageUrls: report.imageUrls, netflix: report.netflix, batchFiles: batches.length, report: outputPath }, null, 2));
} finally {
  store.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
