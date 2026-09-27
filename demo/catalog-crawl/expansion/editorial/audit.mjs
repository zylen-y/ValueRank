import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { catalogBatchSchema } from '../../../server/catalog-store.ts';

const out = path.dirname(fileURLToPath(import.meta.url));
const evidenceFiles = readdirSync(path.join(out, 'evidence')).filter(name => name.endsWith('.json'));
const originals = ['arxiv', 'standard-ebooks'];
const report = [];
for (const source of originals) {
  const batch = catalogBatchSchema.parse(JSON.parse(readFileSync(path.join(out, `${source}-expanded.json`), 'utf8')));
  const oldIds = new Set(JSON.parse(readFileSync(path.join(out, `../../editorial/${source}.json`), 'utf8')).items.map(i => i.externalId || i.url));
  const identities = new Set(), evidenceKeys = new Set();
  let visibleCards = 0, files = 0;
  for (const name of evidenceFiles.filter(name => name.startsWith(source + '-'))) {
    const evidence = JSON.parse(readFileSync(path.join(out, 'evidence', name), 'utf8'));
    files++; visibleCards += evidence.items.length;
    for (const item of evidence.items) evidenceKeys.add(JSON.stringify([item.externalId, item.title, item.url, item.creator, item.description, item.imageUrl, item.attributes]));
  }
  for (const item of batch.items) {
    const id = item.externalId || item.url;
    if (identities.has(id)) throw Error(`Duplicate normalized identity: ${source}/${id}`);
    identities.add(id);
    if (item.extraction !== 'browser-dom') throw Error(`Unexpected extraction type: ${source}/${id}`);
    const key = JSON.stringify([item.externalId, item.title, item.url, item.creator, item.description, item.imageUrl, item.attributes]);
    if (!evidenceKeys.has(key)) throw Error(`Normalized item is absent from raw DOM evidence: ${source}/${id}`);
    if (item.collectionIds.some(id => !batch.collections.some(c => c.id === id))) throw Error(`Unknown collection: ${source}/${id}`);
  }
  report.push({sourceId: source, validSchema: true, everyItemMatchesBrowserEvidence: true, uniqueItems: identities.size, additionalVsOriginal: [...identities].filter(id => !oldIds.has(id)).length, visibleCards, evidencePages: files, collectionCount: batch.collections.length, imageCount: batch.items.filter(i => i.imageUrl).length, collections: batch.collections.map(c => ({id: c.id, title: c.title, count: batch.items.filter(i => i.collectionIds.includes(c.id)).length}))});
}
writeFileSync(path.join(out, 'quality-report.json'), JSON.stringify({auditedAt: new Date().toISOString(), sources: report}, null, 2) + '\n');
console.log(JSON.stringify(report.map(({collections: _collections, ...summary}) => summary), null, 2));
