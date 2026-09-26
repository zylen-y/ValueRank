import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CreatePersonalDataset, PersonalFeatureVector, PersonalSource, PersonalUnit } from '../src/domain/personal.ts';
import type { PersonalService } from './personal-service.ts';

const optionalUrl = z.preprocess(value=>value===''?undefined:value,z.string().url().max(2000).optional());
const itemSchema = z.object({
  title: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(12000),
  url: optionalUrl, sourceUrl: optionalUrl,
  imageUrl: optionalUrl, entityId: z.string().max(160).optional(),
  rights: z.string().max(500).optional(), features: z.object({ schemaId: z.string(), names: z.array(z.string()), values: z.array(z.number()), encoder: z.string(), model: z.string(), contextVersion: z.number() }).optional(),
}).strict();
const importSchema = z.object({ title: z.string().trim().min(1).max(200), domain: z.string().trim().min(1).max(80), prompt: z.string().trim().min(1).max(300), description: z.string().max(2000).optional(), items: z.array(itemSchema).min(2).max(200), format: z.string().max(30).optional() }).strict();

/** Transparent lexical baseline for offline imports, distinct from Jev-scored web cards. */
export function lexicalFeatures(text: string): PersonalFeatureVector {
  const values = Array.from({ length: 48 }, () => 0);
  const tokens = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const token of new Set(tokens)) {
    const hash = createHash('sha256').update(token).digest();
    values[hash.readUInt16BE(0) % values.length] += hash[2] % 2 ? 1 : -1;
  }
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0)) || 1;
  return { schemaId: 'lexical-hash-48-v1', names: values.map((_, index) => `wordBucket${index + 1}`), values: values.map(value => value / norm), encoder: 'sha256-word-hashing-v1', model: 'local-lexical-baseline', contextVersion: 1 };
}

export function importPersonalDataset(service: PersonalService, raw: unknown) {
  if (raw && typeof raw === 'object' && 'units' in raw) {
    const input = z.object({title:z.string(),description:z.string().optional(),domain:z.string(),prompt:z.string(),context:z.unknown().optional(),units:z.array(z.unknown()).max(200),provenance:z.string(),id:z.string().optional(),sources:z.array(z.unknown()).max(200).optional(),evaluation:z.boolean().optional()}).strict().parse(raw);
    return service.store.transaction(() => { input.sources?.forEach(source => service.saveSource(source as PersonalSource)); return service.createDataset(input as CreatePersonalDataset); });
  }
  const input = importSchema.parse(raw); const importId = randomUUID(); const now = new Date().toISOString();
  return service.store.transaction(() => {
    const units = input.items.map((item, index): PersonalUnit => {
      if (item.imageUrl && (!item.features || !item.rights)) throw new Error('Remote image imports need documented visual features and rights. Use image upload to extract actual visual features.');
      for (const url of [item.url, item.sourceUrl, item.imageUrl]) if (url && !/^https?:\/\//i.test(url)) throw new Error('Source and image links must use HTTP or HTTPS.');
      const sourceUrl = item.sourceUrl || item.url;
      const sourceId = `import-source-${importId}-${index}`;
      if (sourceUrl) service.saveSource({ id: sourceId, version: 1, url: sourceUrl, title: item.title, text: item.body, publisher: new URL(sourceUrl).hostname, retrievedAt: now, provenance: 'upload', limitations: ['User-supplied text and source reference; the linked page was not fetched.'] });
      const identityUrl = item.imageUrl || sourceUrl;
      let entityIdentity = item.body.normalize('NFKC').trim();
      if (identityUrl) { const canonical = new URL(identityUrl); canonical.hash = ''; entityIdentity = canonical.href; }
      const unit: PersonalUnit = { id: `import-${importId}-${index}`, version: 1, domain: input.domain, modality: item.imageUrl ? 'image' : 'text', kind: item.imageUrl ? 'image' : 'note', title: item.title, body: item.body, sourceIds: sourceUrl ? [sourceId] : [], evidence: [], concepts: [], limitations: [item.features ? 'Feature values were supplied by the dataset author.' : 'Local lexical features capture word overlap; no LLM or Jev has evaluated this imported item.'], effortMinutes: 1, features: item.features ?? lexicalFeatures(`${item.title}\n${item.body}`), prior: 0, createdAt: now, entityId: item.entityId || createHash('sha256').update(entityIdentity).digest('hex'), ...(item.imageUrl ? {imageUrl:item.imageUrl,rights:item.rights,imageSourceUrl:sourceUrl} : {}) };
      service.saveUnit(unit); return unit;
    });
    return service.createDataset({ title: input.title, description: input.description ?? 'Your imported comparison dataset.', domain: input.domain, prompt: input.prompt, units, provenance: 'User JSON/CSV import. Content and provenance supplied by the user; features explicitly labeled by their encoder.' });
  });
}
