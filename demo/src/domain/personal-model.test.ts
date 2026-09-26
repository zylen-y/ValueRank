import { describe, expect, it } from 'vitest';
import type { PersonalTrainingRow, PersonalUnit } from './personal.ts';
import { fitPersonalModel, predictPair } from './personal-model.ts';
const item = (id: string, x: number, y = 0, prior = 0): PersonalUnit => ({ id, version: 1, domain: 'design', modality: 'text', kind: 'example', title: id, body: id, sourceIds: [], evidence: [], concepts: [], limitations: [], effortMinutes: 1, prior, createdAt: '2026-09-26T00:00:00.000Z', features: { schemaId: 'synthetic-v1', names: ['minimalism', 'warmth'], values: [x, y], encoder: 'authored-example', model: 'none', contextVersion: 1 } });
const fit = (rows: PersonalTrainingRow[]) => fitPersonalModel({ id: 'test', domain: 'design', schemaId: 'synthetic-v1', featureNames: ['minimalism', 'warmth'], version: 1, rows, createdAt: '2026-09-26T00:00:00.000Z' });
const row = (a: PersonalUnit, b: PersonalUnit, target: number, id = 'r'): PersonalTrainingRow => ({ comparisonId: id, exposureId: id, domain: 'design', schemaId: 'synthetic-v1', context: { id: 'c', version: 1, query: '', goal: '', answers: {} }, a, b, target });

describe('trainable feature-based personal head', () => {
  it('updates actual parameters and generalizes a synthetic preference to unseen feature vectors', () => {
    const model = fit(Array.from({ length: 12 }, (_, index) => row(item(`a${index}`, 0.6 + index / 40, index % 2 ? 0.1 : -0.1), item(`b${index}`, -0.6 - index / 40, index % 2 ? -0.1 : 0.1), 1, String(index))));
    expect(model.trainingCount).toBe(12);
    expect(model.weights[0]).toBeGreaterThan(1);
    expect(Math.abs(model.weights[1])).toBeLessThan(0.1);
    const novelA = item('never-seen-a', 0.8, -0.3); const novelB = item('never-seen-b', -0.7, 0.4);
    expect(predictPair(novelA, novelB)).toBe(0.5);
    expect(predictPair(novelA, novelB, model)).toBeGreaterThan(0.8);
    expect(predictPair(novelB, novelA, model)).toBeCloseTo(1 - predictPair(novelA, novelB, model));
  });
  it('fits deterministically from the remaining ledger after undo, with zero learned signal at cold start', () => {
    const rows = [row(item('a', 1), item('b', -1), 1), row(item('c', 0.3), item('d', -0.6), 0, 'r2')];
    expect(fit(rows).weights).toEqual(fit(rows).weights);
    expect(fit([]).weights).toEqual([0, 0]);
    expect(fit(rows.slice(0, 1)).weights).not.toEqual(fit(rows).weights);
  });
  it('keeps prior probabilities separate and ties are a half label rather than a directional win', () => {
    const a = item('a', 1, 0, 0.8); const b = item('b', -1, 0, -0.8);
    const model = fit(Array.from({ length: 10 }, (_, index) => row(a, b, 0.5, String(index))));
    expect(predictPair(a, b, model)).toBeLessThan(predictPair(a, b));
    expect(model.weights[0]).toBeLessThan(0);
    expect(a.prior).toBe(0.8);
  });
  it('does not apply weights to another domain or incompatible schema', () => {
    const model = fit([row(item('a', 1), item('b', -1), 1)]);
    const a = { ...item('new-a', 1), domain: 'portraits' }; const b = { ...item('new-b', -1), domain: 'portraits' };
    expect(predictPair(a, b, model)).toBe(0.5);
    const changed = { ...item('c', 1), features: { ...item('c', 1).features, names: ['warmth', 'minimalism'] } };
    expect(predictPair(changed, item('d', 0), model)).toBe(0.5);
  });
});
