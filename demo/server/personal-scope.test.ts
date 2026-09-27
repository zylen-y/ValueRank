import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { PersonalContext, PersonalUnit } from '../src/domain/personal.ts';
import { createPersonalService } from './personal-service.ts';
import { createPersonalStore } from './personal-store.ts';

const at = '2026-09-27T12:00:00.000Z';
const context = (scopeId?: string, version = 1): PersonalContext => ({ id: `session-${scopeId ?? 'general'}-${version}`, version, query: 'Compare research options', goal: 'Choose an approach', answers: {}, ...(scopeId ? { scopeId } : {}) });
const item = (index: number): PersonalUnit => ({ id: `item-${index}`, entityId: `entity-${index}`, version: 1, domain: 'content', modality: 'text', kind: 'fixture', title: `Fixture ${index}`, body: `Isolated synthetic item ${index}`, sourceIds: [], evidence: [], concepts: [], limitations: ['Synthetic fixture'], effortMinutes: 1, prior: 0, createdAt: at, features: { schemaId: 'scope-fixture-v1', names: ['depth'], values: [index % 2 === 0 ? 0.9 : -0.9], encoder: 'authored', model: 'none', contextVersion: 1 } });
const stores: ReturnType<typeof createPersonalStore>[] = [];
afterEach(() => stores.splice(0).forEach(store => store.close()));
function setup() {
  const store = createPersonalStore(':memory:'); stores.push(store);
  const service = createPersonalService(store, { now: () => at, random: () => 0.7 });
  const pack = (id: string, scopeId?: string, options: { version?: number; offset?: number; count?: number; evaluation?: boolean } = {}) => service.createDataset({ id, title: id, domain: 'content', prompt: 'Which is useful?', context: context(scopeId, options.version), units: Array.from({ length: options.count ?? 2 }, (_, index) => item(index + (options.offset ?? 0))), evaluation: options.evaluation ?? false, provenance: 'Isolated fixtures' });
  const choose = (id: string, preferredId: string) => { const pair = service.startComparison({ datasetId: id }); return service.answer({ exposureId: pair.exposure.id, choice: pair.a.id === preferredId ? 'a' : 'b' }); };
  return { store, service, pack, choose };
}

