/** Versioned contracts shared by search, Arena, and the personal learning ledger. */
export const PERSONAL_FEATURE_NAMES = ['relevance', 'novelty', 'actionability', 'depth', 'evidence', 'brevity', 'agents', 'ranking', 'rl', 'web', 'language', 'design'] as const;
export const PERSONAL_FEATURE_SCHEMA = 'content-semantic-v1';
export type ComparisonChoice = 'a' | 'b' | 'tie' | 'neither' | 'skip';
export type ArenaMode = 'learn' | 'test' | 'tournament';
export interface PersonalContext { id: string; version: number; query: string; goal: string; answers: Record<string, string> }
export interface PersonalFeatureVector { schemaId: string; names: string[]; values: number[]; encoder: string; model: string; contextVersion: number }
export interface PersonalSource { id: string; version: number; url: string; title: string; publisher: string; text: string; retrievedAt: string; publishedAt?: string; provenance: 'search-excerpt' | 'page-extraction' | 'upload' | 'authored-example'; limitations?: string[]; originalRank?: number }
export interface PersonalEvidence { sourceId: string; sourceVersion: number; quote: string }
export interface PersonalUnit { id: string; version: number; domain: string; modality: 'text' | 'image'; kind: string; title: string; body: string; sourceIds: string[]; evidence: PersonalEvidence[]; concepts: string[]; limitations: string[]; effortMinutes: number; features: PersonalFeatureVector; prior: number; createdAt: string; imageUrl?: string; entityId?: string; rights?: string; imageSourceUrl?: string }
export interface PersonalRankedUnit extends PersonalUnit { score: number; personalAdjustment: number; modelVersion: number; knownConcepts: string[] }
export interface PersonalQuestion { id: string; question: string; options: string[] }
export interface PersonalJobEvent { id: string; stage: string; message: string; at: string; completed?: number; total?: number; durationMs?: number; model?: string; tokens?: number }
export type SearchStatus = 'interpreting' | 'awaiting-clarification' | 'searching' | 'grounding' | 'ranking' | 'awaiting-refinement' | 'completed' | 'partial' | 'failed' | 'cancelled';
export interface PersonalSearchSession { id: string; query: string; status: SearchStatus; createdAt: string; updatedAt: string; context: PersonalContext; questions: PersonalQuestion[]; answers: Record<string, string>; sources: PersonalSource[]; units: PersonalUnit[]; pendingUnits?: PersonalUnit[]; events: PersonalJobEvent[]; answer: string; followUp?: PersonalQuestion; error?: string; usage?: { llmTokens: number; jevTokens: number; searchCalls: number; elapsedMs: number }; round: number }
export interface PersonalDataset { id: string; version: number; featureSchemaId?: string; title: string; description: string; domain: string; prompt: string; createdAt: string; context: PersonalContext; itemRefs: { id: string; version: number; partition: 'train' | 'test' }[]; provenance: string }
export interface CreatePersonalDataset { title: string; description?: string; domain: string; prompt: string; context?: PersonalContext; units: PersonalUnit[]; provenance: string; id?: string; evaluation?: boolean }
export interface PersonalExposure { id: string; datasetId: string; datasetVersion: number; mode: ArenaMode; a: { id: string; version: number }; b: { id: string; version: number }; context: PersonalContext; modelVersion: number; selectionPolicy: string; createdAt: string }
export interface PersonalPrediction { exposureId: string; probabilityA: number; baselineProbabilityA: number; modelVersion: number; createdAt: string }
/** Prediction intentionally absent until the corresponding answer is committed. */
export interface PersonalComparisonPrompt { exposure: PersonalExposure; a: PersonalUnit; b: PersonalUnit; prompt: string }
export interface PersonalComparison { id: string; exposureId: string; choice: ComparisonChoice; reason?: string; createdAt: string; undone: boolean }
export interface PersonalComparisonResult { comparison: PersonalComparison; prediction: PersonalPrediction; correct: boolean | null; modelVersion: number }
export interface PersonalModel { id: string; domain: string; schemaId: string; featureNames: string[]; version: number; weights: number[]; trainingCount: number; createdAt: string }
export interface PersonalProfileFact { id: string; kind: 'knowledge' | 'preference' | 'value'; value: string; domain: string; source: 'stated' | 'inferred'; confidence: number; supportingEventIds: string[]; createdAt: string; updatedAt: string }
export interface PersonalObservation { id: string; unitId: string; unitVersion: number; kind: 'open' | 'save' | 'dwell' | 'known'; context: PersonalContext; createdAt: string; durationMs?: number }
export interface PersonalEvaluation { count: number; correct: number; baselineCorrect: number; logLoss: number | null; brier: number | null; baselineLogLoss: number | null; domain: string; datasetId: string }
export interface PersonalSnapshot { datasets: PersonalDataset[]; facts: PersonalProfileFact[]; models: PersonalModel[]; comparisons: PersonalComparison[]; evaluations: PersonalEvaluation[]; observationCount: number; trainingCount: number; testCount: number; recentSessions: { id: string; query: string; status: SearchStatus; createdAt: string; unitCount: number }[] }
export interface PersonalTrainingRow { comparisonId: string; exposureId: string; domain: string; schemaId: string; context: PersonalContext; a: PersonalUnit; b: PersonalUnit; target: number }
export interface PersonalExport { format: 'valuerank-personal-v1'; exportedAt: string; sources: PersonalSource[]; units: PersonalUnit[]; sessions: PersonalSearchSession[]; datasets: PersonalDataset[]; exposures: PersonalExposure[]; predictions: PersonalPrediction[]; comparisons: PersonalComparison[]; facts: PersonalProfileFact[]; observations: PersonalObservation[]; models: PersonalModel[]; trainingRows: PersonalTrainingRow[] }
