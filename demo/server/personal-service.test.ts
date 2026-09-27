import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService } from './personal-service.ts';
import type { PersonalContext, PersonalSearchSession, PersonalSource, PersonalUnit } from '../src/domain/personal.ts';
const date = '2026-09-26T00:00:00.000Z';
const context: PersonalContext = { id: 'context-1', version: 1, query: 'Find useful research', goal: 'Choose useful material', answers: {} };
const makeItem = (index: number, overrides: Partial<PersonalUnit> = {}): PersonalUnit => ({ id: `unit-${index}`, version: 1, domain: 'content', modality: 'text', kind: 'example', title: `Example ${index}`, body: `Original example number ${index}`, sourceIds: [], evidence: [], concepts: [`Concept ${index}`], limitations: ['Synthetic test fixture'], effortMinutes: 1, prior: 0, createdAt: date, features: { schemaId: 'fixture-v1', names: ['depth', 'brevity'], values: [index / 20, 1 - index / 20], encoder: 'authored', model: 'none', contextVersion: 1 }, ...overrides });
const source: PersonalSource = { id: 'source', version: 1, url: 'https://example.com/research', title: 'Research', publisher: 'Example', text: 'An exact grounded quote. Another independent claim.', retrievedAt: date, provenance: 'page-extraction' };
const toClose: ReturnType<typeof createPersonalStore>[] = [];
const toRemove: string[] = [];
afterEach(() => { toClose.splice(0).forEach(store => store.close()); toRemove.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function setup(path = ':memory:') {
  const store = createPersonalStore(path); toClose.push(store);
  const service = createPersonalService(store, { now: () => date, random: () => 0.8 });
  const pack = () => service.createDataset({ id: 'pack', title: 'Test pack', domain: 'content', prompt: 'Which helps you?', context, units: Array.from({ length: 16 }, (_, index) => makeItem(index)), provenance: 'Authored test fixtures' });
  return { store, service, pack };
}

describe('personal learning ledger', () => {
  it('stores immutable sources and units, validates grounding and schema dimensions', () => {
    const { service } = setup(); service.saveSource(source);
    const item = makeItem(1, { sourceIds: ['source'], evidence: [{ sourceId: 'source', sourceVersion: 1, quote: 'An exact grounded quote.' }] });
    service.saveUnit(item); service.saveUnit(item);
    expect(() => service.saveSource({ ...source, text: 'Changed' })).toThrow(/immutable/);
    expect(() => service.saveUnit({ ...item, title: 'Changed' })).toThrow(/immutable/);
    expect(() => service.saveUnit({ ...item, version: 2, evidence: [{ sourceId: 'source', sourceVersion: 1, quote: 'fabrication' }] })).toThrow(/quote/);
    expect(() => service.saveUnit(makeItem(2, { features: { ...item.features, names: ['brevity', 'depth'] } }))).toThrow(/dimensions/);
    expect(() => service.saveUnit(makeItem(2, { features: { ...item.features, values: [0, Number.NaN] } }))).toThrow();
    service.saveUnit({ ...item, version: 2, title: 'Explicit revision' });
    expect(service.exportData().units).toHaveLength(2);
  });
  it('persists prediction before response while hiding it from blind prompt, then trains exactly once', () => {
    const { store, service, pack } = setup(); pack();
    const prompt = service.startComparison({ datasetId: 'pack' });
    expect('prediction' in prompt).toBe(false);
    expect(JSON.stringify(prompt)).not.toContain('probabilityA');
    expect(store.get('predictions', prompt.exposure.id)?.probabilityA).toBe(0.5);
    expect(service.startComparison({ datasetId: 'pack' }).exposure.id).toBe(prompt.exposure.id);
    const choice = prompt.a.features.values[0] > prompt.b.features.values[0] ? 'a' : 'b';
    const result = service.answer({ exposureId: prompt.exposure.id, choice });
    expect(result.prediction.modelVersion).toBe(0);
    expect(result.modelVersion).toBe(1);
    expect(service.snapshot().models[0].weights.some(weight => Math.abs(weight) > 0.01)).toBe(true);
    expect(() => service.answer({ exposureId: prompt.exposure.id, choice })).toThrow(/already/);
    expect(service.trainingRows()).toHaveLength(1);
  });
  it('keeps ties, neither and skips distinct, and undo completely removes their learning effect', () => {
    const { service, pack } = setup(); pack();
    const outcomes = ['a', 'tie', 'neither', 'skip'] as const;
    const results = outcomes.map(choice => service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice }));
    expect(service.trainingRows().map(row => row.target)).toEqual([1, 0.5]);
    expect(service.snapshot().comparisons.map(row => row.choice)).toEqual(['skip', 'neither', 'tie', 'a']);
    service.undo(results[0].comparison.id); service.undo(results[1].comparison.id);
    expect(service.trainingRows()).toHaveLength(0);
    expect(service.snapshot().models[0].weights).toEqual([0, 0]);
    expect(service.snapshot().comparisons.filter(row => row.undone)).toHaveLength(2);
    expect(() => service.undo(results[0].comparison.id)).toThrow(/already/);
  });
  it('reissues an undone learning pair with a fresh prediction while preserving the original audit', () => {
    const { store, service } = setup();
    const dataset = service.createDataset({ id: 'correctable', title: 'Two choices', domain: 'content', prompt: 'Pick', units: [makeItem(1), makeItem(2)], provenance: 'Authored fixture', evaluation: false });
    const first = service.startComparison({ datasetId: dataset.id });
    const originalPrediction = store.get('predictions', first.exposure.id);
    const result = service.answer({ exposureId: first.exposure.id, choice: 'a' });
    expect(() => service.startComparison({ datasetId: dataset.id })).toThrow(/Every available pair/);
    service.undo(result.comparison.id);
    const corrected = service.startComparison({ datasetId: dataset.id, unitIds: [first.a.id, first.b.id] });
    expect(corrected.exposure.id).not.toBe(first.exposure.id);
    expect(corrected.exposure.modelVersion).toBe(2);
    expect(corrected.a).toEqual(first.a); expect(corrected.b).toEqual(first.b);
    expect(service.startComparison({ datasetId: dataset.id }).exposure.id).toBe(corrected.exposure.id);
    expect(store.get('predictions', first.exposure.id)).toEqual(originalPrediction);
    expect(store.get('exposures', first.exposure.id)).toEqual(first.exposure);
    expect(store.get('comparisons', result.comparison.id)).toMatchObject({ undone: true });
    expect(store.get('predictions', corrected.exposure.id)).toMatchObject({ modelVersion: 2, probabilityA: 0.5 });
    expect(service.exportData().predictions.some(row => row.exposureId === corrected.exposure.id)).toBe(false);
    expect(() => service.answer({ exposureId: first.exposure.id, choice: 'b' })).toThrow(/already been answered/);
    service.answer({ exposureId: corrected.exposure.id, choice: 'b' });
    expect(service.trainingRows()).toHaveLength(1);
    expect(service.trainingRows()[0]).toMatchObject({ exposureId: corrected.exposure.id, target: 0 });
    expect(() => service.startComparison({ datasetId: dataset.id })).toThrow(/Every available pair/);
  });
  it.each(['test', 'tournament'] as const)('keeps an undone %s pair ineligible for replay', mode => {
    const { service } = setup();
    const dataset = service.createDataset({ id: `no-replay-${mode}`, title: 'Protected mode', domain: 'content', prompt: 'Pick', units: Array.from({ length: mode === 'test' ? 4 : 2 }, (_, index) => makeItem(index)), provenance: 'Authored fixture', evaluation: mode === 'test' });
    const pair = service.startComparison({ datasetId: dataset.id, mode });
    const answer = service.answer({ exposureId: pair.exposure.id, choice: 'a' });
    service.undo(answer.comparison.id);
    expect(() => service.startComparison({ datasetId: dataset.id, mode })).toThrow(/Every available pair/);
    if (mode === 'test') expect(() => service.startComparison({ datasetId: dataset.id, mode: 'learn', unitIds: [pair.a.id, pair.b.id] })).toThrow(/Held-out/);
    expect(() => service.answer({ exposureId: pair.exposure.id, choice: 'b' })).toThrow(/already been answered/);
    expect(service.trainingRows()).toHaveLength(0);
  });
  it('holds out entities deterministically and never trains on test answers, even after later rebuilds', () => {
    const { service, pack } = setup(); const dataset = pack();
    const train = service.startComparison({ datasetId: dataset.id, mode: 'learn' });
    service.answer({ exposureId: train.exposure.id, choice: 'a' });
    const before = service.snapshot().models[0];
    const test = service.startComparison({ datasetId: dataset.id, mode: 'test' });
    expect(dataset.itemRefs.find(ref => ref.id === test.a.id)?.partition).toBe('test');
    expect([train.a.id, train.b.id]).not.toContain(test.a.id);
    const revealed = service.answer({ exposureId: test.exposure.id, choice: 'b' });
    expect(revealed.modelVersion).toBe(before.version);
    expect(service.snapshot().models[0]).toEqual(before);
    expect(service.snapshot().evaluations[0]).toMatchObject({ count: 1, correct: 0, baselineCorrect: 0 });
    const nextTrain = service.startComparison({ datasetId: dataset.id }); service.answer({ exposureId: nextTrain.exposure.id, choice: 'a' });
    expect(service.trainingRows()).toHaveLength(2);
    expect(service.exportData().trainingRows.some(row => row.exposureId === test.exposure.id)).toBe(false);
    const second = service.createDataset({ id: 'pack-2', title: 'Same units', domain: 'content', prompt: 'Pick', units: Array.from({ length: 16 }, (_, index) => makeItem(index)), provenance: 'Repeated pack' });
    const anotherTest = service.startComparison({ datasetId: second.id, mode: 'test' });
    expect([train.a.id, train.b.id, nextTrain.a.id, nextTrain.b.id]).not.toContain(anotherTest.a.id);
    expect([train.a.id, train.b.id, nextTrain.a.id, nextTrain.b.id]).not.toContain(anotherTest.b.id);
  });
  it('does not permit manual pairs to consume the test partition or change an unanswered locked pair', () => {
    const { service, pack } = setup(); const dataset = pack();
    const tests = dataset.itemRefs.filter(ref => ref.partition === 'test');
    expect(() => service.startComparison({ datasetId: 'pack', unitIds: [tests[0].id, tests[1].id] })).toThrow(/Held-out/);
    const train = dataset.itemRefs.filter(ref => ref.partition === 'train');
    const prompt = service.startComparison({ datasetId: 'pack', unitIds: [train[0].id, train[1].id] });
    expect(prompt.exposure.selectionPolicy).toBe('user-selected-training-pair-v1');
    expect(() => service.startComparison({ datasetId: 'pack', unitIds: [train[2].id, train[3].id] })).toThrow(/current pair/);
  });
  it('records weak observations without training and creates correctable grounded knowledge facts', () => {
    const { service } = setup(); service.saveUnit(makeItem(1));
    service.observe({ unitId: 'unit-1', kind: 'open' }); service.observe({ unitId: 'unit-1', kind: 'dwell', durationMs: 1200 });
    const known = service.observe({ unitId: 'unit-1', kind: 'known' });
    expect(service.snapshot().observationCount).toBe(3);
    expect(service.snapshot().models).toHaveLength(0);
    expect(service.trainingRows()).toHaveLength(0);
    expect(service.getFacts()[0].supportingEventIds).toContain(known.id);
    expect(service.rank([makeItem(1)], context)[0].knownConcepts).toEqual(['Concept 1']);
    service.deleteFact(service.getFacts()[0].id);
    expect(service.rank([makeItem(1)], context)[0].knownConcepts).toEqual([]);
  });
  it('uses only actual tournament wins and can finish without inventing extra comparisons', () => {
    const { service, pack } = setup(); const dataset = pack();
    const count = dataset.itemRefs.filter(ref => ref.partition === 'train').length;
    for (let round = 0; round < count - 1; round++) {
      const prompt = service.startComparison({ datasetId: 'pack', mode: 'tournament' });
      service.answer({ exposureId: prompt.exposure.id, choice: 'a' });
    }
    expect(() => service.startComparison({ datasetId: 'pack', mode: 'tournament' })).toThrow(/Tournament complete/);
    expect(service.trainingRows()).toHaveLength(count - 1);
  });
  it('persists versioned items, labels and actual model parameters across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'valuerank-personal-')); toRemove.push(dir); const path = join(dir, 'db.sqlite');
    const { store, service, pack } = setup(path); pack();
    const prompt = service.startComparison({ datasetId: 'pack' }); service.answer({ exposureId: prompt.exposure.id, choice: 'a' });
    const exported = service.exportData(); store.close(); toClose.splice(toClose.indexOf(store), 1);
    const reloaded = setup(path).service;
    expect(reloaded.exportData()).toEqual(exported);
  });
  it('hard-deletes selected training evidence and all old model snapshots derived from it', () => {
    const { service, pack } = setup(); pack();
    const first = service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice: 'a' });
    const second = service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice: 'b' });
    service.deleteComparison(first.comparison.id);
    const exported = service.exportData();
    expect(exported.comparisons.map(row => row.id)).toEqual([second.comparison.id]);
    expect(exported.predictions.some(prediction => prediction.exposureId === first.comparison.exposureId)).toBe(false);
    expect(exported.models).toHaveLength(1);
    expect(exported.models[0].version).toBe(3);
    expect(exported.models[0].trainingCount).toBe(1);
  });
  it('deleting a dataset removes unreferenced raw observations and preserves another dataset', () => {
    const { service, pack } = setup(); pack();
    service.observe({ unitId: 'unit-1', kind: 'known' });
    service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice: 'a' });
    service.createDataset({ id: 'keep', title: 'Other', domain: 'content', prompt: 'Pick', units: Array.from({ length: 8 }, (_, index) => makeItem(index + 10, { id: `keep-${index}`, body: `Other example ${index}` })), provenance: 'Authored' });
    service.deleteDataset('pack');
    expect(service.datasets().map(dataset => dataset.id)).toEqual(['keep']);
    expect(service.exportData().units.every(item => item.id.startsWith('keep'))).toBe(true);
    expect(service.snapshot().comparisons).toHaveLength(0);
    expect(service.snapshot().observationCount).toBe(0);
    expect(service.getFacts()).toHaveLength(0);
    expect(service.snapshot().models[0].trainingCount).toBe(0);
  });
  it('deleting a session removes its derived dataset but retains unrelated explicit profile statements', () => {
    const { service } = setup();
    const units = Array.from({ length: 8 }, (_, index) => makeItem(index));
    const session: PersonalSearchSession = { id: 'session', query: context.query, context, createdAt: date, updatedAt: date, status: 'completed', questions: [], answers: {}, sources: [], units, events: [], answer: 'Grounded answer', round: 1 };
    service.saveSession(session); service.createDataset({ id: 'session-pack', title: 'Search', domain: 'content', prompt: 'Pick', units, context, provenance: 'Search' });
    service.setFact({ kind: 'value', value: 'Prefer depth' });
    service.deleteSession('session');
    expect(service.listSessions()).toHaveLength(0); expect(service.datasets()).toHaveLength(0); expect(service.exportData().units).toHaveLength(0);
    expect(service.getFacts()[0].value).toBe('Prefer depth');
  });
  it('groups alternate images or source passages by entity to prevent partition leakage', () => {
    const { service } = setup();
    const units = Array.from({ length: 12 }, (_, index) => makeItem(index, { entityId: `person-${Math.floor(index / 2)}` }));
    const dataset = service.createDataset({ title: 'Entity pack', domain: 'content', prompt: 'Pick', units, provenance: 'Authored' });
    for (let i = 0; i < units.length; i += 2) expect(dataset.itemRefs[i].partition).toBe(dataset.itemRefs[i + 1].partition);
    const prompt = service.startComparison({ datasetId: dataset.id }); expect(prompt.a.entityId).not.toBe(prompt.b.entityId);
  });
  it('supports small or explicitly learning-only search packs without pretending to hold out items', () => {
    const { service } = setup();
    const units = [makeItem(1, { entityId: 'same-source' }), makeItem(2, { entityId: 'same-source' })];
    const dataset = service.createDataset({ title: 'Two cards', domain: 'content', prompt: 'Which is useful?', units, provenance: 'Search', evaluation: false });
    expect(dataset.itemRefs.every(ref => ref.partition === 'train')).toBe(true);
    const pair = service.startComparison({ datasetId: dataset.id });
    expect(pair.a.entityId).toBe(pair.b.entityId);
    service.answer({ exposureId: pair.exposure.id, choice: 'b' });
    expect(service.trainingRows()).toHaveLength(1);
    expect(() => service.startComparison({ datasetId: dataset.id, mode: 'test' })).toThrow(/held-out/);
  });
  it('does not expose pending blind predictions in exports', () => {
    const { service, pack } = setup(); pack();
    const prompt = service.startComparison({ datasetId: 'pack' });
    expect(service.exportData().predictions).toHaveLength(0);
    service.answer({ exposureId: prompt.exposure.id, choice: 'skip' });
    expect(service.exportData().predictions).toHaveLength(1);
  });
  it('rejects image-source active schemes and duplicate-asset entity relabeling across imports', () => {
    const { service } = setup();
    const picture = makeItem(1, { modality: 'image', imageUrl: 'https://example.com/person.jpg', entityId: 'person-a', rights: 'User provided' });
    service.saveUnit(picture);
    expect(() => service.saveUnit(makeItem(2, { modality: 'image', imageUrl: picture.imageUrl, entityId: 'person-b', rights: 'User provided' }))).toThrow(/same entity ID/);
    expect(() => service.saveUnit(makeItem(3, { modality: 'image', imageUrl: picture.imageUrl + '#different-fragment', entityId: 'person-b', rights: 'User provided' }))).toThrow(/same entity ID/);
    expect(() => service.saveUnit(makeItem(4, { modality: 'image', imageUrl: 'https://example.com/other.jpg', rights: 'User provided', imageSourceUrl: 'javascript:alert(1)' }))).toThrow(/HTTP/);
    service.saveUnit(makeItem(5, { modality: 'image', imageUrl: picture.imageUrl, entityId: 'person-a', rights: 'User provided' }));
    expect(service.exportData().units).toHaveLength(2);
  });
  it('hard deletion invalidates forecasts derived from erased labels while preserving other actual choices', () => {
    const { service, pack } = setup(); pack();
    const first = service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice: 'a' });
    const second = service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice: 'b' });
    const test = service.startComparison({ datasetId: 'pack', mode: 'test' });
    service.answer({ exposureId: test.exposure.id, choice: 'a' });
    const pending = service.startComparison({ datasetId: 'pack' });
    expect(service.snapshot().testCount).toBe(1);
    service.deleteComparison(first.comparison.id);
    const exported = service.exportData();
    expect(exported.comparisons.map(comparison => comparison.id)).toContain(second.comparison.id);
    expect(exported.comparisons.some(comparison => comparison.exposureId === test.exposure.id)).toBe(true);
    expect(exported.exposures.some(exposure => exposure.id === test.exposure.id)).toBe(true);
    expect(exported.exposures.some(exposure => exposure.id === pending.exposure.id)).toBe(false);
    expect(exported.predictions).toHaveLength(0);
    expect(service.snapshot().testCount).toBe(0);
    expect(service.snapshot().evaluations[0].logLoss).toBeNull();
    expect(service.trainingRows()).toHaveLength(1);
    expect(service.startComparison({ datasetId: 'pack' }).exposure.id).not.toBe(pending.exposure.id);
  });
  it('checkpoints validated pending cards without freezing their unfinished feature vector', () => {
    const { service } = setup();
    const draft = makeItem(1, { sourceIds: [source.id], evidence: [{ sourceId: source.id, sourceVersion: 1, quote: 'An exact grounded quote.' }] });
    const session: PersonalSearchSession = { id: 'draft-session', query: context.query, context, createdAt: date, updatedAt: date, status: 'ranking', questions: [], answers: {}, sources: [source], units: [], pendingUnits: [draft], events: [], answer: '', round: 1 };
    service.saveSession(session);
    expect(service.getSession(session.id)?.pendingUnits).toEqual([draft]);
    expect(service.exportData().units).toHaveLength(0);
    const scored = { ...draft, prior: 0.7, features: { ...draft.features, values: [0.9, 0.1], encoder: 'jev-scored' } };
    service.saveSession({ ...session, units: [scored], pendingUnits: [] });
    expect(service.exportData().units).toEqual([scored]);
    expect(service.getSession(session.id)?.pendingUnits).toEqual([]);
    expect(() => service.saveSession({ ...session, pendingUnits: [{ ...draft, evidence: [{ sourceId: source.id, sourceVersion: 1, quote: 'Fabricated' }] }] })).toThrow(/quote/);
  });
  it('full deletion actually erases source data, derived vectors, predictions, facts and model history', () => {
    const { service, pack } = setup(); pack(); service.saveSource(source);
    service.answer({ exposureId: service.startComparison({ datasetId: 'pack' }).exposure.id, choice: 'a' }); service.setFact({ kind: 'value', value: 'Depth' });
    service.deleteData();
    const exported = service.exportData();
    for (const [key, value] of Object.entries(exported)) if (Array.isArray(value)) expect(value, key).toHaveLength(0);
  });
});
