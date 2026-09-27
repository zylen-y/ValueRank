import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ArenaMode, ComparisonChoice, CreatePersonalDataset, PersonalComparison, PersonalComparisonPrompt, PersonalComparisonResult, PersonalContext, PersonalDataset, PersonalEvaluation, PersonalExport, PersonalExposure, PersonalFeatureVector, PersonalModel, PersonalObservation, PersonalProfileFact, PersonalRankedUnit, PersonalSearchSession, PersonalSnapshot, PersonalSource, PersonalTrainingRow, PersonalUnit } from '../src/domain/personal.ts';
import { compatibleFeatures, fitPersonalModel, personalAdjustment, predictPair, sigmoid } from '../src/domain/personal-model.ts';
import type { PersonalStore } from './personal-store.ts';

const identifier = z.string().trim().min(1).max(180);
const plain = z.string().max(30000);
const version = z.number().int().min(1).max(1_000_000);
const contextSchema = z.object({ id: identifier, version, query: z.string().max(2000), goal: z.string().max(4000), answers: z.record(z.string().max(200), z.string().max(4000)) }).strict();
const featureSchema = z.object({ schemaId: identifier, names: z.array(z.string().min(1).max(100)).min(1).max(128), values: z.array(z.number().finite().min(-1).max(1)).min(1).max(128), encoder: z.string().min(1).max(200), model: z.string().min(1).max(300), contextVersion: version }).strict().refine(vector => vector.names.length === vector.values.length && new Set(vector.names).size === vector.names.length, 'Feature names and values must match with unique names.');
const sourceSchema = z.object({ id: identifier, version, url: z.string().max(4000), title: z.string().min(1).max(500), publisher: z.string().max(300), text: z.string().max(100000), retrievedAt: z.string().datetime(), publishedAt: z.string().max(100).optional(), provenance: z.enum(['search-excerpt', 'page-extraction', 'upload', 'authored-example']), limitations: z.array(z.string().max(2000)).max(20).optional(), originalRank: z.number().int().min(0).optional() }).strict();
const unitSchema = z.object({ id: identifier, version, domain: z.string().min(1).max(100), modality: z.enum(['text', 'image']), kind: z.string().min(1).max(100), title: z.string().min(1).max(500), body: plain, sourceIds: z.array(identifier).max(30), evidence: z.array(z.object({ sourceId: identifier, sourceVersion: version, quote: z.string().min(1).max(8000) }).strict()).max(30), concepts: z.array(z.string().min(1).max(200)).max(40), limitations: z.array(z.string().max(2000)).max(30), effortMinutes: z.number().finite().min(0).max(10000), features: featureSchema, prior: z.number().finite().min(-4).max(4), createdAt: z.string().datetime(), imageUrl: z.string().max(4000).optional(), entityId: identifier.optional(), rights: z.string().max(2000).optional(), imageSourceUrl: z.string().url().max(4000).optional() }).strict();
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
const normalizeQuote = (value: string) => value.replace(/\s+/g, ' ').trim();
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const modelId = (domain: string, schemaId: string) => `head-${digest(`${domain}\0${schemaId}`).slice(0, 24)}`;
const unitKey = (unit: { id: string; version: number }) => `${unit.id}@${unit.version}`;
const pairKey = (a: { id: string; version: number }, b: { id: string; version: number }) => [unitKey(a), unitKey(b)].sort().join('|');
const latest = <T extends { id: string; version: number }>(items: T[]): T[] => [...new Map(items.map(item => [item.id, item])).values()];
export class PersonalError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.name = 'PersonalError'; this.status = status; } }

