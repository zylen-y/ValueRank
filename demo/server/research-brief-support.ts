import type { ResearchBriefContent, ResearchBriefSupportCheck, ResearchBriefSupportReview, ResearchSave } from '../src/domain/research.ts';
import { JEV_SUPPORT_QUESTION } from './jev.ts';
import { normalizeSearchText } from './personal-search-adapter.ts';
import { sourceSupportExcerpt, verifySourceSupport, type SourceSupportSettings } from './source-support.ts';

export const BRIEF_SUPPORT_VERSION = 'brief-all-prose-support-v2';
/** An operational review threshold; not an empirically calibrated truth guarantee. */
export const BRIEF_SUPPORT_THRESHOLD = 0.8;
export type ResearchModelSettings = SourceSupportSettings;
export type VerifyBriefStatement = (check: ResearchBriefSupportCheck, settings: ResearchModelSettings, signal?: AbortSignal) => Promise<{ support: number; model: string; tokens: number }>;

export function buildBriefSupportReview(content: ResearchBriefContent, evidence: ResearchSave[]): ResearchBriefSupportReview {
  const statements = [
    { id: 'recommendation', section: 'recommendation' as const, statement: content.recommendation.text, evidenceIds: content.recommendation.evidenceIds },
    ...content.reasons.map((item, index) => ({ id: `reason-${index + 1}`, section: 'reason' as const, statement: item.text, evidenceIds: item.evidenceIds })),
    ...content.alternatives.map((item, index) => ({ id: `alternative-${index + 1}`, section: 'alternative' as const, statement: `${item.title}: ${item.assessment.text}`, evidenceIds: item.assessment.evidenceIds })),
    ...content.tradeoffs.map((item, index) => ({ id: `tradeoff-${index + 1}`, section: 'tradeoff' as const, statement: item.text, evidenceIds: item.evidenceIds })),
    // These fields have no direct citations. Inspect their factual premises
    // against all selected passages; a question or proposal alone is not a fact.
    ...content.openQuestions.map((statement, index) => ({ id: `open-question-${index + 1}`, section: 'open-question' as const, statement, evidenceIds: evidence.map(item => item.id) })),
    ...content.nextSteps.map((statement, index) => ({ id: `next-step-${index + 1}`, section: 'next-step' as const, statement, evidenceIds: evidence.map(item => item.id) })),
  ];
  return { version: BRIEF_SUPPORT_VERSION, threshold: BRIEF_SUPPORT_THRESHOLD, question: JEV_SUPPORT_QUESTION, scope: 'all-generated-prose', status: 'checking', checks: statements.map(item => {
    const passages: ResearchBriefSupportCheck['passages'] = [];
    let error: string | undefined;
    for (const id of [...new Set(item.evidenceIds)]) {
      const saved = evidence.find(entry => entry.id === id);
      if (!saved) { error = 'This claim has no matching saved evidence.'; continue; }
      for (const reference of saved.unit.evidence) {
        const source = saved.sources.find(source => source.id === reference.sourceId && source.version === reference.sourceVersion);
        if (!source || !normalizeSearchText(reference.quote) || !normalizeSearchText(source.text).includes(normalizeSearchText(reference.quote))) { error = 'A cited passage is unavailable or does not match its saved source. This claim needs your review.'; continue; }
        if (!passages.some(passage => passage.sourceId === source.id && passage.sourceVersion === source.version && passage.quote === reference.quote && passage.title === source.title && passage.url === source.url && passage.publisher === source.publisher)) passages.push({ evidenceId: id, sourceId: source.id, sourceVersion: source.version, title: source.title, url: source.url, publisher: source.publisher, quote: reference.quote });
      }
    }
    if (!passages.length) error ??= 'No inspectable cited passage is available for this claim.';
    if (!error) {
      try { sourceSupportExcerpt({ claim: item.statement, passages }); }
      catch { error = 'The complete claim and selected passages exceed the source-support input limit. They were preserved without truncation and need your review.'; }
    }
    return { ...item, passages, status: error ? 'unavailable' : 'pending', ...(error ? { error } : {}) };
  }) };
}

/** Uses the shared production verifier; there is no unchecked production path. */
export const verifyBriefStatement: VerifyBriefStatement = async (check, settings, signal) => {
  const result = await verifySourceSupport({ claim: check.statement, passages: check.passages }, settings, signal);
  return { support: result.score, model: result.model, tokens: result.tokens };
};
