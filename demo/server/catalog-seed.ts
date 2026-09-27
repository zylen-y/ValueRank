import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoRoot } from './config.ts';
import type { CatalogStore } from './catalog-store.ts';
export const CATALOG_BATCH_FILES = [
  'culture/apple-music.json', 'culture/youtube.json', 'culture/instagram.json', 'culture/pinterest.json',
  'editorial/arxiv.json', 'editorial/standard-ebooks.json', 'editorial/open-library.json',
  'shopping/musinsa.json', 'shopping/oliveyoung-global.json', 'shopping/oliveyoung-korea.json',
];
/** Imports recorded browser observations. It never launches a crawler or paid model call. */
export function seedCatalog(store: CatalogStore) {
  return CATALOG_BATCH_FILES.map(file => ({ file, ...store.ingest(JSON.parse(readFileSync(resolve(demoRoot, 'catalog-crawl', file), 'utf8'))) }));
}
