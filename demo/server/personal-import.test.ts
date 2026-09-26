import { afterEach, describe, expect, it } from 'vitest';
import { importPersonalDataset, lexicalFeatures } from './personal-import.ts';
import { parsePersonalCsv } from '../src/domain/personal-csv.ts';
import { createPersonalService } from './personal-service.ts';
import { createPersonalStore } from './personal-store.ts';
import type { PersonalSource, PersonalUnit } from '../src/domain/personal.ts';

const stores: ReturnType<typeof createPersonalStore>[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() { const store = createPersonalStore(':memory:'); stores.push(store); return createPersonalService(store); }
const input = () => ({ title: 'My research choices', domain: 'content', prompt: 'Which would you read?', items: Array.from({ length: 8 }, (_, index) => ({ title: `Paper ${index}`, body: `Independently useful idea number ${index}.`, sourceUrl: `https://example.com/papers/${index}`, entityId: `paper-${index}` })) });
const date = '2026-09-26T00:00:00.000Z';
const unit = (id: string): PersonalUnit => ({ id, version: 1, domain: 'custom', modality: 'text', kind: 'note', title: id, body: `Original text ${id}`, sourceIds: [], evidence: [], concepts: [], limitations: ['Authored'], effortMinutes: 1, features: { schemaId: 'custom-v1', names: ['depth', 'speed'], values: [0.7, 0.3], encoder: 'authored', model: 'none', contextVersion: 1 }, prior: 0, createdAt: date });
const source: PersonalSource = { id: 'imported-source', version: 1, url: 'https://example.com/original', title: 'Original', text: 'An exact quote from a user-provided source.', publisher: 'Example', retrievedAt: date, provenance: 'upload' };

describe('portable personal dataset imports', () => {
  it('uses deterministic normalized lexical features, never falsely labels them as Jev or vision', () => {
    const first = lexicalFeatures('Useful learning, research, research!');
    expect(first).toEqual(lexicalFeatures('RESEARCH Useful learning'));
    expect(first.schemaId).toBe('lexical-hash-48-v1');
    expect(first.encoder).toBe('sha256-word-hashing-v1');
    expect(first.values).toHaveLength(48);
    expect(Math.sqrt(first.values.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
    expect(first.values.every(value => Number.isFinite(value) && value >= -1 && value <= 1)).toBe(true);
    expect(lexicalFeatures('...').values).toEqual(Array(48).fill(0));
    expect(lexicalFeatures('강화 학습 개인화')).not.toEqual(lexicalFeatures('웹 디자인 컴포넌트'));
  });
  it('imports JSON items with inspectable source provenance and a separate lexical feature schema', () => {
    const service = setup(); const dataset = importPersonalDataset(service, input());
    const saved = service.exportData();
    expect(dataset.itemRefs).toHaveLength(8); expect(saved.sources).toHaveLength(8);
    expect(saved.units.every(item => item.features.model === 'local-lexical-baseline' && item.prior === 0)).toBe(true);
    expect(saved.units[0].limitations[0]).toContain('no LLM or Jev');
    expect(saved.sources[0].limitations?.[0]).toContain('not fetched');
    expect(saved.sources[0].provenance).toBe('upload');
    expect(saved.units.every(item => item.evidence.length === 0)).toBe(true);
    expect(service.startComparison({ datasetId: dataset.id }).a.features.schemaId).toBe('lexical-hash-48-v1');
  });
  it('accepts blank optional CSV-style cells and groups supplied duplicate entities into one partition', () => {
    const service = setup(); const payload = input();
    payload.items = payload.items.map((item, index) => ({ ...item, sourceUrl: '', entityId: `entity-${Math.floor(index / 2)}` }));
    const dataset = importPersonalDataset(service, payload);
    for (let index = 0; index < 8; index += 2) expect(dataset.itemRefs[index].partition).toBe(dataset.itemRefs[index + 1].partition);
    expect(service.exportData().sources).toHaveLength(0);
  });
  it('preserves quoted commas, embedded newlines and escaped quotes through raw CSV import', () => {
    const service = setup();
    const csv = 'title,body,sourceUrl,entityId\n"RL, practice","First line\nSecond line says ""choose deliberately"".",https://example.com/rl,rl\n"Other option","A separate independent idea.",https://example.com/other,other\n';
    const items = parsePersonalCsv(csv);
    expect(items[0]).toEqual({ title: 'RL, practice', body: 'First line\nSecond line says "choose deliberately".', sourceUrl: 'https://example.com/rl', entityId: 'rl' });
    importPersonalDataset(service, { title: 'Imported CSV', domain: 'content', prompt: 'Which is useful?', items });
    const saved = service.exportData();
    expect(saved.units[0].title).toBe('RL, practice');
    expect(saved.units[0].body).toBe('First line\nSecond line says "choose deliberately".');
    expect(saved.sources[0].text).toBe(saved.units[0].body);
    expect(saved.units).toHaveLength(2);
  });
  it('accepts a UTF-8 BOM, CRLF records, blank optional cells and wholly blank records', () => {
    const service = setup();
    const csv = '\uFEFFtitle,body,sourceUrl,entityId\r\n"첫 번째","Quoted first line\r\nQuoted second line",,\r\n,,,\r\nSecond,Another useful idea,,\r\n';
    const items = parsePersonalCsv(csv);
    expect(items).toEqual([
      { title: '첫 번째', body: 'Quoted first line\r\nQuoted second line', sourceUrl: '', entityId: '' },
      { title: 'Second', body: 'Another useful idea', sourceUrl: '', entityId: '' },
    ]);
    const dataset = importPersonalDataset(service, { title: 'CSV with blank optional values', domain: 'content', prompt: 'Which one?', items });
    expect(dataset.itemRefs).toHaveLength(2);
    expect(service.exportData().sources).toHaveLength(0);
    expect(service.exportData().units[0].body).toContain('\r\n');
  });
  it('rejects ambiguous or broken CSV instead of silently losing a field', () => {
    expect(() => parsePersonalCsv('title,body,body\nOne,Two,Three')).toThrow(/unique/);
    expect(() => parsePersonalCsv('title,body\nOne,Two,Unexpected extra')).toThrow(/more fields/);
    expect(() => parsePersonalCsv('title,body\nOne,"Unclosed body')).toThrow(/unclosed quote/);
    expect(() => parsePersonalCsv('name,description\nOne,Two')).toThrow(/title and body/);
  });
  it('applies the same source-link validation atomically to CSV as to JSON', () => {
    const service = setup();
    const items = parsePersonalCsv('title,body,sourceUrl\nGood,Valid first idea,https://example.com/good\nBad,Untrusted second link,javascript:alert(1)');
    expect(() => importPersonalDataset(service, { title: 'Untrusted CSV links', domain: 'content', prompt: 'Pick', items })).toThrow();
    expect(service.exportData().sources).toHaveLength(0);
    expect(service.exportData().units).toHaveLength(0);
  });
  it('rejects active source URL schemes and rolls back every prior row in the same import', () => {
    for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/hosts']) {
      const service = setup(); const payload = input(); payload.items[4].sourceUrl = sourceUrl;
      expect(() => importPersonalDataset(service, payload)).toThrow();
      expect(service.exportData().sources).toHaveLength(0); expect(service.exportData().units).toHaveLength(0); expect(service.datasets()).toHaveLength(0);
    }
  });
  it('rolls back sources and units if one supplied feature vector violates its declared schema', () => {
    const service = setup(); const payload = input();
    const features = lexicalFeatures('Feature text');
    const items = payload.items.map((item, index) => ({ ...item, features: { ...features, values: index === 5 ? [1, 2] : features.values } }));
    expect(() => importPersonalDataset(service, { ...payload, items })).toThrow();
    expect(service.exportData().units).toHaveLength(0); expect(service.exportData().sources).toHaveLength(0);
  });
  it('requires explicit visual features and provenance for remote images, with no inference from a filename', () => {
    const service = setup(); const payload = input();
    expect(() => importPersonalDataset(service, { ...payload, items: payload.items.map(item => ({ ...item, imageUrl: 'https://example.com/image.jpg' })) })).toThrow(/visual features and rights/);
    const features = { schemaId: 'imported-visual-v1', names: ['warmth'], values: [0.2], encoder: 'dataset-author', model: 'supplied-measurements', contextVersion: 1 };
    const dataset = importPersonalDataset(service, { ...payload, items: payload.items.map((item, index) => ({ ...item, imageUrl: `https://example.com/image-${index}.jpg`, rights: 'User-provided reference', features })) });
    expect(dataset.itemRefs).toHaveLength(8);
    expect(service.exportData().units.every(item => item.modality === 'image' && item.features.encoder === 'dataset-author')).toBe(true);
  });
  it('uses a canonical image asset identity across caption changes and fragment URLs', () => {
    const service = setup();
    const features = { schemaId: 'imported-visual-v1', names: ['warmth'], values: [0.2], encoder: 'dataset-author', model: 'supplied', contextVersion: 1 };
    const dataset = importPersonalDataset(service, { title: 'Same asset captions', domain: 'portraits', prompt: 'Which photo?', items: [
      { title: 'Caption one', body: 'First image description', imageUrl: 'https://example.com/portrait.jpg#top', rights: 'User reference', features },
      { title: 'Caption two', body: 'Another description of the same image', imageUrl: 'https://example.com/portrait.jpg#bottom', rights: 'User reference', features },
      { title: 'Other', body: 'A separate image', imageUrl: 'https://example.com/other.jpg', rights: 'User reference', features },
      { title: 'Third', body: 'A third image', imageUrl: 'https://example.com/third.jpg', rights: 'User reference', features },
    ] });
    const units = service.exportData().units;
    expect(units[0].entityId).toBe(units[1].entityId);
    expect(dataset.itemRefs[0].partition).toBe(dataset.itemRefs[1].partition);
    expect(dataset.itemRefs.every(ref => ref.partition === 'train')).toBe(true);
  });
  it('imports advanced raw unit/source revisions and preserves supplied feature provenance', () => {
    const service = setup(); const a = { ...unit('a'), sourceIds: [source.id], evidence: [{ sourceId: source.id, sourceVersion: 1, quote: 'An exact quote' }] };
    const dataset = importPersonalDataset(service, { title: 'Advanced dataset', domain: 'custom', prompt: 'Which one?', sources: [source], units: [a, unit('b')], provenance: 'Research measurements v1', evaluation: false });
    expect(dataset.itemRefs.every(ref => ref.partition === 'train')).toBe(true);
    expect(service.exportData().sources[0]).toEqual(source);
    expect(service.exportData().units[0]).toEqual(a);
  });
  it('rejects unsupported advanced source schemes and fabricated evidence atomically', () => {
    const service = setup();
    const raw = { title: 'Advanced dataset', domain: 'custom', prompt: 'Which one?', sources: [source], units: [unit('a'), { ...unit('b'), sourceIds: [source.id], evidence: [{ sourceId: source.id, sourceVersion: 1, quote: 'Fabricated quotation' }] }], provenance: 'Authored' };
    expect(() => importPersonalDataset(service, raw)).toThrow(/quote/);
    expect(service.exportData().sources).toHaveLength(0); expect(service.exportData().units).toHaveLength(0);
    expect(() => importPersonalDataset(service, { ...raw, sources: [{ ...source, url: 'javascript:alert(1)' }] })).toThrow(/HTTP/);
    expect(service.exportData().sources).toHaveLength(0);
  });
  it('cannot silently overwrite an existing immutable revision, including in a partially processed batch', () => {
    const service = setup(); service.saveUnit(unit('existing'));
    const raw = { title: 'Conflicting revisions', domain: 'custom', prompt: 'Which one?', sources: [source], units: [unit('new-first'), { ...unit('existing'), body: 'Changed without revision' }], provenance: 'Authored' };
    expect(() => importPersonalDataset(service, raw)).toThrow(/immutable/);
    expect(service.exportData().units).toEqual([unit('existing')]);
    expect(service.exportData().sources).toHaveLength(0);
  });
});
