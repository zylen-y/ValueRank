import { randomUUID } from 'node:crypto';
import { predictPair } from '../src/domain/personal-model.ts';
import { PERSONAL_EVALUATION_PROTOCOL, type EvaluationItemRef, type PersonalEvaluationPair, type PersonalEvaluationRun, type PersonalEvaluationSummary } from '../src/domain/personal-evaluation.ts';
import type { PersonalComparisonPrompt, PersonalContext, PersonalDataset, PersonalExposure, PersonalModel, PersonalUnit } from '../src/domain/personal.ts';
import type { PersonalStore } from './personal-store.ts';

export class PersonalEvaluationError extends Error {}
interface EvaluationDependencies {
  store: PersonalStore;
  unit: (ref: EvaluationItemRef) => PersonalUnit;
  entityKey: (unit: PersonalUnit) => string;
  model: (dataset: PersonalDataset, unit: PersonalUnit) => PersonalModel | undefined;
  now: () => string;
  random: () => number;
}
const sameRef = (a: EvaluationItemRef, b: EvaluationItemRef) => a.id === b.id && a.version === b.version;
const sameContext = (a: PersonalContext, b: PersonalContext) => a.id === b.id && a.version === b.version && a.scopeId === b.scopeId && a.query === b.query && a.goal === b.goal && JSON.stringify(a.answers) === JSON.stringify(b.answers);
const ref = (unit: PersonalUnit): EvaluationItemRef => ({ id: unit.id, version: unit.version });
const validProbability = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
const clipped = (value: number) => Math.max(1e-7, Math.min(1 - 1e-7, value));

