import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { predictPair } from '../src/domain/personal-model.ts';
import type { PersonalContext, PersonalExposure, PersonalUnit } from '../src/domain/personal.ts';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService } from './personal-service.ts';

const at = '2026-09-27T12:00:00.000Z';
const context: PersonalContext = { id: 'research-session', version: 3, query: 'Choose a memory system', goal: 'Ship a prototype this week', answers: { budget: 'small' }, scopeId: 'workspace-1' };
const item = (index: number, version = 1): PersonalUnit => ({
  id: `unit-${index}`, version, entityId: `entity-${index}`, domain: 'content', modality: 'text', kind: 'fixture',
  title: `Research option ${index}`, body: `Authored isolated fixture ${index}`, sourceIds: [], evidence: [], concepts: [], limitations: ['Synthetic fixture; not user evidence'], effortMinutes: 1, prior: 0, createdAt: at,
  features: { schemaId: 'evaluation-fixture-v1', names: ['depth', 'brevity'], values: [index / 100, 1 - index / 100], encoder: 'authored-test', model: 'none', contextVersion: version },
});
const stores: ReturnType<typeof createPersonalStore>[] = [];
const directories: string[] = [];
afterEach(() => { stores.splice(0).forEach(store => store.close()); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function setup(path = ':memory:') {
  const store = createPersonalStore(path); stores.push(store);
  const service = createPersonalService(store, { now: () => at, random: () => 0.73 });
  const pack = (options: { id?: string; units?: PersonalUnit[]; context?: PersonalContext; evaluation?: boolean } = {}) => service.createDataset({ id: options.id ?? 'pack', title: 'Research options', domain: 'content', prompt: 'Which helps this project?', context: options.context ?? context, units: options.units ?? Array.from({ length: 32 }, (_, index) => item(index)), provenance: 'Authored isolated test fixtures', evaluation: options.evaluation });
  const learn = () => { const pair = service.startComparison({ datasetId: 'pack' }); return service.answer({ exposureId: pair.exposure.id, choice: pair.a.features.values[0] > pair.b.features.values[0] ? 'a' : 'b' }); };
  const test = () => service.startComparison({ datasetId: 'pack', mode: 'test' });
  return { store, service, pack, learn, test };
}

describe('frozen personal evaluation runs', () => {
  it('freezes model, dataset, schema, context and scope while later learning continues', () => {
    const { store, service, pack, learn, test } = setup(); pack(); learn();
    const first = test(); const run = store.all('evaluation_runs')[0];
    expect(run).toMatchObject({ datasetVersion: 1, featureSchemaId: 'evaluation-fixture-v1', context, modelVersion: 1, trainingCount: 1, status: 'active' });
    expect(first.exposure).toMatchObject({ evaluationRunId: run.id, modelVersion: 1, context });
    expect(JSON.stringify(first)).not.toContain('probabilityA');
    service.answer({ exposureId: first.exposure.id, choice: 'a' });
    learn(); learn();
    expect(service.getModels()[0].version).toBe(3);
    const next = test();
    expect(next.exposure.modelVersion).toBe(1);
    expect(next.exposure.evaluationRunId).toBe(run.id);
    expect(store.get('predictions', next.exposure.id)?.probabilityA).toBe(predictPair(next.a, next.b, run.frozenModel!));
    expect(store.all('evaluation_runs')[0]).toEqual(run);
    expect(service.trainingRows()).toHaveLength(3);
  });

  it('uses each held-out entity once and reports unique entities beside directional pairs', () => {
    const { service, pack, test } = setup(); pack();
    const entities: string[] = [];
    for (let index = 0; index < 4; index++) {
      const pair = test(); entities.push(pair.a.entityId!, pair.b.entityId!);
      service.answer({ exposureId: pair.exposure.id, choice: index % 2 ? 'b' : 'a' });
    }
    expect(new Set(entities).size).toBe(8);
    expect(() => test()).toThrow(/Every available pair/);
    expect(service.evaluations()[0]).toMatchObject({ count: 4, uniqueEntityCount: 8, plannedPairCount: 4, answeredCount: 4, status: 'completed', baselineBrier: 0.25 });
    expect(service.trainingRows()).toHaveLength(0);
  });

  it('preserves an unanswered pair and a frozen model through a database reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'valuerank-frozen-eval-')); directories.push(directory);
    const path = join(directory, 'personal.sqlite'); const initial = setup(path); initial.pack(); initial.learn();
    const first = initial.test(); const exported = initial.service.exportData();
    expect(exported.predictions.some(prediction => prediction.exposureId === first.exposure.id)).toBe(false);
    expect(JSON.stringify(exported.evaluationRuns)).not.toContain('probabilityA');
    initial.store.close(); stores.splice(stores.indexOf(initial.store), 1);
    const resumed = setup(path);
    expect(resumed.test()).toEqual(first);
    expect(resumed.service.exportData()).toEqual(exported);
    expect(() => resumed.store.saveEvaluationRun({ ...exported.evaluationRuns[0], modelVersion: 99 })).toThrow(/frozen/);
  });

  it('separates revised dataset and context runs instead of pooling old metrics', () => {
    const { store, service, pack, test, learn } = setup(); pack(); learn();
    const first = test(); service.answer({ exposureId: first.exposure.id, choice: 'a' });
    const oldRun = store.all('evaluation_runs')[0];
    const newContext = { ...context, version: 4, goal: 'Compare production options', scopeId: 'workspace-2' };
    pack({ units: Array.from({ length: 32 }, (_, index) => item(index + 40)), context: newContext });
    expect(service.evaluations()[0]).toMatchObject({ datasetVersion: 2, contextVersion: 4, scopeId: 'workspace-2', count: 0, runId: null });
    const next = test(); service.answer({ exposureId: next.exposure.id, choice: 'b' });
    const current = service.evaluations()[0];
    expect(current).toMatchObject({ datasetVersion: 2, contextVersion: 4, scopeId: 'workspace-2', count: 1, uniqueEntityCount: 2 });
    expect(current.runId).not.toBe(oldRun.id);
    expect(service.snapshot().evaluationHistory.map(result => [result.datasetVersion, result.contextVersion, result.count])).toEqual([[1, 3, 1], [2, 4, 1]]);
    expect(store.all('evaluation_runs')[0].context).toEqual(context);
  });

  it('groups alternate images and revisions as the same entity across datasets', () => {
    const { store, service, pack, test } = setup();
    const units = Array.from({ length: 64 }, (_, index) => ({ ...item(index), entityId: `entity-${Math.floor(index / 2)}` }));
    pack({ units }); const first = test();
    const run = store.all('evaluation_runs')[0];
    const allEntities = run.pairs.flatMap(pair => [pair.entityA, pair.entityB]);
    expect(new Set(allEntities).size).toBe(allEntities.length);
    service.answer({ exposureId: first.exposure.id, choice: 'a' });
    pack({ id: 'duplicate-pack', units: units.map(unit => ({ ...unit, version: 2 })) });
    expect(() => service.startComparison({ datasetId: 'duplicate-pack', mode: 'test' })).toThrow(/unseen held-out entities/);
  });

  it('reserves future frozen trials against training from a second collection', () => {
    const { store, service, pack, test } = setup(); pack(); test();
    const future = store.all('evaluation_runs')[0].pairs[1];
    const units = [store.get('units', future.a.id, future.a.version)!, store.get('units', future.b.id, future.b.version)!, item(90), item(91)];
    const other = pack({ id: 'learning-only', units, evaluation: false });
    expect(() => service.startComparison({ datasetId: other.id, unitIds: [future.a.id, future.b.id] })).toThrow(/Held-out/);
    const allowed = service.startComparison({ datasetId: other.id });
    expect([allowed.a.id, allowed.b.id].sort()).toEqual(['unit-90', 'unit-91']);
  });

  it('does not reuse skipped, tied, neither, or undone test trials as new samples', () => {
    const { service, pack, test } = setup(); pack();
    const choices = ['skip', 'tie', 'neither', 'a'] as const;
    const answers = choices.map(choice => service.answer({ exposureId: test().exposure.id, choice }));
    service.undo(answers[3].comparison.id);
    expect(() => test()).toThrow(/Every available pair/);
    expect(service.evaluations()[0]).toMatchObject({ count: 0, uniqueEntityCount: 0, answeredCount: 4, nonDirectionalCount: 3, undoneCount: 1, status: 'completed' });
    expect(service.trainingRows()).toHaveLength(0);
  });

  it('keeps legacy choices intact and separate from frozen-run accuracy', () => {
    const { store, service, pack, test } = setup(); const dataset = pack();
    const refs = dataset.itemRefs.filter(ref => ref.partition === 'test');
    const exposure: PersonalExposure = { id: 'legacy-test', datasetId: dataset.id, datasetVersion: 1, mode: 'test', a: refs[0], b: refs[1], context, modelVersion: 7, selectionPolicy: 'heldout-random-v1', createdAt: at };
    store.saveExposure(exposure, { exposureId: exposure.id, probabilityA: 0.8, baselineProbabilityA: 0.5, modelVersion: 7, createdAt: at });
    store.saveComparison({ id: 'legacy-choice', exposureId: exposure.id, choice: 'a', createdAt: at, undone: false });
    const before = store.get('comparisons', 'legacy-choice');
    expect(service.evaluations()[0]).toMatchObject({ count: 0, legacyAnswerCount: 1, runId: null });
    const fresh = test(); service.answer({ exposureId: fresh.exposure.id, choice: 'b' });
    expect([fresh.a.id, fresh.b.id]).not.toContain(exposure.a.id);
    expect([fresh.a.id, fresh.b.id]).not.toContain(exposure.b.id);
    expect(service.evaluations()[0]).toMatchObject({ count: 1, legacyAnswerCount: 1, uniqueEntityCount: 2 });
    expect(store.get('comparisons', 'legacy-choice')).toEqual(before);
    expect(service.exportData().comparisons).toHaveLength(2);
  });

  it('rejects duplicate trial rows and mixed model versions when summarizing', () => {
    const { store, service, pack, test } = setup(); pack();
    const first = test(); service.answer({ exposureId: first.exposure.id, choice: 'a' });
    const prediction = store.get('predictions', first.exposure.id)!;
    const duplicate = { ...first.exposure, id: 'duplicate-exposure' };
    store.saveExposure(duplicate, { ...prediction, exposureId: duplicate.id });
    store.saveComparison({ id: 'duplicate-answer', exposureId: duplicate.id, choice: 'a', undone: false, createdAt: at });
    const next = test();
    // Simulate an incompatible historical prediction without changing the model.
    store.remove('predictions', next.exposure.id); store.remove('exposures', next.exposure.id);
    store.saveExposure(next.exposure, { exposureId: next.exposure.id, probabilityA: 0.99, baselineProbabilityA: 0.5, modelVersion: 99, createdAt: at });
    service.answer({ exposureId: next.exposure.id, choice: 'a' });
    expect(service.evaluations()[0]).toMatchObject({ count: 1, uniqueEntityCount: 2, answeredCount: 3, excludedCount: 2 });
  });

  it('does not let a duplicate replace a skipped or undone trial in the metrics', () => {
    const { store, service, pack, test } = setup(); pack();
    const first = test(); const answer = service.answer({ exposureId: first.exposure.id, choice: 'a' }); service.undo(answer.comparison.id);
    const duplicate = { ...first.exposure, id: 'duplicate-after-undo' };
    store.saveExposure(duplicate, { ...store.get('predictions', first.exposure.id)!, exposureId: duplicate.id });
    store.saveComparison({ id: 'duplicate-answer', exposureId: duplicate.id, choice: 'a', undone: false, createdAt: at });
    expect(service.evaluations()[0]).toMatchObject({ count: 0, uniqueEntityCount: 0, answeredCount: 2, undoneCount: 1, excludedCount: 1 });
  });

  it('erases frozen weights on training-data deletion and keeps shown test entities seen', () => {
    const { store, service, pack, learn, test } = setup(); pack(); const training = learn();
    const answered = test(); service.answer({ exposureId: answered.exposure.id, choice: 'a' });
    const pending = test(); service.deleteComparison(training.comparison.id);
    expect(store.all('evaluation_runs')[0]).toMatchObject({ frozenModel: null, status: 'invalidated', invalidationReason: 'training-data-deleted' });
    expect(service.evaluations()[0]).toMatchObject({ status: 'invalidated', count: 0, excludedCount: 1, logLoss: null });
    expect(store.get('exposures', pending.exposure.id)).toEqual(pending.exposure);
    expect(store.get('predictions', pending.exposure.id)).toBeUndefined();
    expect(() => service.answer({ exposureId: pending.exposure.id, choice: 'a' })).toThrow(/invalidated/);
    const fresh = test();
    const seen = [answered.a.id, answered.b.id, pending.a.id, pending.b.id];
    expect(seen).not.toContain(fresh.a.id); expect(seen).not.toContain(fresh.b.id);
    expect(fresh.exposure.evaluationRunId).not.toBe(answered.exposure.evaluationRunId);
  });

  it('removes evaluation records with their dataset and with full deletion', () => {
    const { store, service, pack, test } = setup(); pack(); const pair = test(); service.answer({ exposureId: pair.exposure.id, choice: 'a' });
    service.deleteDataset('pack');
    expect(store.all('evaluation_runs')).toHaveLength(0); expect(service.snapshot().evaluationHistory).toHaveLength(0);
    pack(); test(); service.deleteData();
    expect(service.exportData().evaluationRuns).toHaveLength(0);
    expect(service.snapshot().testCount).toBe(0);
  });

  it('invalidates a frozen run if a future entity is viewed without silently replacing its pair', () => {
    const { store, service, pack, learn, test } = setup(); pack(); learn();
    const first = test(); service.answer({ exposureId: first.exposure.id, choice: 'a' });
    const run = store.all('evaluation_runs')[0];
    const future = run.pairs[1];
    const original = store.get('units', future.a.id, future.a.version)!;
    service.saveUnit({ ...original, version: 2 });
    service.observe({ unitId: original.id, unitVersion: 2, kind: 'open' });
    const exposureCount = store.all('exposures').length;
    expect(() => test()).toThrow(/reserved entity was viewed outside/);
    expect(store.all('exposures')).toHaveLength(exposureCount);
    expect(store.all('evaluation_runs')).toHaveLength(1);
    expect(store.get('evaluation_runs', run.id)).toMatchObject({ status: 'invalidated', invalidationReason: 'test-entity-exposed', frozenModel: run.frozenModel, pairs: run.pairs });
    expect(service.evaluations()[0]).toMatchObject({ status: 'invalidated', invalidationReason: 'test-entity-exposed', count: 0, excludedCount: 1 });
    expect(service.snapshot().evaluationHistory[0].invalidationReason).toBe('test-entity-exposed');
    // A later explicit start creates a distinct run, excluding the viewed entity.
    const restarted = test();
    expect(restarted.exposure.evaluationRunId).not.toBe(run.id);
    expect(store.all('evaluation_runs')[1].pairs.flatMap(pair => [pair.entityA, pair.entityB])).not.toContain(future.entityA);
  });

  it('does not treat viewing an already presented test item as a new contamination', () => {
    const { service, pack, test } = setup(); pack();
    const first = test(); service.observe({ unitId: first.a.id, kind: 'open' });
    expect(test()).toEqual(first);
    service.answer({ exposureId: first.exposure.id, choice: 'a' });
    expect(test().exposure.evaluationRunId).toBe(first.exposure.evaluationRunId);
    expect(service.evaluations()[0]).toMatchObject({ status: 'active', count: 1 });
  });

  it('deleting a test answer invalidates only its run and keeps shown entities seen', () => {
    const { store, service, pack, learn, test } = setup(); pack(); learn();
    const first = test(); const answer = service.answer({ exposureId: first.exposure.id, choice: 'a' });
    const pending = test();
    pack({ id: 'other', units: Array.from({ length: 32 }, (_, index) => item(index + 40)) });
    const other = service.startComparison({ datasetId: 'other', mode: 'test' });
    service.answer({ exposureId: other.exposure.id, choice: 'b' });
    const models = store.all('models'); const otherRun = store.get('evaluation_runs', other.exposure.evaluationRunId!)!;
    service.deleteComparison(answer.comparison.id);
    expect(store.all('models')).toEqual(models);
    expect(store.get('evaluation_runs', otherRun.id)).toEqual(otherRun);
    expect(service.evaluations().find(result => result.datasetId === 'other')?.count).toBe(1);
    expect(store.get('exposures', first.exposure.id)).toEqual(first.exposure);
    expect(() => service.answer({ exposureId: pending.exposure.id, choice: 'a' })).toThrow(/invalidated/);
    const restarted = test();
    expect(restarted.exposure.evaluationRunId).not.toBe(first.exposure.evaluationRunId);
    const seen = [first.a.id, first.b.id, pending.a.id, pending.b.id];
    expect(seen).not.toContain(restarted.a.id); expect(seen).not.toContain(restarted.b.id);
  });
});
