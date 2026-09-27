import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERSONAL_FEATURE_NAMES, PERSONAL_FEATURE_SCHEMA, type PersonalContext, type PersonalProfileFact, type PersonalRankedUnit, type PersonalSearchSession, type PersonalSource, type PersonalUnit } from '../src/domain/personal.ts';
import { TOPICS, type Analysis, type ContentItem, type Profile } from '../src/domain/types.ts';
import { createSourceSupportVerifier, SOURCE_SUPPORT_RUBRIC_VERSION, type VerifySourceSupport } from './source-support.ts';
import { languageAgreement, plainChoiceSchema, targetLanguage } from './research-quality.ts';
import { evaluateWithJev } from './jev.ts';
import { classifyProviderError, safeProviderError } from './provider-error.ts';
import { DirectSourceRetrievalError, explicitSearchDomains, explicitSourceUrls, failedSearchUsage, generateSearchJson, matchesSearchDomains, normalizeSearchText, retrievePersonalSources, searchHash, type SearchModelSettings } from './personal-search-adapter.ts';

export const PERSONAL_SEARCH_LIMITS = { discoverySources: 4, researchSources: 8, sources: 16, units: 24, rounds: 2, jevConcurrency: 4, llmConcurrency: 2 } as const;
export interface PersonalSearchStore {
  /** Atomically save the session together with its accepted immutable unit revisions. */
  saveSession(session: PersonalSearchSession): unknown;
  getSession(id: string): PersonalSearchSession | null | undefined;
  listSessions(): PersonalSearchSession[];
  saveSource(source: PersonalSource): unknown;
  /** Legacy adapters may expose this; search commits cards only via saveSession. */
  saveUnit?(unit: PersonalUnit): unknown;
  rank(units: PersonalUnit[], context: PersonalContext): PersonalRankedUnit[];
  getFacts(): PersonalProfileFact[];
}
interface Configuration extends SearchModelSettings { jevKey: string; jevModel: string; jevProvider: 'openrouter' | 'typesafe' }
interface Options {
  store: PersonalSearchStore;
  configuration: () => Configuration;
  profile: () => Profile;
  retrieve?: typeof retrievePersonalSources;
  generate?: typeof generateSearchJson;
  evaluate?: typeof evaluateWithJev;
  verifySynthesis?: VerifySourceSupport;
  now?: () => number;
}
const planEntry = z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), label: z.string().trim().min(2).max(140) });
const researchPlanSchema = z.object({ options: z.array(planEntry).max(4), facets: z.array(planEntry).min(1).max(5), queries: z.array(z.string().trim().min(8).max(400).refine(query => !/https?:\/\//i.test(query), 'Use search terms, not generated URLs.')).min(1).max(2) });
const questionSchema = z.object({
  researchPlan: researchPlanSchema,
  questions: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), question: z.string().min(8).max(220), options: z.array(plainChoiceSchema).min(2).max(4) })).max(6),
});
const probability = z.number().finite().min(0).max(1);
export const groundedUnitsSchema = z.object({ units: z.array(z.object({
  title: z.string().trim().min(5).max(120), body: z.string().trim().min(30).max(800),
  kind: z.enum(['fact', 'explanation', 'comparison', 'tradeoff', 'method']),
  evidence: z.array(z.object({ sourceId: z.string(), passageId: z.string().min(3).max(80) })).min(1).max(3),
  concepts: z.array(z.string().trim().min(2).max(80)).min(1).max(4),
  limitations: z.array(z.string().min(5).max(180)).max(3),
  optionIds: z.array(z.string()).max(4).default([]), facetIds: z.array(z.string()).max(5).default([]),
  effortMinutes: z.number().int().min(1).max(10),
  depth: probability, evidenceStrength: probability,
  topics: z.array(z.enum(TOPICS)).min(1).max(3),
})).min(1).max(4) });
const answerSchema = z.object({
  optionAssessments: z.array(z.object({ optionId: z.string(), text: z.string().trim().min(15).max(700), unitIds: z.array(z.string()).min(1).max(3) })).max(4),
  paragraphs: z.array(z.object({ text: z.string().trim().min(15).max(2000), unitIds: z.array(z.string()).min(1).max(4) })).min(1).max(5),
  followUp: z.object({ id: z.literal('refine'), question: z.string().min(8).max(200), options: z.array(plainChoiceSchema).min(2).max(3) }).nullable(),
});
const ACTIVE = new Set(['interpreting', 'searching', 'grounding', 'ranking']);
const HALT = new Set(['budget', 'authentication', 'credits', 'access', 'rate-limit', 'model']);
const EVIDENCE_ERROR = 'A generated quotation did not match a retrieved source. The affected card was rejected.';
class SearchCheckpointError extends Error {
  constructor(cause: unknown) { super('A local research checkpoint could not be saved.', { cause }); this.name = 'SearchCheckpointError'; }
}
function checkpoint<T>(write: () => T): T {
  try { return write(); } catch (error) { throw error instanceof SearchCheckpointError ? error : new SearchCheckpointError(error); }
}
function checkpointCause(error: unknown): SearchCheckpointError | undefined {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    if (error instanceof SearchCheckpointError) return error;
    seen.add(error); error = error.cause;
  }
  return undefined;
}
type PipelineControl = { signal: AbortSignal; haltError?: unknown; halt(error: unknown): void };
function pipelineControl(signal: AbortSignal): PipelineControl {
  const controller = new AbortController();
  const control: PipelineControl = { signal: AbortSignal.any([signal, controller.signal]), halt(error) { control.haltError ??= error; controller.abort(error); } };
  return control;
}