/** Purely local evaluation. It never generates labels or updates a personal model. */
export function createPersonalEvaluationService(dependencies: EvaluationDependencies) {
  const { store, unit, entityKey, now, random } = dependencies;
  const runs = () => store.all('evaluation_runs');
  const reservedEntities = () => new Set(runs().filter(run => run.status === 'active').flatMap(run => run.pairs.flatMap(pair => [pair.entityA, pair.entityB])));
  function previouslyExposedEntities() {
    const entities = new Set(store.all('exposures').flatMap(exposure => [entityKey(unit(exposure.a)), entityKey(unit(exposure.b))]));
    for (const observation of store.all('observations')) entities.add(entityKey(unit({ id: observation.unitId, version: observation.unitVersion })));
    return entities;
  }
  function createRun(dataset: PersonalDataset): PersonalEvaluationRun {
    const excluded = new Set([...previouslyExposedEntities(), ...reservedEntities()]);
    const groups = new Map<string, PersonalUnit[]>();
    for (const item of dataset.itemRefs.filter(item => item.partition === 'test').map(unit)) {
      const entity = entityKey(item);
      if (!excluded.has(entity)) groups.set(entity, [...(groups.get(entity) ?? []), item]);
    }
    const candidates = [...groups.entries()];
    if (candidates.length < 2) throw new PersonalEvaluationError('Not enough unseen held-out entities remain. Import fresh entities for an honest test.');
    // Fisher-Yates samples without replacement; one representative per entity
    // prevents alternate photos, revisions, or passages inflating the sample.
    for (let index = candidates.length - 1; index > 0; index--) {
      const swap = Math.min(index, Math.floor(random() * (index + 1)));
      [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
    }
    const representatives = candidates.map(([entity, items]) => ({ entity, item: items[Math.min(items.length - 1, Math.floor(random() * items.length))] }));
    const pairs: PersonalEvaluationPair[] = [];
    for (let index = 0; index + 1 < representatives.length; index += 2) {
      let [a, b] = [representatives[index], representatives[index + 1]];
      if (random() < 0.5) [a, b] = [b, a];
      pairs.push({ a: ref(a.item), b: ref(b.item), entityA: a.entity, entityB: b.entity });
    }
    const first = representatives[0].item;
    const model = dependencies.model(dataset, first);
    return {
      id: randomUUID(), protocol: PERSONAL_EVALUATION_PROTOCOL,
      datasetId: dataset.id, datasetVersion: dataset.version, domain: dataset.domain,
      featureSchemaId: first.features.schemaId, featureNames: [...first.features.names],
      context: structuredClone(dataset.context), prompt: dataset.prompt,
      modelId: model?.id ?? null, modelVersion: model?.version ?? 0,
      trainingCount: model?.trainingCount ?? 0, frozenModel: model ? structuredClone(model) : null,
      pairs, createdAt: now(), status: 'active',
    };
  }
  function startComparison(dataset: PersonalDataset): PersonalComparisonPrompt {
    const outcome = store.transaction(() => {
      const exposures = store.all('exposures');
      const answered = new Set(store.all('comparisons').map(comparison => comparison.exposureId));
      const outstanding = exposures.find(exposure => exposure.datasetId === dataset.id && exposure.datasetVersion === dataset.version && exposure.mode === 'test' && !answered.has(exposure.id) && store.get('predictions', exposure.id) && (!exposure.evaluationRunId || store.get('evaluation_runs', exposure.evaluationRunId)?.status === 'active'));
      // Keep pre-existing unanswered exposures intact, including legacy ones.
      if (outstanding) {
        const run = outstanding.evaluationRunId ? store.get('evaluation_runs', outstanding.evaluationRunId) : undefined;
        if (run?.status === 'invalidated') throw new PersonalEvaluationError('This frozen test is invalidated. Start a new test with fresh held-out entities.');
        return { exposure: outstanding, a: unit(outstanding.a), b: unit(outstanding.b), prompt: run?.prompt ?? dataset.prompt };
      }
      let run = runs().findLast(candidate => candidate.datasetId === dataset.id && candidate.datasetVersion === dataset.version && candidate.status === 'active');
      if (!run) { run = createRun(dataset); store.saveEvaluationRun(run); }
      const used = new Set(exposures.filter(exposure => exposure.evaluationRunId === run.id).map(exposure => exposure.evaluationPairIndex));
      const seen = previouslyExposedEntities();
      if (run.pairs.some((pair, pairIndex) => !used.has(pairIndex) && (seen.has(pair.entityA) || seen.has(pair.entityB)))) {
        store.invalidateEvaluationRun(run.id, now(), 'test-entity-exposed');
        // Return the error through the transaction so this invalidation commits.
        // Never silently replace a contaminated pair in the frozen test.
        return new PersonalEvaluationError('This frozen test was invalidated because a reserved entity was viewed outside it. Its results are excluded. Start a new test with remaining fresh entities.');
      }
      const index = run.pairs.findIndex((_, pairIndex) => !used.has(pairIndex));
      if (index === -1) throw new PersonalEvaluationError('Every available pair in this frozen test has been shown. Each entity is used once; import fresh entities to continue.');
      const pair = run.pairs[index]; const a = unit(pair.a); const b = unit(pair.b);
      const exposure: PersonalExposure = {
        id: randomUUID(), datasetId: run.datasetId, datasetVersion: run.datasetVersion, mode: 'test',
        a: { ...pair.a }, b: { ...pair.b }, context: structuredClone(run.context), modelVersion: run.modelVersion,
        selectionPolicy: PERSONAL_EVALUATION_PROTOCOL, createdAt: now(), evaluationRunId: run.id, evaluationPairIndex: index,
      };
      store.saveExposure(exposure, { exposureId: exposure.id, probabilityA: predictPair(a, b, run.frozenModel ?? undefined), baselineProbabilityA: predictPair(a, b), modelVersion: run.modelVersion, createdAt: exposure.createdAt });
      return { exposure, a, b, prompt: run.prompt };
    });
    if (outcome instanceof PersonalEvaluationError) throw outcome;
    return outcome;
  }
  function empty(dataset: PersonalDataset): PersonalEvaluationSummary {
    const legacyIds = new Set(store.all('exposures').filter(exposure => exposure.datasetId === dataset.id && exposure.mode === 'test' && !exposure.evaluationRunId).map(exposure => exposure.id));
    return {
      datasetId: dataset.id, datasetVersion: dataset.version, domain: dataset.domain,
      runId: null, protocol: 'not-started', modelVersion: 0, featureSchemaId: null,
      contextId: dataset.context.id, contextVersion: dataset.context.version, ...(dataset.context.scopeId ? { scopeId: dataset.context.scopeId } : {}),
      status: 'not-started', plannedPairCount: 0, answeredCount: 0, undoneCount: 0, nonDirectionalCount: 0,
      excludedCount: 0, legacyAnswerCount: store.all('comparisons').filter(comparison => !comparison.undone && ['a', 'b'].includes(comparison.choice) && legacyIds.has(comparison.exposureId)).length,
      uniqueEntityCount: 0, count: 0, correct: 0, baselineCorrect: 0, logLoss: null, brier: null, baselineLogLoss: null, baselineBrier: null,
    };
  }
  function summarize(run: PersonalEvaluationRun): PersonalEvaluationSummary {
    const dataset = store.get('datasets', run.datasetId, run.datasetVersion)!;
    const summary: PersonalEvaluationSummary = {
      ...empty(dataset), runId: run.id, protocol: run.protocol, modelVersion: run.modelVersion,
      featureSchemaId: run.featureSchemaId, status: run.status, plannedPairCount: run.pairs.length,
      ...(run.invalidationReason ? { invalidationReason: run.invalidationReason } : {}),
      contextId: run.context.id, contextVersion: run.context.version, ...(run.context.scopeId ? { scopeId: run.context.scopeId } : {}),
    };
    const exposures = store.all('exposures').filter(exposure => exposure.evaluationRunId === run.id);
    const comparisons = new Map(store.all('comparisons').map(comparison => [comparison.exposureId, comparison]));
    const predictions = new Map(store.all('predictions').map(prediction => [prediction.exposureId, prediction]));
    const usedIndices = new Set<number>(); const exposedEntities = new Set<string>(); const scoredEntities = new Set<string>();
    let loss = 0; let baselineLoss = 0; let brier = 0; let baselineBrier = 0;
    for (const exposure of exposures) {
      const index = exposure.evaluationPairIndex;
      const pair = index === undefined ? undefined : run.pairs[index];
      const validTrial = index !== undefined && !!pair && !usedIndices.has(index) && !exposedEntities.has(pair.entityA) && !exposedEntities.has(pair.entityB) &&
        exposure.mode === 'test' && exposure.datasetId === run.datasetId && exposure.datasetVersion === run.datasetVersion && exposure.modelVersion === run.modelVersion &&
        sameContext(exposure.context, run.context) && sameRef(exposure.a, pair.a) && sameRef(exposure.b, pair.b);
      // Seeing a trial consumes its entities even if its answer is later undone,
      // skipped, or missing. A duplicate answer must not become a fresh sample.
      if (validTrial) { usedIndices.add(index); exposedEntities.add(pair.entityA); exposedEntities.add(pair.entityB); }
      const comparison = comparisons.get(exposure.id);
      if (!comparison) continue;
      summary.answeredCount++;
      if (comparison.undone) { summary.undoneCount++; continue; }
      if (!['a', 'b'].includes(comparison.choice)) { summary.nonDirectionalCount++; continue; }
      const prediction = predictions.get(exposure.id);
      // Fail closed on mixed versions, malformed history, or duplicate trials.
      if (run.status !== 'active' || !validTrial || !pair ||
          !prediction || prediction.modelVersion !== run.modelVersion || !validProbability(prediction.probabilityA) || !validProbability(prediction.baselineProbabilityA)) {
        summary.excludedCount++; continue;
      }
      scoredEntities.add(pair.entityA); scoredEntities.add(pair.entityB);
      const target = comparison.choice === 'a' ? 1 : 0;
      const probability = clipped(prediction.probabilityA); const baseline = clipped(prediction.baselineProbabilityA);
      summary.count++;
      summary.correct += Number((probability >= 0.5 ? 1 : 0) === target);
      summary.baselineCorrect += Number((baseline >= 0.5 ? 1 : 0) === target);
      loss -= target * Math.log(probability) + (1 - target) * Math.log(1 - probability);
      baselineLoss -= target * Math.log(baseline) + (1 - target) * Math.log(1 - baseline);
      brier += (probability - target) ** 2; baselineBrier += (baseline - target) ** 2;
    }
    summary.uniqueEntityCount = scoredEntities.size;
    if (summary.count) { summary.logLoss = loss / summary.count; summary.baselineLogLoss = baselineLoss / summary.count; summary.brier = brier / summary.count; summary.baselineBrier = baselineBrier / summary.count; }
    const completed = new Set(exposures.filter(exposure => comparisons.has(exposure.id)).map(exposure => exposure.evaluationPairIndex));
    if (run.status === 'active' && run.pairs.every((_, index) => completed.has(index))) summary.status = 'completed';
    return summary;
  }
  const history = () => runs().map(summarize);
  function latest(dataset: PersonalDataset): PersonalEvaluationSummary {
    const run = runs().findLast(candidate => candidate.datasetId === dataset.id && candidate.datasetVersion === dataset.version);
    return run ? summarize(run) : empty(dataset);
  }
  return { startComparison, reservedEntities, latest, history, runs };
}
