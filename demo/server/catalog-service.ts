import { createHash } from 'node:crypto';
import type { CatalogItem, CatalogPage } from '../src/domain/catalog.ts';
import type { PersonalDataset, PersonalFeatureVector, PersonalSource, PersonalUnit } from '../src/domain/personal.ts';
import type { CatalogStore } from './catalog-store.ts';
import { lexicalFeatures } from './personal-import.ts';
import { PersonalError, type PersonalService } from './personal-service.ts';

export const CATALOG_SCHEMA = 'catalog-metadata-56-v1';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
function metadata(item: CatalogItem) {
  return [item.title, item.creator ? `Creator: ${item.creator}` : '', item.description, ...Object.entries(item.attributes).map(([key, value]) => `${key}: ${value}`)].filter(Boolean).join('\n').slice(0, 10000);
}
/** This is an explicit metadata baseline, not audio/vision understanding or Jev inference. */
export function catalogFeatures(item: CatalogItem): PersonalFeatureVector {
  const attributes = Object.fromEntries(Object.entries(item.attributes).filter(([key]) => !/rank|position|index|url|id$/i.test(key)));
  const words = lexicalFeatures([item.title, item.creator, item.description, ...Object.entries(attributes).map(([k, v]) => `${k} ${v}`)].filter(Boolean).join(' '));
  const price = numeric(attributes.price ?? attributes.priceNumber);
  const year = numeric(attributes.year ?? attributes.publicationYear ?? attributes.firstPublishYear);
  const duration = numeric(attributes.durationSeconds);
  const rating = numeric(attributes.rating);
  return { ...words, schemaId: CATALOG_SCHEMA, names: [...words.names, 'hasPrice', 'logPrice', 'hasYear', 'yearScale', 'hasDuration', 'logDuration', 'hasRating', 'ratingScale'], values: [...words.values, Number(price !== undefined), price === undefined ? 0 : clamp(Math.log1p(price) / 15), Number(year !== undefined), year === undefined ? 0 : clamp(year / 2100), Number(duration !== undefined), duration === undefined ? 0 : clamp(Math.log1p(duration) / 12), Number(rating !== undefined), rating === undefined ? 0 : clamp(rating / 5)], encoder: 'observed-metadata-hashing-and-numerics-v1', model: 'local-metadata-baseline' };
}
export function catalogUnit(item: CatalogItem): PersonalUnit {
  return { id: `catalog-${item.id}`, entityId: item.id, version: item.version, domain: `catalog-${item.kind}`, modality: 'text', kind: item.kind, title: item.title, body: metadata(item).slice(0, 1400), sourceIds: [`catalog-source-${item.id}`], evidence: [], concepts: [], limitations: ['Ranking uses observed titles, creators, categories and numerical metadata. Audio, video and image pixels have not been encoded.', 'Prices, popularity and availability are snapshots, not live guarantees.'], effortMinutes: 0, features: catalogFeatures(item), prior: 0, createdAt: item.observedAt, ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}), imageSourceUrl: item.url, rights: 'Media belongs to its original owner. Source link and remote preview only.' };
}
export function createCatalogService(store: CatalogStore, personal: PersonalService) {
  const getCollection = (id: string) => {
    const collection = store.summary().collections.find(c => c.id === id);
    if (!collection) throw new PersonalError('Catalog collection not found.', 404);
    return collection;
  };
  function page(id: string, options: { query?: string; sort?: 'personal' | 'source' | 'recent'; offset?: number; limit?: number } = {}): CatalogPage {
    const collection = getCollection(id); const records = store.items(id, options.query);
    const offset = Math.max(0, Math.floor(options.offset ?? 0)); const limit = Math.max(1, Math.min(60, Math.floor(options.limit ?? 24)));
    const ranked = new Map(personal.rank(records.map(catalogUnit)).map(unit => [unit.id, unit]));
    const models = personal.snapshot().models;
    const model = models.find(m => m.domain === `catalog-${collection.kind}` && m.schemaId === CATALOG_SCHEMA);
    const result = records.map(record => { const score = ranked.get(`catalog-${record.id}`)!; return { ...record, score: score.score, modelVersion: score.modelVersion, rank: 0 }; });
    const sort = options.sort ?? 'personal';
    result.sort((a, b) => sort === 'recent' ? b.lastSeenAt.localeCompare(a.lastSeenAt) || a.sourceRank - b.sourceRank : sort === 'source' || !model ? a.sourceRank - b.sourceRank : b.score - a.score || a.sourceRank - b.sourceRank);
    result.forEach((item, i) => { item.rank = i + 1; });
    return { collection, items: result.slice(offset, offset + limit), total: result.length, offset, limit, modelVersion: model?.version ?? 0, trainingCount: model?.trainingCount ?? 0, rankingBasis: model?.trainingCount ? 'Your explicit comparisons · metadata features · same-category model' : 'Original collection order · no personal choices learned yet' };
  }
  function practice(collectionId: string, requested?: string[]) {
    const collection = getCollection(collectionId); const all = store.items(collectionId);
    if (requested && (new Set(requested).size !== requested.length || requested.some(id => !all.some(item => item.id === id)))) throw new PersonalError('Choose distinct items from this collection.');
    const selected = requested?.length ? all.filter(item => requested.includes(item.id)) : all;
    if (selected.length < 2) throw new PersonalError('At least two catalog items are required.');
    const records = selected.slice(0, 200); const units = records.map(catalogUnit);
    // A stable window preserves an outstanding pair across reloads; another selection gets a separate dataset.
    const signature = createHash('sha256').update(records.map(i => `${i.id}@${i.version}`).join('|')).digest('hex').slice(0, 16);
    const datasetId = `catalog-${collectionId}-${signature}`;
    let dataset: PersonalDataset | undefined = personal.datasets().find(d => d.id === datasetId);
    if (!dataset) dataset = personal.store.transaction(() => {
      for (const item of records) {
        const source: PersonalSource = { id: `catalog-source-${item.id}`, version: item.version, url: item.url, title: item.title, publisher: item.sourceId, text: metadata(item), retrievedAt: item.observedAt, provenance: 'page-extraction', limitations: [`Observed on ${item.listingUrl} using ${item.extraction}. Catalog metadata only; no full media analysis.`] };
        personal.saveSource(source);
      }
      return personal.createDataset({ id: datasetId, title: collection.title, description: `${records.length} real catalog items from ${collection.count} in this collection. Already browsable items are used for learning only, not an unseen-item evaluation.`, domain: `catalog-${collection.kind}`, prompt: `Which would you personally choose from ${collection.title}?`, units, evaluation: false, provenance: 'Observed public source metadata; each item records its extraction method. Personalization learns from metadata features; previews remain linked to the original owners.' });
    });
    return { dataset, collectionSize: all.length, learningSetSize: records.length, pair: personal.startComparison({ datasetId: dataset.id, mode: 'learn' }) };
  }
  return { store, summary: store.summary, page, practice };
}