describe('project-scoped personal heads', () => {
  it('learns opposite preferences independently and does not silently import general history', () => {
    const { service, pack, choose } = setup(); pack('general'); pack('project-a', 'project-a'); pack('project-b', 'project-b');
    choose('general', 'item-0');
    const legacy = service.getModels()[0];
    expect(legacy.id).toBe(`head-${createHash('sha256').update('content\0scope-fixture-v1').digest('hex').slice(0, 24)}`);
    expect(legacy.scopeId).toBeUndefined();
    expect(service.rank([item(80), item(81)], context('project-a')).every(unit => unit.personalAdjustment === 0 && unit.modelVersion === 0)).toBe(true);
    choose('project-a', 'item-0'); choose('project-b', 'item-1');
    const models = service.getModels();
    expect(models).toHaveLength(3);
    expect(new Set(models.map(model => model.id)).size).toBe(3);
    expect(models.find(model => model.scopeId === 'project-a')).toMatchObject({ trainingCount: 1, version: 1 });
    expect(models.find(model => model.scopeId === 'project-a')!.weights[0]).toBeGreaterThan(0);
    expect(models.find(model => model.scopeId === 'project-b')!.weights[0]).toBeLessThan(0);
    expect(models.find(model => model.scopeId === undefined)).toEqual(legacy);
    expect(service.rank([item(80), item(81)], context('project-a'))[0].id).toBe('item-80');
    expect(service.rank([item(80), item(81)], context('project-b'))[0].id).toBe('item-81');
    expect(service.rank([item(80), item(81)])[0].id).toBe('item-80');
    expect(service.rank([item(80), item(81)], context('new-project')).every(unit => unit.modelVersion === 0)).toBe(true);
  });

  it('shares a head across sessions and refinements within one stable project scope', () => {
    const { service, pack, choose } = setup(); pack('first-session', 'project-a'); choose('first-session', 'item-0');
    const first = service.getModels()[0];
    pack('later-session', 'project-a', { version: 7, offset: 10 }); choose('later-session', 'item-10');
    expect(service.getModels()).toHaveLength(1);
    expect(service.getModels()[0]).toMatchObject({ id: first.id, scopeId: 'project-a', version: 2, trainingCount: 2 });
    expect(service.trainingRows().map(row => row.context.version)).toEqual([1, 7]);
    expect(service.rank([item(80), item(81)], context('project-a', 99))[0].modelVersion).toBe(2);
  });

  it('undo rebuilds only the affected scope without rewriting historical context', () => {
    const { service, pack, choose } = setup(); pack('project-a', 'project-a'); pack('project-b', 'project-b'); pack('general');
    const a = choose('project-a', 'item-0'); choose('project-b', 'item-1'); choose('general', 'item-0');
    const before = service.getModels(); const historical = service.exportData().exposures.find(exposure => exposure.id === a.comparison.exposureId);
    service.undo(a.comparison.id);
    expect(service.getModels().find(model => model.scopeId === 'project-a')).toMatchObject({ trainingCount: 0, version: 2, weights: [0] });
    expect(service.getModels().filter(model => model.scopeId !== 'project-a')).toEqual(before.filter(model => model.scopeId !== 'project-a'));
    expect(service.exportData().exposures.find(exposure => exposure.id === a.comparison.exposureId)).toEqual(historical);
  });

  it('hard deletion erases only that scope’s model snapshots and frozen forecasts', () => {
    const { store, service, pack, choose } = setup();
    pack('training-a', 'project-a'); pack('training-b', 'project-b', { offset: 10 });
    const a = choose('training-a', 'item-0'); choose('training-b', 'item-10');
    pack('test-a', 'project-a', { offset: 20, count: 32, evaluation: true });
    pack('test-b', 'project-b', { offset: 60, count: 32, evaluation: true });
    const testA = service.startComparison({ datasetId: 'test-a', mode: 'test' });
    const testB = service.startComparison({ datasetId: 'test-b', mode: 'test' });
    service.answer({ exposureId: testA.exposure.id, choice: 'a' }); service.answer({ exposureId: testB.exposure.id, choice: 'b' });
    const bRun = store.get('evaluation_runs', testB.exposure.evaluationRunId!)!;
    const bPrediction = store.get('predictions', testB.exposure.id);
    const bModels = store.all('models').filter(model => model.scopeId === 'project-b');
    service.deleteComparison(a.comparison.id);
    expect(store.get('evaluation_runs', testA.exposure.evaluationRunId!)).toMatchObject({ status: 'invalidated', frozenModel: null });
    expect(store.get('evaluation_runs', testB.exposure.evaluationRunId!)).toEqual(bRun);
    expect(store.get('predictions', testB.exposure.id)).toEqual(bPrediction);
    expect(store.all('models').filter(model => model.scopeId === 'project-b')).toEqual(bModels);
    expect(store.all('models').filter(model => model.scopeId === 'project-a')).toHaveLength(1);
    expect(service.getModels().find(model => model.scopeId === 'project-a')).toMatchObject({ trainingCount: 0, weights: [0] });
    expect(service.evaluations().find(result => result.datasetId === 'test-a')!.count).toBe(0);
    expect(service.evaluations().find(result => result.datasetId === 'test-b')!.count).toBe(1);
  });

  it('deleting a dataset preserves another project’s learning and current predictions', () => {
    const { store, service, pack, choose } = setup(); pack('project-a', 'project-a'); pack('project-b', 'project-b');
    choose('project-a', 'item-0'); choose('project-b', 'item-1');
    pack('next-b', 'project-b', { offset: 10 });
    const pendingB = service.startComparison({ datasetId: 'next-b' });
    const before = service.getModels().find(model => model.scopeId === 'project-b');
    const prediction = store.get('predictions', pendingB.exposure.id);
    service.deleteDataset('project-a');
    expect(service.getModels().find(model => model.scopeId === 'project-b')).toEqual(before);
    expect(store.get('predictions', pendingB.exposure.id)).toEqual(prediction);
    expect(service.trainingRows()).toHaveLength(1);
    expect(service.trainingRows()[0].context.scopeId).toBe('project-b');
    expect(service.getModels().find(model => model.scopeId === 'project-a')).toMatchObject({ trainingCount: 0, weights: [0] });
  });

  it('deleting test-only, skipped or unanswered data preserves other forecasts in the same scope', () => {
    const { store, service, pack, choose } = setup();
    pack('training', 'project-a'); choose('training', 'item-0');
    pack('test-delete', 'project-a', { offset: 20, count: 32, evaluation: true });
    pack('test-keep', 'project-a', { offset: 60, count: 32, evaluation: true });
    const removedTest = service.startComparison({ datasetId: 'test-delete', mode: 'test' });
    service.answer({ exposureId: removedTest.exposure.id, choice: 'a' });
    const keptTest = service.startComparison({ datasetId: 'test-keep', mode: 'test' });
    service.answer({ exposureId: keptTest.exposure.id, choice: 'b' });
    pack('skipped', 'project-a', { offset: 110 });
    service.answer({ exposureId: service.startComparison({ datasetId: 'skipped' }).exposure.id, choice: 'skip' });
    pack('unanswered', 'project-a', { offset: 120 }); service.startComparison({ datasetId: 'unanswered' });
    const models = store.all('models'); const keptRun = store.get('evaluation_runs', keptTest.exposure.evaluationRunId!)!;
    const prediction = store.get('predictions', keptTest.exposure.id);
    for (const id of ['test-delete', 'skipped', 'unanswered']) service.deleteDataset(id);
    expect(store.all('models')).toEqual(models);
    expect(store.get('evaluation_runs', keptRun.id)).toEqual(keptRun);
    expect(store.get('predictions', keptTest.exposure.id)).toEqual(prediction);
    expect(service.evaluations().find(result => result.datasetId === 'test-keep')).toMatchObject({ count: 1, status: 'active' });
    expect(service.trainingRows()).toHaveLength(1);
  });
});
