import type { PersonalContext, PersonalModel } from './personal.ts';

export const PERSONAL_EVALUATION_PROTOCOL = 'frozen-disjoint-entities-v1' as const;
export type EvaluationInvalidationReason = 'training-data-deleted' | 'test-data-deleted' | 'test-entity-exposed';
export interface EvaluationItemRef { id: string; version: number }
export interface PersonalEvaluationPair {
  a: EvaluationItemRef;
  b: EvaluationItemRef;
  entityA: string;
  entityB: string;
}

/** Private reproducibility record. A run never changes model or reuses an entity. */
export interface PersonalEvaluationRun {
  id: string;
  protocol: typeof PERSONAL_EVALUATION_PROTOCOL;
  datasetId: string;
  datasetVersion: number;
  domain: string;
  featureSchemaId: string;
  featureNames: string[];
  context: PersonalContext;
  prompt: string;
  modelId: string | null;
  modelVersion: number;
  trainingCount: number;
  frozenModel: PersonalModel | null;
  pairs: PersonalEvaluationPair[];
  createdAt: string;
  status: 'active' | 'invalidated';
  invalidatedAt?: string;
  invalidationReason?: EvaluationInvalidationReason;
}

/** Metrics are for one fixed run; legacy observations are counted, never pooled. */
export interface PersonalEvaluationSummary {
  datasetId: string;
  datasetVersion: number;
  domain: string;
  runId: string | null;
  protocol: typeof PERSONAL_EVALUATION_PROTOCOL | 'not-started';
  modelVersion: number;
  featureSchemaId: string | null;
  contextId: string;
  contextVersion: number;
  scopeId?: string;
  status: 'not-started' | 'active' | 'completed' | 'invalidated';
  invalidationReason?: EvaluationInvalidationReason;
  plannedPairCount: number;
  answeredCount: number;
  undoneCount: number;
  nonDirectionalCount: number;
  excludedCount: number;
  legacyAnswerCount: number;
  uniqueEntityCount: number;
  count: number;
  correct: number;
  baselineCorrect: number;
  logLoss: number | null;
  brier: number | null;
  baselineLogLoss: number | null;
  baselineBrier: number | null;
}