export interface SourcePassage { id: string; sourceId: string; sourceVersion: number; start: number; end: number; text: string }
/** Contiguous original text; boundaries never synthesize, normalize, or translate a quotation. */
export function sourcePassages(source: PersonalSource): SourcePassage[] {
  const text = source.text.slice(0, 12_000);
  const passages: SourcePassage[] = [];
  let cursor = 0;
  while (cursor < text.length && passages.length < 32) {
    while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
    if (cursor >= text.length) break;
    const limit = Math.min(cursor + 600, text.length);
    const window = text.slice(cursor, limit);
    // Prefer a late sentence boundary, then a word boundary, retaining coverage.
    const boundaries = [...window.matchAll(/[.!?]["”’')\]]?\s+|\n{2,}/g)].map(match => match.index + match[0].length).filter(length => length >= 450);
    const wordBoundary = window.lastIndexOf(' ');
    let next = limit === text.length ? limit : cursor + (boundaries.at(-1) ?? (wordBoundary >= 450 ? wordBoundary : window.length));
    // Fold a tiny tail into this passage so a quotation is never a few stray characters.
    if (text.length - next < 30) next = text.length;
    let end = next; while (end > cursor && /\s/.test(text[end - 1])) end--;
    if (end > cursor) passages.push({ id: `p-${searchHash(`${source.id}@${source.version}:${cursor}:${end}`).slice(0, 16)}`, sourceId: source.id, sourceVersion: source.version, start: cursor, end, text: source.text.slice(cursor, end) });
    cursor = next;
  }
  return passages;
}
type GeneratedCard = z.infer<typeof groundedUnitsSchema>['units'][number];
type ResolvedCard = Omit<GeneratedCard, 'evidence'> & { evidence: { sourceId: string; quote: string }[] };
/** Legacy exact quotes remain valid for saved/test fixtures; new generation must select passage IDs. */
export function resolveGroundedCard(card: GeneratedCard | ResolvedCard, sources: PersonalSource[]): ResolvedCard {
  const catalog = new Map(sources.flatMap(sourcePassages).map(passage => [passage.id, passage]));
  const resolved: ResolvedCard = { ...card, evidence: card.evidence.map(evidence => {
    if ('passageId' in evidence) {
      const passage = catalog.get(evidence.passageId);
      if (!passage || passage.sourceId !== evidence.sourceId) throw new Error(EVIDENCE_ERROR);
      return { sourceId: evidence.sourceId, quote: passage.text };
    }
    return { sourceId: evidence.sourceId, quote: evidence.quote };
  }) };
  validateGroundedUnits({ units: [resolved] }, sources);
  return resolved;
}
export function validateGroundedUnits<T extends { units: { evidence: { sourceId: string; quote: string }[] }[] }>(value: T, sources: PersonalSource[]): T {
  const registry = new Map(sources.map(source => [source.id, source]));
  for (const unit of value.units) {
    for (const evidence of unit.evidence) {
      const source = registry.get(evidence.sourceId);
      if (!source || !normalizeSearchText(evidence.quote) || !normalizeSearchText(source.text).includes(normalizeSearchText(evidence.quote))) throw new Error(EVIDENCE_ERROR);
    }
  }
  return value;
}

/** Preserve rank order while avoiding an answer dominated by repeated cards from one source. */
export function selectSynthesisUnits(units: PersonalUnit[], limit = 5): PersonalUnit[] {
  const selected: PersonalUnit[] = [];
  const counts = new Map<string, number>();
  const keys = (unit: PersonalUnit) => unit.sourceIds.length ? [...new Set(unit.sourceIds)] : [unit.entityId ?? unit.id];
  for (const cap of [1, 2]) {
    for (const unit of units) {
      if (selected.length >= limit) return selected;
      if (selected.some(item => item.id === unit.id)) continue;
      const sources = keys(unit);
      if (sources.some(id => (counts.get(id) ?? 0) >= cap)) continue;
      selected.push(unit); sources.forEach(id => counts.set(id, (counts.get(id) ?? 0) + 1));
    }
  }
  return selected;
}
const ATTRIBUTION_RULE = 'Source authority is NOT verified. Attribute source-dependent claims to the actual publisher domain supplied in source metadata. Never infer that a page is official, first-party, vendor-owned, or a product creator’s own page from its title, content, branding, or a generated card. A domain mentioning a product name does not establish ownership. In your own prose use concrete domain attribution (for example, docs.typesafe.ai states..., jev-agent.com claims...) instead of unsupported authority labels. Quotes may reproduce source wording, but do not endorse its self-description. Distinguish a source claim from an independently verified fact. ';

export function createPersonalSearchService(options: Options) {
  const { store } = options;
  const retrieve = options.retrieve ?? retrievePersonalSources;
  const generate = options.generate ?? generateSearchJson;
  const evaluate = options.evaluate ?? evaluateWithJev;
  const verifySynthesis = options.verifySynthesis ?? createSourceSupportVerifier(evaluate);
  const now = options.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  let active: { id: string; controller: AbortController; task: Promise<void> } | null = null;
  const unsavedFailures = new Map<string, PersonalSearchSession>();
  const persist = (session: PersonalSearchSession) => { session.updatedAt = iso(); checkpoint(() => store.saveSession(structuredClone(session))); unsavedFailures.delete(session.id); };
  const readSession = (id: string) => structuredClone(unsavedFailures.get(id) ?? store.getSession(id));
  const listSessions = () => store.listSessions().map(session => structuredClone(unsavedFailures.get(session.id) ?? session));
  const retainUnsavedFailure = (session: PersonalSearchSession) => {
    let durable: PersonalSearchSession | null | undefined;
    try { durable = store.getSession(session.id); } catch { /* Preserve a clearly unsaved process-local view if the store cannot be read. */ }
    const failed = structuredClone(durable ?? session);
    failed.status = 'failed';
    failed.answer = durable?.answer ?? '';
    if (!durable) {
      failed.sources = []; failed.units = []; failed.pendingUnits = []; failed.withheldUnits = [];
      delete failed.answerReview; delete failed.followUp;
    }
    if (failed.answerReview?.status === 'checking') {
      failed.answerReview.status = 'needs-review';
      for (const check of failed.answerReview.checks) if (check.status === 'pending') { check.status = 'unavailable'; check.error = 'Source checking stopped because the final local checkpoint could not be saved.'; }
    }
    failed.error = `The final research update could not be saved locally. ${durable ? 'Only the last saved checkpoint is shown.' : 'The saved checkpoint could not be read, so results cannot be confirmed and are hidden.'} This failure notice is available only until the server restarts; resolve the storage problem before retrying.`;
    unsavedFailures.set(session.id, failed);
  };
  const event = (session: PersonalSearchSession, stage: string, message: string, extra: Partial<PersonalSearchSession['events'][number]> = {}) => {
    session.events.push({ id: randomUUID(), stage, message, at: iso(), ...extra }); persist(session);
  };
  const usage = (session: PersonalSearchSession, result: { tokens: number; durationMs: number; model: string }, stage: 'llm' | 'jev', message: string) => {
    session.usage ??= { llmTokens: 0, jevTokens: 0, searchCalls: 0, elapsedMs: 0 };
    if (stage === 'llm') session.usage.llmTokens += result.tokens; else session.usage.jevTokens += result.tokens;
    event(session, stage, message, { tokens: result.tokens, durationMs: result.durationMs, model: result.model });
  };
  const json = async <T>(session: PersonalSearchSession, schema: z.ZodType<T>, instructions: string, data: unknown, signal: AbortSignal) => {
    const language = targetLanguage(session.query);
    const checked = schema.superRefine((value, ctx) => {
      // Inspect generated prose, never source quotations, IDs, code or search queries.
      const walk = (entry: unknown, path: (string | number)[] = []) => {
        if (!entry || typeof entry !== 'object') return;
        for (const [key, child] of Object.entries(entry)) {
          const next = [...path, Array.isArray(entry) ? Number(key) : key];
          if (['evidence', 'queries', 'optionIds', 'facetIds', 'unitIds'].includes(key)) continue;
          if (typeof child === 'string' && ['title', 'body', 'text', 'question', 'label'].includes(key) && !languageAgreement(child, language)) ctx.addIssue({ code: 'custom', path: next, message: `Write generated prose in ${language === 'ko' ? 'Korean' : 'English'}.` });
          else if (Array.isArray(child) && ['options', 'limitations'].includes(key)) child.forEach((text, index) => { if (typeof text === 'string' && !languageAgreement(text, language)) ctx.addIssue({ code: 'custom', path: [...next, index], message: 'Keep the requested output language.' }); else if (typeof text === 'object') walk(text, [...next, index]); });
          else walk(child, next);
        }
      };
      walk(value);
    });
    try {
      return await generate(checked, `${instructions}\nOUTPUT LANGUAGE: ${language === 'ko' ? 'Korean' : 'English'}. Write all generated prose in this language. Original evidence passages remain verbatim; do not translate them.`, data, options.configuration(), signal, attempt => {
        event(session, 'llm-attempt', `Structured generation attempt ${attempt.attempt}: ${attempt.phase}.${attempt.reasoningTokens === undefined ? '' : ` Reported reasoning tokens: ${attempt.reasoningTokens}.`}${attempt.issues?.length ? ` Constraints: ${attempt.issues.map(issue => `${issue.field} (${issue.rule})`).join(', ')}.` : ''}`, { tokens: attempt.tokens, durationMs: attempt.durationMs, model: attempt.model });
      });
    } catch (error) {
      const spent = failedSearchUsage(error);
      if (spent) usage(session, spent, 'llm', 'Generation failed; reported token usage was preserved.');
      // The structured-output adapter can wrap a failed attempt callback. Keep
      // storage failures recognizable so the sibling pipeline is halted too.
      throw checkpointCause(error) ?? error;
    }
  };
  const get = (id: string) => { const session = readSession(id); if (!session) throw new Error('Search session was not found.'); return session; };
  const ensureIdle = () => { if (active) throw new Error('A personal search operation is already running. Cancel it or wait for completion.'); };
  const safeError = (error: unknown) => error instanceof SearchCheckpointError ? 'A local research checkpoint could not be saved. The operation stopped; check local storage before retrying.' : error instanceof DirectSourceRetrievalError ? error.message : error instanceof Error && error.message === EVIDENCE_ERROR ? EVIDENCE_ERROR : safeProviderError(error, { stage: 'llm', provider: 'gateway' });
  const scopedFacts = () => store.getFacts().filter(fact => ['content', 'all', 'global'].includes(fact.domain));
  const known = () => [...new Set(scopedFacts().filter(fact => fact.kind === 'knowledge').map(fact => fact.value))].slice(0, 100);
  const launch = (session: PersonalSearchSession, operation: (signal: AbortSignal) => Promise<void>, restore?: () => boolean) => {
    ensureIdle();
    const controller = new AbortController();
    const start = now();
    const task = Promise.resolve().then(() => operation(controller.signal)).catch(error => {
      const restored = restore?.() ?? false;
      if (controller.signal.aborted) { session.status = 'cancelled'; session.error = 'Cancelled. Completed source and card checkpoints were preserved.'; }
      else { session.status = session.units.length ? 'partial' : 'failed'; const failure = safeError(error); session.error = session.error ? `${session.error} ${failure}` : failure; }
      if (restored) session.error = `The previous context and cards were restored because refinement did not finish. ${session.error}`;
      // Terminal persistence happens once below. A failed error-event write must
      // never reject this task or strand the active-operation lock.
      session.events.push({ id: randomUUID(), stage: 'error', message: session.error, at: iso() });
    }).finally(() => {
      try {
        session.usage ??= { llmTokens: 0, jevTokens: 0, searchCalls: 0, elapsedMs: 0 };
        session.usage.elapsedMs += now() - start; persist(session);
      } catch { retainUnsavedFailure(session); }
      finally { if (active?.id === session.id) active = null; }
    });
    active = { id: session.id, controller, task };
    return structuredClone(session);
  };
  const collect = async (session: PersonalSearchSession, query: string, count: number, signal: AbortSignal) => {
    const settings = options.configuration();
    session.status = session.round === 0 ? 'interpreting' : 'searching';
    let directUrls: string[];
    try { directUrls = explicitSourceUrls(query); } catch { throw new DirectSourceRetrievalError(); }
    if (directUrls.length && directUrls.every(url => session.sources.some(source => source.url === url && source.provenance === 'page-extraction'))) {
      event(session, 'source', 'Reusing the saved page text for the supplied URLs. No search or extraction request was repeated.', { tokens: 0, model: 'public-url-extractor' });
      return session.sources.filter(source => directUrls.includes(source.url)).map(source => source.id);
    }
    event(session, directUrls.length ? 'source' : 'search', directUrls.length ? `Reading ${directUrls.length} supplied public page URL(s). No LLM search request is needed.` : 'Searching the live web. Result titles and excerpts are source data, not verified facts.');
    let result: Awaited<ReturnType<typeof retrieve>>;
    try { result = await retrieve(directUrls.length ? query : retrievalQuery(session, query), count, settings, signal); }
    catch (error) {
      const spent = failedSearchUsage(error);
      if (spent) usage(session, spent, 'llm', 'Web retrieval returned no usable excerpts; reported token usage was preserved.');
      if (error && typeof error === 'object' && 'searchCalls' in error && typeof error.searchCalls === 'number' && Number.isInteger(error.searchCalls) && error.searchCalls >= 0) session.usage!.searchCalls += error.searchCalls;
      throw error;
    }
    session.usage!.searchCalls += result.calls;
    if (result.mode === 'direct-url') event(session, 'source', `Extracted ${result.sources.length} supplied page(s); no web-search or LLM retrieval charge.`, { tokens: 0, durationMs: result.durationMs, model: result.model });
    else usage(session, result, 'llm', `Received ${result.sources.length} source excerpts from a real web-search tool.`);
    signal.throwIfAborted();
    for (const source of result.sources) {
      if (session.sources.length >= PERSONAL_SEARCH_LIMITS.sources) break;
      // Preserve the first retrieved version for each URL inside this session.
      if (session.sources.some(existing => existing.url === source.url)) continue;
      source.originalRank = session.sources.length + 1;
      checkpoint(() => store.saveSource(source)); session.sources.push(source);
    }
    persist(session);
    return result.sources.map(source => session.sources.find(saved => saved.url === source.url)?.id).filter((id): id is string => Boolean(id));
  };
  // Bound each field independently so a long project goal cannot erase the latest intent.
  const goal = (session: PersonalSearchSession) => [
    `Primary search intent: ${session.query.slice(0, 500)}`,
    `Current refinement: ${session.context.goal.slice(0, 700)}`,
    `Clarifications: ${JSON.stringify(session.answers).slice(0, 450)}`,
    ...(session.projectContext ? [`Project goal: ${session.projectContext.goal.slice(0, 450)}`, `Project constraints: ${session.projectContext.constraints.slice(0, 550)}`] : []),
    `Recorded preferences (only if relevant): ${JSON.stringify(scopedFacts().filter(fact => fact.kind !== 'knowledge').map(fact => ({ kind: fact.kind, value: fact.value }))).slice(0, 150)}`,
  ].join('\n');
  const retrievalQuery = (session: PersonalSearchSession, query: string) => {
    const domains = explicitSearchDomains(session.query);
    const focused = query.startsWith(session.query) ? query.slice(session.query.length).trim() : query;
    const contextText = (value: string) => value.replace(/https?:\/\/[^\s)]+/g, url => { try { return new URL(url).hostname; } catch { return ''; } });
    let body = [
      `Question: ${session.query.slice(0, 500)}`,
      focused ? `Focused evidence: ${contextText(focused).slice(0, 350)}` : '',
      session.round > 1 ? `Latest refinement: ${contextText(session.context.goal).slice(0, 350)}` : '',
      session.projectContext ? `Project: ${contextText(session.projectContext.goal).slice(0, 200)}. Constraints and source policy: ${contextText(session.projectContext.constraints).slice(0, 400)}` : '',
      Object.keys(session.answers).length ? `User context: ${contextText(JSON.stringify(session.answers)).slice(0, 180)}` : '',
      'Prefer direct documentation, original research and source repositories.',
    ].filter(Boolean).join('\n');
    // A model-written query cannot widen an explicit user source restriction.
    if (domains.length) body = `${domains.map(domain => `site:${domain}`).join(' ')}\n${body.replace(/(?:^|\s)site:[^\s]+/gi, ' ')}`;
    return body.slice(0, 2000);
  };
  const rank = (session: PersonalSearchSession) => {
    const originals = new Map(session.units.map(unit => [unit.id, unit]));
    session.units = store.rank(session.units, session.context).map(unit => originals.get(unit.id)!).filter(Boolean);
    event(session, 'rank', 'Ranked with Jev judgments and the current personal model; source order remains available.', { completed: session.units.length, total: session.units.length });
  };
  const screen = async (session: PersonalSearchSession, units: PersonalUnit[], signal: AbortSignal, control: PipelineControl) => {
    const settings = options.configuration();
    session.status = 'ranking';
    session.pendingUnits ??= [];
    for (const unit of units) {
      if (!session.pendingUnits.some(pending => pending.id === unit.id && pending.version === unit.version)) session.pendingUnits.push(unit);
    }
    event(session, 'jev', 'Jev is checking passage support and judging relevance, novelty, and actionability for each card.', { completed: 0, total: units.length, model: settings.jevModel });
    let cursor = 0; let completed = 0;
    const profile: Profile = { ...options.profile(), goal: goal(session), knownConcepts: known(), version: session.context.version };
    const accepted: PersonalUnit[] = [];
    const workers = await Promise.allSettled(Array.from({ length: Math.min(PERSONAL_SEARCH_LIMITS.jevConcurrency, units.length) }, async () => {
      while (cursor < units.length && !control.haltError && !signal.aborted) {
        const unit = units[cursor++];
        const sourceText = unit.evidence.map(e => e.quote).join('\n\n');
        const analysis: Analysis = { summary: unit.body, concepts: unit.concepts, topics: ['ranking'], evidence: unit.evidence.map(e => ({ quote: e.quote, insight: unit.body.slice(0, 250) })), readingMinutes: unit.effortMinutes, source: 'llm', model: settings.llmModel };
        const item: ContentItem = { id: unit.id, title: unit.title, url: session.sources.find(source => unit.sourceIds.includes(source.id))?.url ?? '', publisher: 'Retrieved source excerpts', kind: 'note', text: sourceText, addedAt: unit.createdAt, provenance: 'url-extraction', analysis, decision: null, feedback: null, status: 'processing', error: null };
        const start = now();
        try {
          const result = await evaluate(item, analysis, profile, { apiKey: settings.jevKey, model: settings.jevModel, provider: settings.jevProvider, claim: `${unit.title}\n${unit.body}` }, signal);
          signal.throwIfAborted();
          if (result.support !== undefined) {
            unit.sourceSupport = { score: result.support, model: result.decision.model, checkedAt: iso(), rubricVersion: SOURCE_SUPPORT_RUBRIC_VERSION, threshold: .5 };
            if (result.support < 0.5) {
              // Development screening policy, not a calibrated probability of truth.
              session.withheldUnits ??= [];
              session.withheldUnits.push({ unit: structuredClone(unit), reason: 'Jev flagged a possible mismatch between this claim and its passages. Held back from ranking and synthesis pending review.' });
              session.pendingUnits = session.pendingUnits?.filter(pending => pending.id !== unit.id || pending.version !== unit.version);
              completed++;
              usage(session, { tokens: result.tokens, durationMs: now() - start, model: result.decision.model }, 'jev', `Held back card ${completed} of ${units.length} after source-support screening.`);
              continue;
            }
          }
          const { relevance, novelty, actionability } = result.decision;
          unit.features.values.splice(0, 3, relevance, novelty, actionability);
          unit.features.encoder = 'llm-attributes+jev'; unit.features.model = `${settings.llmModel};${result.decision.model}`;
          unit.prior = 2 * (0.5 * relevance + 0.3 * novelty + 0.2 * actionability - 0.5);
          // The session checkpoint atomically commits its immutable scored cards.
          // An eager unit write here would orphan v1 while the durable session
          // still says pending v1 if its checkpoint fails, blocking a later retry.
          accepted.push(unit);
          session.pendingUnits = session.pendingUnits?.filter(pending => pending.id !== unit.id || pending.version !== unit.version);
          const existing = session.units.findIndex(current => current.id === unit.id);
          if (existing >= 0) session.units[existing] = unit; else session.units.push(unit);
          completed++;
          usage(session, { tokens: result.tokens, durationMs: now() - start, model: result.decision.model }, 'jev', `Scored card ${completed} of ${units.length}.`);
          event(session, 'jev-progress', 'Real Jev judgments received.', { completed, total: units.length });
        } catch (error) {
          if (signal.aborted) break;
          if (error instanceof SearchCheckpointError || HALT.has(classifyProviderError(error))) control.halt(error);
          if (error instanceof SearchCheckpointError) throw error;
          const message = safeProviderError(error, { stage: 'jev', provider: settings.jevProvider });
          try { event(session, 'error', message); } catch (writeError) { control.halt(writeError); throw writeError; }
        }
      }
    }));
    const workerFailure = workers.find((worker): worker is PromiseRejectedResult => worker.status === 'rejected');
    if (workerFailure) throw workerFailure.reason;
    if (control.haltError) throw control.haltError;
    signal.throwIfAborted();
    return accepted.length;
  };
  const ground = async (session: PersonalSearchSession, sources: PersonalSource[], signal: AbortSignal, consume: (units: PersonalUnit[]) => Promise<void>, control: PipelineControl) => {
    session.status = 'grounding';
    event(session, 'grounding', 'Turning retrieved excerpts into standalone, independently rankable information cards.');
    const groups: PersonalSource[][] = [];
    for (let index = 0; index < sources.length; index += 2) groups.push(sources.slice(index, index + 2));
    let cursor = 0;
    const units: PersonalUnit[] = [];
    const workers = await Promise.allSettled(Array.from({ length: Math.min(PERSONAL_SEARCH_LIMITS.llmConcurrency, groups.length) }, async () => {
      while (cursor < groups.length && !control.haltError && !signal.aborted) {
        const group = groups[cursor++];
        try {
          const result = await json(session, groundedUnitsSchema,
            ATTRIBUTION_RULE + 'Create 2-4 concise independent information cards from these source excerpts, useful for the query and intent. Each card must stand alone, make one clear point, and select supporting passage IDs from the supplied catalog. Each evidence object contains sourceId and passageId only. Never write, copy, translate, or invent quote text: the server will retrieve the exact original passage for the selected ID. Select only passages that substantively support the entire card, including its title. Do not add fastest, deterministic, cheapest, implementation-time or feasibility claims unless the passage establishes them. A user time or price constraint is NOT evidence that a solution meets it. Tag optionIds and facetIds only from the supplied researchPlan when the passages actually address them. Prefer missing coverage over an invented comparison. Preserve disagreements and uncertainty. Never turn a source title into authority or a rumor into a confirmed fact. No invented product/entity existence. Do not restate a whole article. Include limitations for truncated or promotional sources. Topic labels are coarse features only: choose the nearest supplied labels. depth and evidenceStrength are editorial estimates, not probabilities of truth. Use the specified output language for titles, bodies, concepts, and limitations. Evidence passages stay verbatim in their original language; select their IDs without translating text. Stay compact: body under 450 characters, at most two supporting passage IDs per card.',
            { query: session.query, context: session.context, project: session.projectContext, researchPlan: session.researchPlan, sources: group.map(source => ({ id: source.id, title: source.title, url: source.url, publisherDomain: source.publisher, authority: 'unverified', passages: sourcePassages(source).map(passage => ({ id: passage.id, text: passage.text })), publishedAt: source.publishedAt, provenance: source.provenance })) }, signal);
          signal.throwIfAborted();
          usage(session, result, 'llm', 'Generated candidate information cards; validating their quotations.');
          let acceptedCards = 0;
          const batch: PersonalUnit[] = [];
          for (const candidate of result.value.units) {
            let card: ResolvedCard;
            try { card = resolveGroundedCard(candidate, group); }
            catch { session.error ??= 'Some generated cards were rejected because their quotes did not match source excerpts.'; event(session, 'evidence-rejected', EVIDENCE_ERROR); continue; }
            if (session.researchPlan && ((card.optionIds ?? []).some(id => !session.researchPlan!.options.some(option => option.id === id)) || (card.facetIds ?? []).some(id => !session.researchPlan!.facets.some(facet => facet.id === id)))) { event(session, 'evidence-rejected', 'A card named an option or decision facet outside this research plan.'); continue; }
            if (session.units.length + (session.pendingUnits?.length ?? 0) >= PERSONAL_SEARCH_LIMITS.units) break;
            const identity = searchHash(JSON.stringify({ sessionId: session.id, title: card.title, body: card.body, evidence: card.evidence })).slice(0, 24);
            if (session.units.some(unit => unit.id === `unit-${identity}`) || units.some(unit => unit.id === `unit-${identity}`) || session.pendingUnits?.some(unit => unit.id === `unit-${identity}`)) continue;
            const draft: PersonalUnit = {
              id: `unit-${identity}`, entityId: `content-${searchHash([...new Set(card.evidence.map(e => group.find(source => source.id === e.sourceId)!.url))].sort().join('\n')).slice(0, 24)}`, version: 1, domain: 'content', modality: 'text', kind: card.kind,
              title: card.title, body: card.body, sourceIds: [...new Set(card.evidence.map(e => e.sourceId))],
              evidence: card.evidence.map(e => ({ ...e, sourceVersion: group.find(source => source.id === e.sourceId)!.version })),
              concepts: card.concepts, limitations: card.limitations, effortMinutes: card.effortMinutes,
              features: { schemaId: PERSONAL_FEATURE_SCHEMA, names: [...PERSONAL_FEATURE_NAMES], values: [0, 0, 0, card.depth, card.evidenceStrength, 1 - Math.min(1, card.effortMinutes / 10), ...TOPICS.map(topic => card.topics.includes(topic) ? 1 : 0)], encoder: 'llm-attributes-pending-jev', model: options.configuration().llmModel, contextVersion: session.context.version },
              researchTags: { optionIds: card.optionIds ?? [], facetIds: card.facetIds ?? [] }, prior: 0, createdAt: iso(),
            };
            units.push(draft);
            batch.push(draft);
            session.pendingUnits ??= []; session.pendingUnits.push(draft);
            persist(session);
            acceptedCards++;
          }
          event(session, 'evidence', `${acceptedCards} of ${result.value.units.length} candidate cards passed exact source-quote matching. This checks provenance, not semantic truth.`);
          // Publish checked cards from this batch before occupying the next LLM slot.
          // Both grounding workers and card checks share the same halt boundary.
          if (batch.length && !control.haltError) await consume(batch);
        } catch (error) {
          if (signal.aborted) { if (error instanceof SearchCheckpointError) control.halt(error); break; }
          if (error instanceof SearchCheckpointError || HALT.has(classifyProviderError(error))) control.halt(error);
          if (error instanceof SearchCheckpointError) throw error;
          session.error ??= 'Some source batches could not produce valid grounded cards. Results below contain only accepted cards.';
          try { event(session, 'error', safeError(error)); } catch (writeError) { control.halt(writeError); throw writeError; }
        }
      }
    }));
    const workerFailure = workers.find((worker): worker is PromiseRejectedResult => worker.status === 'rejected');
    if (workerFailure) throw workerFailure.reason;
    if (control.haltError) throw control.haltError;
    signal.throwIfAborted();
    return units;
  };
  const automaticSelection = (session: PersonalSearchSession) => {
    const domains = explicitSearchDomains(session.context.goal);
    const preferred = new Set(session.sources.filter(source => domains.length && matchesSearchDomains(source.url, domains)).map(source => source.id));
    const isPreferred = (unit: PersonalUnit) => unit.sourceIds.some(id => preferred.has(id));
    const candidates = preferred.size ? [...session.units.filter(isPreferred), ...session.units.filter(unit => !isPreferred(unit))] : session.units;
    // Required alternatives outrank source diversity in the synthesis selection.
    const selected: PersonalUnit[] = [];
    for (const option of session.researchPlan?.options ?? []) {
      const unit = candidates.find(unit => unit.researchTags?.optionIds.includes(option.id));
      if (unit && !selected.includes(unit)) selected.push(unit);
    }
    for (const facet of session.researchPlan?.facets ?? []) {
      const unit = candidates.find(unit => unit.researchTags?.facetIds.includes(facet.id));
      if (unit && !selected.includes(unit) && selected.length < 6) selected.push(unit);
    }
    for (const unit of selectSynthesisUnits(candidates, 8)) if (selected.length < 8 && !selected.includes(unit)) selected.push(unit);
    return selected.map(unit => unit.id);
  };
  const answer = async (session: PersonalSearchSession, selectedIds: string[], parentSignal: AbortSignal) => {
    const control = pipelineControl(parentSignal); const { signal } = control;
    const selected = session.units.filter(unit => selectedIds.includes(unit.id)).slice(0, 8);
    if (!selected.length) throw new Error('Choose at least one existing information card.');
    session.answer = ''; delete session.answerReview; session.followUp = undefined;
    event(session, 'answer', 'Composing a concise answer from the selected cards only.');
    const coveredOptions = (session.researchPlan?.options ?? []).filter(option => selected.some(unit => unit.researchTags?.optionIds.includes(option.id)));
    const schema = answerSchema.superRefine((value, ctx) => {
      const ids = value.optionAssessments.map(item => item.optionId);
      if (ids.length !== coveredOptions.length || new Set(ids).size !== ids.length || coveredOptions.some(option => !ids.includes(option.id))) ctx.addIssue({ code: 'custom', path: ['optionAssessments'], message: 'Assess each covered option exactly once, and no other option.' });
      for (const item of value.optionAssessments) if (item.unitIds.some(id => !selected.some(unit => unit.id === id && unit.researchTags?.optionIds.includes(item.optionId)))) ctx.addIssue({ code: 'custom', path: ['optionAssessments'], message: 'Cite selected cards tagged to this option.' });
    });
    const result = await json(session, schema,
      ATTRIBUTION_RULE + 'Assemble a short useful answer using only the supplied information cards. In optionAssessments assess every coveredOptions entry exactly once, citing cards tagged to that option. The server will add explicit gaps for uncovered alternatives. Make the opening actionable: state a provisional choice only when evidence supports it, then tradeoffs and the next verification step. Never infer implementation feasibility, guaranteed spend, or comparative superiority from the user constraints. Explicitly preserve conditions that could change the choice. Aim for 2-3 paragraphs of 2-3 short sentences each. Every paragraph must cite one or more supplied unitIds that support the paragraph. Do not introduce outside claims, URLs, or citations. The selected cards are only a subset of retrieved evidence. Never claim that a full source or document lacks information because these selected cards omit it. If evidence is insufficient, say only that the selected cards do not establish the claim; do not assert absence from the underlying document. Explicitly retain uncertainty. Return a targeted follow-up only if choosing among existing content or filling a concrete evidence gap would materially improve the answer; otherwise null. Do not infer permanent preferences. Use the specified output language for all generated prose. Any quoted source words must remain verbatim in their original language.',
      { query: session.query, context: session.context, project: session.projectContext, researchPlan: session.researchPlan, coveredOptions, cards: selected.map(unit => ({ id: unit.id, title: unit.title, body: unit.body, limitations: unit.limitations, researchTags: unit.researchTags, sources: session.sources.filter(source => unit.sourceIds.includes(source.id)).map(source => ({ id: source.id, url: source.url, publisherDomain: source.publisher, authority: 'unverified', provenance: source.provenance })), evidence: unit.evidence })) }, signal);
    signal.throwIfAborted();
    const allowed = new Set(selected.map(unit => unit.id));
    if (result.value.paragraphs.some(paragraph => paragraph.unitIds.some(id => !allowed.has(id)))) throw new Error(EVIDENCE_ERROR);
    // Stable references survive personal reranking and identify immutable card versions.
    const references = (ids: string[]) => ids.map(id => `[unit:${id}@${selected.find(unit => unit.id === id)!.version}]`).join(' ');
    const assessments = (session.researchPlan?.options ?? []).map(option => {
      const assessment = result.value.optionAssessments?.find(item => item.optionId === option.id);
      return `${option.label}: ${assessment ? `${assessment.text} ${references(assessment.unitIds)}` : targetLanguage(session.query) === 'ko' ? '선택된 근거만으로 이 대안을 판단할 수 없습니다. 비교하거나 제외하기 전에 추가 근거가 필요합니다.' : 'The selected passages do not establish this alternative. More evidence is needed before comparing it or recommending against it.'}`;
    });
    const draft = [...result.value.paragraphs.map(paragraph => `${paragraph.text} ${paragraph.unitIds.map(id => `[unit:${id}@${selected.find(unit => unit.id === id)!.version}]`).join(' ')}`), ...assessments].join('\n\n');
    usage(session, result, 'llm', 'Candidate synthesis references the selected cards; checking its claims against their passages.');
    const clauses = [
      ...result.value.paragraphs.map((item, index) => ({ id: `paragraph-${index}`, claim: item.text, unitIds: item.unitIds })),
      ...(result.value.optionAssessments ?? []).map(item => ({ id: `option-${item.optionId}`, claim: `${session.researchPlan?.options.find(option => option.id === item.optionId)?.label ?? item.optionId}: ${item.text}`, unitIds: item.unitIds })),
      ...(result.value.followUp ? [{ id: 'follow-up', claim: `${result.value.followUp.question} Options: ${result.value.followUp.options.join('; ')}`, unitIds: selected.map(unit => unit.id) }] : []),
    ];
    const review: NonNullable<PersonalSearchSession['answerReview']> = { version: 'search-synthesis-support-v1', threshold: .8, status: 'checking', draft, checks: clauses.map(item => ({ ...item, status: 'pending' })) };
    session.answerReview = review; persist(session);
    let cursor = 0;
    const workers = await Promise.allSettled(Array.from({ length: Math.min(2, clauses.length) }, async () => {
      while (cursor < review.checks.length && !signal.aborted) {
        const check = review.checks[cursor++];
        try {
          const references = selected.filter(unit => check.unitIds.includes(unit.id)).flatMap(unit => unit.evidence);
          const passages = [...new Map(references.map(reference => {
            const source = session.sources.find(source => source.id === reference.sourceId && source.version === reference.sourceVersion);
            if (!source) throw new Error(EVIDENCE_ERROR);
            return [`${source.id}@${source.version}:${reference.quote}`, { quote: reference.quote, sourceId: source.id, sourceVersion: source.version, title: source.title, publisher: source.publisher, url: source.url }];
          })).values()];
          const result = await verifySynthesis({ claim: check.claim, passages, context: goal(session).slice(0, 3000) }, options.configuration(), signal);
          signal.throwIfAborted();
          if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1) throw new Error('Source-support check returned an invalid estimate.');
          check.score = result.score; check.model = result.model; check.rubricVersion = result.version; check.status = result.score >= review.threshold ? 'matched' : 'flagged';
          usage(session, result, 'jev', 'Received a fallible source-support judgment for the generated synthesis.');
        } catch (error) {
          if (error instanceof SearchCheckpointError || HALT.has(classifyProviderError(error))) control.halt(error);
          check.status = 'unavailable';
          check.error = parentSignal.aborted ? 'The check was cancelled.' : control.haltError ? 'Source checking stopped after a provider, budget, or local storage failure.' : safeProviderError(error, { stage: 'jev', provider: options.configuration().jevProvider });
          if (error instanceof SearchCheckpointError) throw error;
        }
        try { persist(session); } catch (error) { control.halt(error); throw error; }
      }
    }));
    for (const check of review.checks) if (check.status === 'pending') { check.status = 'unavailable'; check.error = 'The source check did not finish.'; }
    review.status = review.checks.every(check => check.status === 'matched') ? 'passed' : 'needs-review';
    persist(session);
    const workerFailure = workers.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (workerFailure) throw workerFailure.reason;
    if (control.haltError) throw control.haltError;
    signal.throwIfAborted();
    if (review.status === 'passed') { session.answer = draft; session.followUp = result.value.followUp ?? undefined; }
    else { session.error = `${session.error ? `${session.error} ` : ''}The generated synthesis needs source review. Ranked cards and the unaccepted draft remain available.`; }
    event(session, 'answer-review', review.status === 'passed' ? 'Synthesis passed the automated passage-support screen. This does not independently verify its sources.' : 'Synthesis held for evidence review; no completed answer was accepted.');
  };
  const processSources = async (session: PersonalSearchSession, parentSignal: AbortSignal, candidates: PersonalSource[]) => {
    const control = pipelineControl(parentSignal); const { signal } = control;
    let attempted = 0; let accepted = 0;
    const consume = async (units: PersonalUnit[]) => {
      if (!units.length || control.haltError) return;
      attempted += units.length;
      const count = await screen(session, units, signal, control);
      accepted += count;
      signal.throwIfAborted();
      if (session.units.length) rank(session);
    };
    const pending = session.pendingUnits?.filter(unit => unit.features.contextVersion === session.context.version) ?? [];
    const previous = session.units.filter(unit => unit.features.contextVersion !== session.context.version).map(unit => ({ ...unit, version: unit.version + 1, features: { ...unit.features, values: [...unit.features.values], contextVersion: session.context.version } }));
    session.units = session.units.filter(unit => unit.features.contextVersion === session.context.version);
    await consume([...previous, ...pending].slice(0, PERSONAL_SEARCH_LIMITS.units));
    if (!control.haltError) await ground(session, candidates, signal, consume, control);
    if (control.haltError) throw control.haltError;
    if (!session.units.length) throw new Error('No fully grounded and Jev-scored cards were accepted.');
    rank(session);
    await answer(session, automaticSelection(session), signal);
    session.status = accepted < attempted || !!session.error ? 'partial' : session.followUp ? 'awaiting-refinement' : 'completed';
    event(session, 'complete', `${session.units.length} cards ready. Compare cards to teach the personal model.`);
  };

  const research = async (session: PersonalSearchSession, parentSignal: AbortSignal, query: string, includeDiscovery: boolean) => {
    const control = pipelineControl(parentSignal); const { signal } = control;
    const oldIds = new Set(includeDiscovery ? [] : session.sources.map(source => source.id));
    const direct = explicitSourceUrls(query).length > 0;
    const queries = includeDiscovery && !direct && session.researchPlan ? session.researchPlan.queries : [query];
    const retrieved: string[] = [];
    // Two focused, bounded searches run together; their slots are independent of arrival order.
    const results = await Promise.allSettled(queries.map(async query => {
      try { signal.throwIfAborted(); retrieved.push(...await collect(session, query, queries.length > 1 ? 4 : PERSONAL_SEARCH_LIMITS.researchSources, signal)); }
      catch (error) { if (error instanceof SearchCheckpointError || HALT.has(classifyProviderError(error))) control.halt(error); throw error; }
    }));
    if (control.haltError) throw control.haltError;
    signal.throwIfAborted();
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failures.length === queries.length) throw failures[0].reason;
    if (failures.length) {
      session.error = 'One planned search failed. These results cover only the sources that were retrieved; missing alternatives still need evidence.';
      event(session, 'error', session.error);
    }
    const candidates = session.sources.filter(source => retrieved.includes(source.id) && !oldIds.has(source.id));
    await processSources(session, signal, candidates);

  };

  const preparePlan = async (session: PersonalSearchSession, signal: AbortSignal) => {
    event(session, 'clarification', 'Planning the investigation and checking which user constraints are still missing.');
    const result = await json(session, questionSchema,
      'Ask 0-3 short useful multiple-choice clarification questions only about genuinely missing user constraints. Do not ask for a constraint already supplied. Never ask the user to choose among the solutions this research is meant to compare. Produce a researchPlan in the same response: preserve up to four explicitly requested alternatives in options (empty for a non-comparison), identify up to five decision-relevant facets, and produce one or two focused complementary web queries that together cover ALL alternatives. Queries should request direct documentation, original papers or repositories when the source policy calls for them. Do not invent product names or publisher domains. All choices must be plain human-readable text, never serialized objects or code fragments. Prioritize intent, current knowledge, and a meaningful tradeoff. The current query is primary; use optional background profile context only when relevant and never impose its previous project goal on an unrelated query. If the entity is ambiguous in retrieved evidence, ask what the user means; never assert an invented meaning. Source titles may be misleading. These are bounded source excerpts, not proof of complete document coverage. Never claim that a document does not mention or contain a topic because it is absent from an excerpt; truncated=false only means the supplied slice contains the stored text, not necessarily the whole page. Avoid unverified factual premises in questions: ask about intent, existing knowledge, and constraints instead. Each question must have a unique short id. These are optional questions: the user can search immediately. Use the specified output language for all generated prose. Any quoted source words must remain verbatim in their original language.',
      { query: session.query, goal: session.context.goal, optionalProfileContext: options.profile().goal, recordedFacts: scopedFacts().map(fact => ({ kind: fact.kind, value: fact.value, source: fact.source })), knownConcepts: known(), sources: session.sources.map(source => ({ title: source.title, url: source.url, text: source.text.slice(0, 6000), truncated: source.text.length > 6000, storedCharacters: source.text.length, suppliedCharacters: Math.min(source.text.length, 6000), provenance: source.provenance, limitations: source.limitations ?? [] })) }, signal);
    signal.throwIfAborted();
    if (new Set(result.value.questions.map(question => question.id)).size !== result.value.questions.length) throw new Error('Clarification question identifiers were not unique.');
    if (result.value.researchPlan) {
      const plan = researchPlanSchema.parse(result.value.researchPlan);
      for (const entries of [plan.options, plan.facets]) if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Research plan identifiers must be unique.');
      session.researchPlan = plan;
      event(session, 'plan', `Researching ${plan.options.length} named alternatives and ${plan.facets.length} decision facets with up to ${plan.queries.length} focused queries.`);
    }
    session.questions = result.value.questions.slice(0, 3); session.status = 'awaiting-clarification';
    usage(session, result, 'llm', 'Clarification questions are ready. No model request remains open while you choose.');
  };

  return {
    start(query: string, project?: { scopeId: string; version?: number; title?: string; goal: string; constraints: string }) {
      ensureIdle();
      query = query.trim();
      if (!query || query.length > 500) throw new Error('Enter a search query of 1–500 characters.');
      const settings = options.configuration();
      if (!settings.gatewayKey || !settings.jevKey) throw new Error('Configure AI Gateway and Jev provider credentials before searching.');
      const id = randomUUID();
      const context: PersonalContext = { id, version: 1, query, goal: project ? `${project.goal}${project.constraints ? `\nConstraints: ${project.constraints}` : ''}` : query, answers: {}, ...(project ? { scopeId: project.scopeId } : {}) };
      const session: PersonalSearchSession = { id, query, status: 'interpreting', createdAt: iso(), updatedAt: iso(), context, questions: [], answers: {}, sources: [], units: [], pendingUnits: [], events: [], answer: '', usage: { llmTokens: 0, jevTokens: 0, searchCalls: 0, elapsedMs: 0 }, round: 0, ...(project ? { projectContext: { projectId: project.scopeId, version: project.version ?? 1, title: project.title ?? query, goal: project.goal, constraints: project.constraints } } : {}) };
      persist(session);
      return launch(session, async signal => {
        await collect(session, query, PERSONAL_SEARCH_LIMITS.discoverySources, signal);
        await preparePlan(session, signal);
      });
    },
    continue(id: string, answers: Record<string, string> = {}) {
      ensureIdle(); const session = get(id);
      if (session.status !== 'awaiting-clarification') throw new Error('This session is not waiting for clarification.');
      const validIds = new Set(session.questions.map(question => question.id));
      if (Object.keys(answers).some(key => !validIds.has(key)) || Object.values(answers).some(value => typeof value !== 'string' || value.length > 500)) throw new Error('Clarification answers must match the current questions.');
      session.answers = { ...answers }; session.context.answers = { ...answers }; session.context.version++; session.round = 1;
      session.status = 'searching'; delete session.error; persist(session);
      return launch(session, signal => research(session, signal, `${session.query}\n${Object.entries(answers).map(([key, value]) => `${key}: ${value}`).join('\n')}`, true));
    },
    refine(id: string, input: { instruction: string; research?: boolean }) {
      ensureIdle(); const session = get(id);
      if (!session.units.length || ACTIVE.has(session.status)) throw new Error('Wait for information cards before refining this search.');
      const previous = structuredClone(session);
      const instruction = input.instruction.trim();
      if (!instruction || instruction.length > 700) throw new Error('Use a refinement of 1–700 characters.');
      if (input.research && session.round >= PERSONAL_SEARCH_LIMITS.rounds) throw new Error('This session reached its two research rounds. Start a new search for another topic.');
      session.context.version++; session.context.goal = instruction; session.pendingUnits = []; session.answer = ''; delete session.answerReview; session.followUp = undefined; delete session.error;
      session.status = input.research ? 'searching' : 'ranking'; persist(session);
      return launch(session, async signal => {
        if (input.research) { session.round++; await research(session, signal, `${session.query}\nSpecific evidence gap to research: ${instruction}`, false); }
        else {
          const units = session.units.map(unit => ({ ...unit, version: unit.version + 1, features: { ...unit.features, values: [...unit.features.values], contextVersion: session.context.version } }));
          session.units = [];
          const control = pipelineControl(signal);
          const accepted = await screen(session, units, control.signal, control);
          if (control.haltError) throw control.haltError;
          if (!session.units.length) throw new Error('No card was scored for the refined context. Previous versions remain in the data export.');
          rank(session);
          await answer(session, automaticSelection(session), signal);
          session.status = accepted < units.length || !!session.error ? 'partial' : session.followUp ? 'awaiting-refinement' : 'completed'; persist(session);
        }
      }, () => {
        if (session.units.some(unit => unit.features.contextVersion === session.context.version)) return false;
        session.units = previous.units; session.pendingUnits = previous.pendingUnits; session.context = previous.context; session.answers = previous.answers; session.answer = previous.answer; session.answerReview = previous.answerReview; session.followUp = previous.followUp;
        return true;
      });
    },
    retry(id: string) {
      ensureIdle(); const session = get(id);
      if (!['failed', 'partial', 'cancelled'].includes(session.status) || !session.sources.length) throw new Error('Only an interrupted exploration with stored sources can resume.');
      delete session.error; session.status = 'grounding'; persist(session);
      return launch(session, async signal => {
        event(session, 'resume', 'Resuming stored source excerpts. No web-search request will be repeated.');
        if (session.round === 0) { session.status = 'interpreting'; await preparePlan(session, signal); return; }
        const covered = new Set([...session.units, ...(session.pendingUnits ?? []), ...(session.withheldUnits ?? []).map(item => item.unit)].flatMap(unit => unit.sourceIds));
        const remaining = session.sources.filter(source => !covered.has(source.id));
        if ((remaining.length || session.pendingUnits?.length) && session.units.length < PERSONAL_SEARCH_LIMITS.units) await processSources(session, signal, remaining);
        else {
          rank(session); await answer(session, automaticSelection(session), signal);
          session.status = session.error ? 'partial' : session.followUp ? 'awaiting-refinement' : 'completed'; persist(session);
        }
      });
    },
    synthesize(id: string, unitIds: string[]) {
      ensureIdle(); const session = get(id);
      if (!unitIds.length || unitIds.length > 6 || unitIds.some(id => !session.units.some(unit => unit.id === id))) throw new Error('Choose 1–6 cards from this session.');
      session.status = 'grounding'; persist(session);
      return launch(session, async signal => { await answer(session, unitIds, signal); session.status = session.error ? 'partial' : session.followUp ? 'awaiting-refinement' : 'completed'; persist(session); });
    },
    cancel(id: string) {
      if (active?.id !== id) throw new Error('This search has no running operation.');
      active.controller.abort(); return { cancelled: true };
    },
    recoverInterrupted() {
      for (const session of store.listSessions()) {
        if (!ACTIVE.has(session.status)) continue;
        session.status = session.units.length ? 'partial' : 'failed';
        if (session.answerReview?.status === 'checking') { session.answerReview.status = 'needs-review'; for (const check of session.answerReview.checks) if (check.status === 'pending') { check.status = 'unavailable'; check.error = 'The server restarted before this check finished.'; } }
        session.error = 'The server restarted before this operation finished. Completed checkpoints were preserved; no paid requests were replayed.';
        try { persist(session); } catch { retainUnsavedFailure(session); }
      }
    },
    getSession: readSession,
    listSessions,
    clearTransientFailures: (id?: string) => { if (id) unsavedFailures.delete(id); else unsavedFailures.clear(); },
    isRunning: () => active !== null,
    waitForIdle: async () => { await active?.task; },
  };
}
