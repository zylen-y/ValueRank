import { TOPICS, type Analysis, type ContentItem, type Profile } from '../src/domain/types.ts';
import { CostBudgetError } from './cost-budget.ts';
import { evaluateWithJev } from './jev.ts';
import type { SearchModelSettings } from './personal-search-adapter.ts';

export const SOURCE_SUPPORT_RUBRIC_VERSION = 'passage-premise-support-v2';
export type SourceSupportSettings = SearchModelSettings & { jevKey?: string; jevModel?: string; jevProvider?: 'openrouter' | 'typesafe' };
export interface SourceSupportPassage { quote: string; title?: string; publisher?: string; url?: string; sourceId?: string; sourceVersion?: number }
export interface SourceSupportInput { claim: string; passages: readonly (string | SourceSupportPassage)[]; context?: string }
export interface SourceSupportResult { score: number; model: string; checkedAt: string; durationMs: number; tokens: number; version: string }
export type VerifySourceSupport = (input: SourceSupportInput, settings: SourceSupportSettings, signal?: AbortSignal) => Promise<SourceSupportResult>;

/** Preserve boundaries and attribution as data; metadata never establishes authority. */
export function sourceSupportExcerpt(input: SourceSupportInput): string {
  const passages = input.passages.map(passage => typeof passage === 'string' ? { quote: passage } : {
    quote: passage.quote, title: passage.title, publisher: passage.publisher, url: passage.url,
    sourceId: passage.sourceId, sourceVersion: passage.sourceVersion,
  });
  const text = JSON.stringify({ passages });
  // The general Jev item API truncates at 12k characters. Include metadata and
  // serialization overhead in this limit so no part of a support input is cut.
  if (!passages.length || passages.some(passage => typeof passage.quote !== 'string' || !passage.quote.trim()) || text.length > 12_000 || !input.claim.trim() || input.claim.length > 2_000 || (input.context?.length ?? 0) > 3_000) throw new CostBudgetError('support-input-limit', 'The full claim, context or cited passages exceed the source-support limits.');
  return text;
}

/** Shared metered check. Callers choose their own explicitly uncalibrated policy. */
export function createSourceSupportVerifier(evaluate = evaluateWithJev): VerifySourceSupport {
  return async (input, settings, signal) => {
    signal?.throwIfAborted();
    const text = sourceSupportExcerpt(input);
    const apiKey = settings.jevKey || settings.openrouterKey;
    if (!apiKey?.trim()) throw new CostBudgetError('support-key-missing', 'Source-support checks need the existing Jev OpenRouter configuration.');
    const model = settings.jevModel ?? 'typesafe/jev-1.13'; const provider = settings.jevProvider ?? 'openrouter';
    const profile: Profile = { goal: input.context || 'Assess whether the cited passages support the claim; personal preference is irrelevant.', knownConcepts: [], interests: Object.fromEntries(TOPICS.map(topic => [topic, 1])) as Profile['interests'], feedbackCount: 0, version: 1 };
    const analysis: Analysis = { summary: 'Source-support review only.', concepts: [], topics: ['ranking'], evidence: [], readingMinutes: 1, source: 'llm', model: 'source-support-input' };
    const item: ContentItem = { id: 'source-support', title: 'Cited source passages', url: '', publisher: 'Stored source passages', kind: 'note', text, addedAt: new Date().toISOString(), provenance: 'user-paste', analysis: null, decision: null, feedback: null, status: 'processing', error: null };
    const started = Date.now();
    const result = await evaluate(item, analysis, profile, { apiKey, model, provider, budget: settings.budget, claim: input.claim }, signal);
    signal?.throwIfAborted();
    if (typeof result.support !== 'number' || !Number.isFinite(result.support) || result.support < 0 || result.support > 1) throw new Error('The source-support check did not return a valid estimate.');
    return { score: result.support, model: result.decision.model, tokens: result.tokens, checkedAt: new Date().toISOString(), durationMs: Date.now() - started, version: SOURCE_SUPPORT_RUBRIC_VERSION };
  };
}
export const verifySourceSupport = createSourceSupportVerifier();
