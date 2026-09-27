import type { PersonalModel, PersonalTrainingRow, PersonalUnit } from './personal.ts';

export function sigmoid(value: number): number {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}
export function compatibleFeatures(a: PersonalUnit, b: PersonalUnit): boolean {
  return a.domain === b.domain && a.features.schemaId === b.features.schemaId &&
    a.features.names.length === b.features.names.length && a.features.names.every((name, index) => name === b.features.names[index]);
}
export function personalAdjustment(unit: PersonalUnit, model?: PersonalModel): number {
  if (!model || model.domain !== unit.domain || model.schemaId !== unit.features.schemaId ||
      model.featureNames.length !== unit.features.values.length || !model.featureNames.every((name, index) => name === unit.features.names[index])) return 0;
  return unit.features.values.reduce((score, value, index) => score + value * (model.weights[index] ?? 0), 0);
}
export function predictPair(a: PersonalUnit, b: PersonalUnit, model?: PersonalModel): number {
  return sigmoid(a.prior - b.prior + personalAdjustment(a, model) - personalAdjustment(b, model));
}

/** Fit actual user labels from scratch, making undo deterministic and avoiding update drift. */
export function fitPersonalModel(input: {
  id: string; domain: string; schemaId: string; featureNames: string[]; version: number;
  rows: PersonalTrainingRow[]; createdAt: string; scopeId?: string;
}): PersonalModel {
  const count = input.featureNames.length;
  const rows = input.rows.filter(row => row.domain === input.domain && row.schemaId === input.schemaId && row.context.scopeId === input.scopeId &&
    compatibleFeatures(row.a, row.b) && row.a.features.names.every((name, index) => name === input.featureNames[index]));
  const weights = Array<number>(count).fill(0);
  // L2 is stronger with sparse feedback. Loss is averaged, keeping update scale stable.
  const lambda = 0.06 + 0.8 / (rows.length + 4);
  for (let iteration = 0; iteration < (rows.length ? 260 : 0); iteration++) {
    const gradient = weights.map(weight => lambda * weight);
    for (const row of rows) {
      const delta = row.a.features.values.map((value, index) => value - row.b.features.values[index]);
      const logit = row.a.prior - row.b.prior + delta.reduce((sum, value, index) => sum + value * weights[index], 0);
      const residual = sigmoid(logit) - row.target;
      for (let index = 0; index < count; index++) gradient[index] += residual * delta[index] / rows.length;
    }
    const step = 0.45 / Math.sqrt(1 + iteration / 60);
    for (let index = 0; index < count; index++) weights[index] = Math.max(-8, Math.min(8, weights[index] - step * gradient[index]));
  }
  return { id: input.id, domain: input.domain, schemaId: input.schemaId, featureNames: [...input.featureNames],
    version: input.version, weights, trainingCount: rows.length, createdAt: input.createdAt, ...(input.scopeId ? { scopeId: input.scopeId } : {}) };
}