export function createPersonalService(store: PersonalStore, options: { now?: () => string; random?: () => number } = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  const random = options.random ?? Math.random;
  const getModels = () => latest(store.all('models'));
  const getFacts = () => store.all('facts');
  const entityKey = (item: PersonalUnit) => {
    const source = item.sourceIds[0] ? store.get('sources', item.sourceIds[0]) : undefined;
    // Alternate passages from one source remain one held-out entity.
    const sourceIdentity = source?.url ? source.url.split('#')[0] : undefined;
    return `${item.domain}:${item.entityId ?? sourceIdentity ?? item.imageUrl ?? digest(normalize(item.body))}`;
  };
  function unit(ref: { id: string; version: number }) {
    const found = store.get('units', ref.id, ref.version);
    if (!found) throw new PersonalError('This information unit is no longer available.', 404);
    return found;
  }
  function checkFeatureSchema(domain: string, features: PersonalFeatureVector) {
    const previous = store.all('units').find(item => item.domain === domain && item.features.schemaId === features.schemaId);
    if (previous && (previous.features.names.length !== features.names.length || previous.features.names.some((name, index) => name !== features.names[index]))) throw new PersonalError('This feature schema already exists with different dimensions. Give the changed schema a new version.');
  }
  function saveSource(input: PersonalSource): PersonalSource {
    const parsed = sourceSchema.parse(input);
    const localAsset = /^\/api\/personal\/assets\/[a-f0-9]{64}$/.test(parsed.url) || /^\/arena\/[a-zA-Z0-9._-]+\.svg$/.test(parsed.url);
    if (!(parsed.provenance === 'upload' || parsed.provenance === 'authored-example') || (parsed.url && !localAsset)) {
      let protocol = '';
      try { protocol = new URL(parsed.url).protocol; } catch { /* Invalid web URL below. */ }
      if (protocol !== 'https:' && protocol !== 'http:') throw new PersonalError('Web sources must have an HTTP(S) URL.');
    }
    store.saveSource(parsed); return parsed;
  }
  function validateUnit(input: PersonalUnit): PersonalUnit {
    const parsed = unitSchema.parse(input);
    checkFeatureSchema(parsed.domain, parsed.features);
    if (parsed.modality === 'image') {
      if (!parsed.imageUrl || !(/^\/arena\/[a-zA-Z0-9._-]+\.svg$/.test(parsed.imageUrl) || /^\/api\/personal\/assets\/[a-f0-9]{64}$/.test(parsed.imageUrl) || /^https:\/\//.test(parsed.imageUrl))) throw new PersonalError('Image items need a supported asset URL.');
      if (!parsed.rights) throw new PersonalError('Image items must preserve rights or provenance information.');
      const assetIdentity = (url: string) => url.startsWith('https://') ? new URL(url).href.split('#')[0] : url;
      const asset = assetIdentity(parsed.imageUrl);
      const previous = store.all('units').find(item => item.modality === 'image' && item.imageUrl && assetIdentity(item.imageUrl) === asset);
      if (previous && (previous.entityId ?? asset) !== (parsed.entityId ?? asset)) throw new PersonalError('This image asset already belongs to a different entity ID. Keep the same entity ID across imports to protect the unseen-item test.');
    }
    if (parsed.imageSourceUrl && !/^https?:\/\//i.test(parsed.imageSourceUrl)) throw new PersonalError('Image source links must use HTTP or HTTPS.');
    for (const id of parsed.sourceIds) if (!store.get('sources', id)) throw new PersonalError('An information unit references an unregistered source.');
    for (const evidence of parsed.evidence) {
      const source = store.get('sources', evidence.sourceId, evidence.sourceVersion);
      if (!source || !parsed.sourceIds.includes(source.id) || !normalizeQuote(source.text).includes(normalizeQuote(evidence.quote))) throw new PersonalError('An evidence quote must occur in its registered source revision.');
    }
    return parsed;
  }
  function saveUnit(input: PersonalUnit): PersonalUnit {
    const parsed = validateUnit(input); store.saveUnit(parsed); return parsed;
  }
  function saveSession(input: PersonalSearchSession): PersonalSearchSession {
    if (!input.id || !input.query || input.query.length > 2000 || input.sources.length > 100 || input.units.length > 200 || (input.pendingUnits?.length ?? 0) > 200) throw new PersonalError('Invalid search session.');
    contextSchema.parse(input.context);
    return store.transaction(() => {
      input.sources.forEach(saveSource); input.units.forEach(saveUnit);
      // Unscored drafts are checkpointed only inside the session. They are not
      // immutable ranked units until their final semantic feature vector exists.
      input.pendingUnits?.forEach(validateUnit);
      store.save('sessions', structuredClone(input)); return input;
    });
  }
  const getSession = (id: string) => store.get('sessions', id);
  const listSessions = () => store.all('sessions');
  function rank(units: PersonalUnit[], _context?: PersonalContext): PersonalRankedUnit[] {
    const models = getModels(); const facts = getFacts();
    return units.map(item => {
      const model = models.find(candidate => candidate.id === modelId(item.domain, item.features.schemaId));
      const knownConcepts = item.concepts.filter(concept => facts.some(fact => fact.kind === 'knowledge' && (fact.domain === item.domain || fact.domain === 'all') && normalize(fact.value) === normalize(concept)));
      const adjustment = personalAdjustment(item, model);
      return { ...item, personalAdjustment: adjustment, modelVersion: model?.version ?? 0, knownConcepts, score: 100 * sigmoid(item.prior + adjustment - (knownConcepts.length / Math.max(item.concepts.length, 1)) * 0.8) };
    }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
  const datasets = () => latest(store.all('datasets')).map(dataset => ({ ...dataset, featureSchemaId: dataset.itemRefs[0] ? store.get('units', dataset.itemRefs[0].id, dataset.itemRefs[0].version)?.features.schemaId : undefined }));
  function createDataset(input: CreatePersonalDataset): PersonalDataset {
    const title = z.string().trim().min(1).max(300).parse(input.title);
    const domain = z.string().trim().min(1).max(100).parse(input.domain);
    const prompt = z.string().trim().min(1).max(2000).parse(input.prompt);
    if (!Array.isArray(input.units) || input.units.length < 2 || input.units.length > 200) throw new PersonalError('A dataset needs 2–200 items.');
    if (new Set(input.units.map(item => item.id)).size !== input.units.length) throw new PersonalError('Dataset item IDs must be unique.');
    if (input.units.some(item => item.domain !== domain || !compatibleFeatures(input.units[0], item))) throw new PersonalError('Dataset items must share one domain and feature schema.');
    const existing = input.id ? store.get('datasets', identifier.parse(input.id)) : undefined;
    const id = existing?.id ?? input.id ?? randomUUID(); const createdAt = now();
    const context = contextSchema.parse(input.context ?? { id: randomUUID(), version: 1, query: title, goal: prompt, answers: {} });
    const groups = [...new Set(input.units.map(entityKey))].sort((a, b) => digest(a).localeCompare(digest(b)));
    const trained = new Set(store.all('exposures').filter(exposure => exposure.mode !== 'test').flatMap(exposure => [entityKey(unit(exposure.a)), entityKey(unit(exposure.b))]));
    const testGroups = new Set(input.evaluation === false || groups.length < 4 ? [] : groups.filter(group => !trained.has(group)).slice(0, Math.min(Math.max(2, Math.floor(groups.length / 4)), groups.length - 2)));
    const dataset: PersonalDataset = { id, version: (existing?.version ?? 0) + 1, title, description: z.string().max(4000).parse(input.description ?? ''), domain, prompt, createdAt, context, provenance: z.string().min(1).max(4000).parse(input.provenance), itemRefs: input.units.map(item => ({ id: item.id, version: item.version, partition: testGroups.has(entityKey(item)) ? 'test' : 'train' })) };
    return store.transaction(() => { input.units.forEach(saveUnit); store.saveDataset(dataset); return dataset; });
  }
  function trainingRows(): PersonalTrainingRow[] {
    const exposures = new Map(store.all('exposures').map(exposure => [exposure.id, exposure]));
    return store.all('comparisons').filter(comparison => !comparison.undone && ['a', 'b', 'tie'].includes(comparison.choice)).flatMap(comparison => {
      const exposure = exposures.get(comparison.exposureId);
      // Evaluation labels never train, including on subsequent rebuilds or exports.
      if (!exposure || exposure.mode === 'test') return [];
      const a = unit(exposure.a); const b = unit(exposure.b);
      return [{ comparisonId: comparison.id, exposureId: exposure.id, domain: a.domain, schemaId: a.features.schemaId, context: exposure.context, a, b, target: comparison.choice === 'a' ? 1 : comparison.choice === 'b' ? 0 : 0.5 }];
    });
  }
  function rebuild(domain: string, schemaId: string, featureNames: string[], minimumVersion = 1): PersonalModel {
    const id = modelId(domain, schemaId); const previous = store.get('models', id);
    const model = fitPersonalModel({ id, domain, schemaId, featureNames, version: Math.max(minimumVersion, (previous?.version ?? 0) + 1), rows: trainingRows(), createdAt: now() });
    store.saveModel(model); return model;
  }
  function startComparison(input: { datasetId: string; mode?: ArenaMode; unitIds?: [string, string] }): PersonalComparisonPrompt {
    const dataset = store.get('datasets', identifier.parse(input.datasetId));
    if (!dataset) throw new PersonalError('Dataset not found.', 404);
    const mode = z.enum(['learn', 'test', 'tournament']).parse(input.mode ?? 'learn');
    const requested = input.unitIds ? z.tuple([identifier, identifier]).parse(input.unitIds) : undefined;
    if (requested && (mode !== 'learn' || requested[0] === requested[1])) throw new PersonalError('Manual comparison needs two distinct training items in learn mode.');
    const exposures = store.all('exposures'); const comparisons = store.all('comparisons');
    const answered = new Set(comparisons.map(comparison => comparison.exposureId));
    const outstanding = exposures.find(exposure => exposure.datasetId === dataset.id && exposure.datasetVersion === dataset.version && exposure.mode === mode && !answered.has(exposure.id));
    // Reload returns the same prediction-locked pair rather than sampling until one looks attractive.
    if (outstanding && requested && !(requested.includes(outstanding.a.id) && requested.includes(outstanding.b.id))) throw new PersonalError('Answer or skip the current pair before choosing another.', 409);
    if (outstanding) return { exposure: outstanding, a: unit(outstanding.a), b: unit(outstanding.b), prompt: dataset.prompt };
    const forbiddenEntities = new Set(exposures.filter(exposure => mode === 'test' ? exposure.mode !== 'test' : exposure.mode === 'test').flatMap(exposure => [entityKey(unit(exposure.a)), entityKey(unit(exposure.b))]));
    let candidates = dataset.itemRefs.filter(ref => ref.partition === (mode === 'test' ? 'test' : 'train')).map(unit).filter(item => !forbiddenEntities.has(entityKey(item)));
    if (candidates.length < 2) throw new PersonalError(mode === 'test' ? 'Not enough unseen held-out items remain. Import a fresh dataset for an honest test.' : 'Not enough training items remain. Held-out test items are kept separate.', 409);
    const past = exposures.filter(exposure => exposure.datasetId === dataset.id && exposure.datasetVersion === dataset.version && exposure.mode === mode);
    // Undo permits a corrected learning answer through a fresh exposure. Keep all
    // original predictions/audit rows, and never reopen test or tournament pairs.
    const undoneLearning = new Set(mode === 'learn' ? comparisons.filter(comparison => comparison.undone).map(comparison => comparison.exposureId) : []);
    const seenPairs = new Set(past.filter(exposure => !undoneLearning.has(exposure.id)).map(exposure => pairKey(exposure.a, exposure.b)));
    let pairs: [PersonalUnit, PersonalUnit][] = [];
    let policy = mode === 'test' ? 'heldout-random-v1' : 'uncertainty-coverage-v1';
    if (mode === 'tournament') {
      policy = 'tournament-actual-choices-v1';
      const relevant = comparisons.filter(comparison => !comparison.undone && past.some(exposure => exposure.id === comparison.exposureId));
      const eliminated = new Set<string>();
      for (const comparison of relevant) {
        const exposure = past.find(item => item.id === comparison.exposureId)!;
        if (comparison.choice === 'a' || comparison.choice === 'neither') eliminated.add(unitKey(exposure.b));
        if (comparison.choice === 'b' || comparison.choice === 'neither') eliminated.add(unitKey(exposure.a));
      }
      candidates = candidates.filter(item => !eliminated.has(unitKey(item)));
      if (candidates.length < 2) throw new PersonalError(candidates.length ? 'Tournament complete. The remaining item won the comparisons you actually made.' : 'Tournament complete. Neither item was chosen in the final comparison.', 409);
    }
    for (let a = 0; a < candidates.length; a++) for (let b = a + 1; b < candidates.length; b++) {
      if ((mode !== 'test' || entityKey(candidates[a]) !== entityKey(candidates[b])) && !seenPairs.has(pairKey(candidates[a], candidates[b]))) pairs.push([candidates[a], candidates[b]]);
    }
    if (requested) {
      pairs = pairs.filter(([a, b]) => requested.includes(a.id) && requested.includes(b.id));
      policy = 'user-selected-training-pair-v1';
      if (!pairs.length) throw new PersonalError('Choose two unseen training items. Held-out items are reserved for the blind test, and previously shown pairs cannot be repeated.', 409);
    }
    if (!pairs.length) throw new PersonalError('Every available pair in this round has been shown. Add new items to continue.', 409);
    const model = store.get('models', modelId(dataset.domain, candidates[0].features.schemaId));
    if (!requested && mode === 'learn' && random() >= 0.2) {
      const seenCounts = new Map<string, number>();
      for (const exposure of past) for (const ref of [exposure.a, exposure.b]) seenCounts.set(unitKey(ref), (seenCounts.get(unitKey(ref)) ?? 0) + 1);
      const utility = ([a, b]: [PersonalUnit, PersonalUnit]) => {
        const uncertainty = 1 - 2 * Math.abs(predictPair(a, b, model) - 0.5);
        const coverage = (1 / (1 + (seenCounts.get(unitKey(a)) ?? 0)) + 1 / (1 + (seenCounts.get(unitKey(b)) ?? 0))) / 2;
        const distance = Math.sqrt(a.features.values.reduce((sum, value, index) => sum + (value - b.features.values[index]) ** 2, 0) / a.features.values.length);
        return 0.5 * uncertainty + 0.35 * coverage + 0.15 * distance;
      };
      pairs = pairs.sort((a, b) => utility(b) - utility(a));
    } else {
      policy = mode === 'learn' && !requested ? 'random-exploration-v1' : policy;
      const selected = Math.min(pairs.length - 1, Math.floor(random() * pairs.length));
      pairs = [pairs[selected]];
    }
    let [a, b] = pairs[0]; if (random() < 0.5) [a, b] = [b, a];
    const exposure: PersonalExposure = { id: randomUUID(), datasetId: dataset.id, datasetVersion: dataset.version, mode, a: { id: a.id, version: a.version }, b: { id: b.id, version: b.version }, context: structuredClone(dataset.context), modelVersion: model?.version ?? 0, selectionPolicy: policy, createdAt: now() };
    const prediction = { exposureId: exposure.id, probabilityA: predictPair(a, b, model), baselineProbabilityA: predictPair(a, b), modelVersion: model?.version ?? 0, createdAt: exposure.createdAt };
    store.transaction(() => store.saveExposure(exposure, prediction));
    return { exposure, a, b, prompt: dataset.prompt };
  }
  function answer(input: { exposureId: string; choice: ComparisonChoice; reason?: string }): PersonalComparisonResult {
    const exposure = store.get('exposures', identifier.parse(input.exposureId));
    if (!exposure) throw new PersonalError('Comparison exposure not found.', 404);
    const choice = z.enum(['a', 'b', 'tie', 'neither', 'skip']).parse(input.choice);
    if (store.all('comparisons').some(comparison => comparison.exposureId === exposure.id)) throw new PersonalError('This comparison has already been answered. Request the next pair.', 409);
    const a = unit(exposure.a);
    const comparison: PersonalComparison = { id: randomUUID(), exposureId: exposure.id, choice, createdAt: now(), undone: false, ...(input.reason ? { reason: z.string().max(2000).parse(input.reason) } : {}) };
    return store.transaction(() => {
      store.saveComparison(comparison);
      const model = exposure.mode !== 'test' && ['a', 'b', 'tie'].includes(choice) ? rebuild(a.domain, a.features.schemaId, a.features.names) : store.get('models', modelId(a.domain, a.features.schemaId));
      const prediction = store.get('predictions', exposure.id)!;
      const correct = choice === 'a' || choice === 'b' ? (prediction.probabilityA >= 0.5 ? choice === 'a' : choice === 'b') : null;
      return { comparison, prediction, correct, modelVersion: model?.version ?? 0 };
    });
  }
  function undo(id: string): PersonalSnapshot {
    const comparison = store.get('comparisons', identifier.parse(id));
    if (!comparison) throw new PersonalError('Comparison not found.', 404);
    if (comparison.undone) throw new PersonalError('This comparison is already undone.', 409);
    return store.transaction(() => {
      store.undoComparison(comparison, randomUUID(), now());
      const exposure = store.get('exposures', comparison.exposureId)!; const a = unit(exposure.a);
      if (exposure.mode !== 'test' && ['a', 'b', 'tie'].includes(comparison.choice)) rebuild(a.domain, a.features.schemaId, a.features.names);
      return snapshot();
    });
  }
  function setFact(input: { id?: string; kind: PersonalProfileFact['kind']; value: string; domain?: string }): PersonalProfileFact {
    const kind = z.enum(['knowledge', 'preference', 'value']).parse(input.kind);
    const value = z.string().trim().min(1).max(1000).parse(input.value);
    const domain = z.string().trim().min(1).max(100).parse(input.domain ?? 'all');
    const existing = input.id ? store.get('facts', identifier.parse(input.id)) : getFacts().find(fact => fact.kind === kind && fact.domain === domain && normalize(fact.value) === normalize(value));
    const fact: PersonalProfileFact = { id: existing?.id ?? randomUUID(), kind, value, domain, source: 'stated', confidence: 1, supportingEventIds: existing?.supportingEventIds ?? [], createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    store.save('facts', fact); return fact;
  }
  function deleteFact(id: string) { store.remove('facts', identifier.parse(id)); return snapshot(); }
  function observe(input: { unitId: string; unitVersion?: number; kind: PersonalObservation['kind']; context?: PersonalContext; durationMs?: number }): PersonalObservation {
    const item = store.get('units', identifier.parse(input.unitId), input.unitVersion);
    if (!item) throw new PersonalError('Information unit not found.', 404);
    const kind = z.enum(['open', 'save', 'dwell', 'known']).parse(input.kind);
    const context = contextSchema.parse(input.context ?? { id: 'observation', version: 1, query: '', goal: '', answers: {} });
    const observation: PersonalObservation = { id: randomUUID(), unitId: item.id, unitVersion: item.version, kind, context, createdAt: now(), ...(input.durationMs === undefined ? {} : { durationMs: z.number().int().min(0).max(86_400_000).parse(input.durationMs) }) };
    return store.transaction(() => {
      store.save('observations', observation);
      if (kind === 'known') for (const concept of item.concepts) {
        const fact = setFact({ kind: 'knowledge', value: concept, domain: item.domain });
        store.save('facts', { ...fact, supportingEventIds: [...fact.supportingEventIds, observation.id] });
      }
      // Opens, saves, dwell, and known are observations, never synthetic pairwise labels.
      return observation;
    });
  }
  function evaluations(): PersonalEvaluation[] {
    const exposures = new Map(store.all('exposures').map(exposure => [exposure.id, exposure]));
    const predictions = new Map(store.all('predictions').map(prediction => [prediction.exposureId, prediction]));
    return datasets().map(dataset => {
      const rows = store.all('comparisons').filter(comparison => !comparison.undone && ['a', 'b'].includes(comparison.choice) && exposures.get(comparison.exposureId)?.datasetId === dataset.id && exposures.get(comparison.exposureId)?.mode === 'test' && predictions.has(comparison.exposureId));
      let correct = 0; let baselineCorrect = 0; let loss = 0; let baselineLoss = 0; let brier = 0;
      for (const row of rows) {
        const prediction = predictions.get(row.exposureId)!; const target = row.choice === 'a' ? 1 : 0;
        const probability = Math.max(1e-7, Math.min(1 - 1e-7, prediction.probabilityA));
        const baseline = Math.max(1e-7, Math.min(1 - 1e-7, prediction.baselineProbabilityA));
        correct += Number((probability >= 0.5 ? 1 : 0) === target); baselineCorrect += Number((baseline >= 0.5 ? 1 : 0) === target);
        loss -= target * Math.log(probability) + (1 - target) * Math.log(1 - probability);
        baselineLoss -= target * Math.log(baseline) + (1 - target) * Math.log(1 - baseline);
        brier += (probability - target) ** 2;
      }
      return { datasetId: dataset.id, domain: dataset.domain, count: rows.length, correct, baselineCorrect, logLoss: rows.length ? loss / rows.length : null, brier: rows.length ? brier / rows.length : null, baselineLogLoss: rows.length ? baselineLoss / rows.length : null };
    });
  }
  function snapshot(): PersonalSnapshot {
    const comparisons = store.all('comparisons'); const rows = trainingRows();
    return { datasets: datasets(), facts: getFacts(), models: getModels(), comparisons: comparisons.slice(-100).reverse(), evaluations: evaluations(), observationCount: store.all('observations').length, trainingCount: rows.length, testCount: evaluations().reduce((sum, evaluation) => sum + evaluation.count, 0), recentSessions: listSessions().slice(-30).reverse().map(session => ({ id: session.id, query: session.query, status: session.status, createdAt: session.createdAt, unitCount: session.units.length })) };
  }
  function exportData(): PersonalExport {
    return { format: 'valuerank-personal-v1', exportedAt: now(), sources: store.all('sources'), units: store.all('units'), sessions: store.all('sessions'), datasets: store.all('datasets'), exposures: store.all('exposures'), predictions: store.all('predictions').filter(prediction => store.all('comparisons').some(comparison => comparison.exposureId === prediction.exposureId)), comparisons: store.all('comparisons'), facts: getFacts(), observations: store.all('observations'), models: store.all('models'), trainingRows: trainingRows() };
  }
  function deleteData(): PersonalSnapshot { store.clear(); return snapshot(); }
  function invalidateHeadPredictions(domain: string, schemaId: string) {
    const answered = new Set(store.all('comparisons').map(comparison => comparison.exposureId));
    for (const exposure of store.all('exposures')) {
      const a = unit(exposure.a);
      if (a.domain !== domain || a.features.schemaId !== schemaId) continue;
      // Historical forecasts are derived from the erased training data. Keep actual
      // choices for rebuilding, but exclude erased forecasts from future metrics.
      store.remove('predictions', exposure.id);
      if (!answered.has(exposure.id)) store.remove('exposures', exposure.id);
    }
  }
  function deleteComparison(id: string): PersonalSnapshot {
    const comparison = store.get('comparisons', identifier.parse(id));
    if (!comparison) throw new PersonalError('Comparison not found.', 404);
    return store.transaction(() => {
      const exposure = store.get('exposures', comparison.exposureId)!; const a = unit(exposure.a);
      store.remove('comparisons', comparison.id); store.remove('predictions', exposure.id); store.remove('exposures', exposure.id);
      // Old parameter snapshots are derived from the deleted label and must also go.
      const oldVersion = store.get('models', modelId(a.domain, a.features.schemaId))?.version ?? 0;
      store.remove('models', modelId(a.domain, a.features.schemaId));
      store.removeUndo(comparison.id);
      invalidateHeadPredictions(a.domain, a.features.schemaId);
      rebuild(a.domain, a.features.schemaId, a.features.names, oldVersion + 1);
      return snapshot();
    });
  }
  function deleteDataset(id: string): PersonalSnapshot {
    identifier.parse(id);
    if (!store.get('datasets', id)) throw new PersonalError('Dataset not found.', 404);
    return store.transaction(() => {
      const affected = new Map<string, { unit: PersonalUnit; version: number }>();
      for (const exposure of store.all('exposures').filter(candidate => candidate.datasetId === id)) {
        const a = unit(exposure.a); const head = modelId(a.domain, a.features.schemaId);
        affected.set(head, { unit: a, version: store.get('models', head)?.version ?? 0 });
        for (const comparison of store.all('comparisons').filter(candidate => candidate.exposureId === exposure.id)) {
          store.removeUndo(comparison.id); store.remove('comparisons', comparison.id);
        }
        store.remove('predictions', exposure.id); store.remove('exposures', exposure.id);
      }
      store.remove('datasets', id);
      cleanupUnreferenced();
      for (const [head, value] of affected) {
        store.remove('models', head);
        invalidateHeadPredictions(value.unit.domain, value.unit.features.schemaId);
        rebuild(value.unit.domain, value.unit.features.schemaId, value.unit.features.names, value.version + 1);
      }
      return snapshot();
    });
  }
  function cleanupUnreferenced() {
    const keptUnits = new Set([
      ...store.all('datasets').flatMap(dataset => dataset.itemRefs.map(unitKey)),
      ...listSessions().flatMap(session => session.units.map(unitKey)),
      ...store.all('exposures').flatMap(exposure => [unitKey(exposure.a), unitKey(exposure.b)]),
    ]);
    const removedObservations = new Set<string>();
    for (const observation of store.all('observations')) if (!keptUnits.has(unitKey({ id: observation.unitId, version: observation.unitVersion }))) {
      removedObservations.add(observation.id); store.remove('observations', observation.id);
    }
    for (const fact of getFacts()) if (fact.supportingEventIds.some(id => removedObservations.has(id))) {
      const supportingEventIds = fact.supportingEventIds.filter(id => !removedObservations.has(id));
      if (supportingEventIds.length) store.save('facts', { ...fact, supportingEventIds });
      else store.remove('facts', fact.id);
    }
    for (const item of store.all('units')) if (!keptUnits.has(unitKey(item))) store.removeVersion('units', item.id, item.version);
    const keptSources = new Set([
      ...store.all('units').flatMap(item => item.sourceIds),
      ...listSessions().flatMap(session => session.sources.map(source => source.id)),
    ]);
    for (const source of store.all('sources')) if (!keptSources.has(source.id)) store.remove('sources', source.id);
  }
  function deleteSession(id: string): PersonalSnapshot {
    const session = getSession(identifier.parse(id));
    if (!session) throw new PersonalError('Search session not found.', 404);
    return store.transaction(() => {
      store.remove('sessions', id);
      for (const dataset of datasets().filter(candidate => candidate.context.id === session.context.id)) deleteDataset(dataset.id);
      cleanupUnreferenced();
      return snapshot();
    });
  }
  return { store, saveSource, saveUnit, saveSession, getSession, listSessions, getFacts, rank, datasets, createDataset, startComparison, answer, undo, setFact, deleteFact, observe, evaluations, snapshot, exportData, deleteData, deleteComparison, deleteDataset, deleteSession, trainingRows };
}
export type PersonalService = ReturnType<typeof createPersonalService>;
