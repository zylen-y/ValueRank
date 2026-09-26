import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PERSONAL_FEATURE_NAMES, PERSONAL_FEATURE_SCHEMA, type PersonalContext, type PersonalProfileFact, type PersonalRankedUnit, type PersonalSearchSession, type PersonalSource, type PersonalUnit } from '../src/domain/personal.ts';
import { TOPICS, type Analysis, type ContentItem, type Profile } from '../src/domain/types.ts';
import { evaluateWithJev } from './jev.ts';
import { classifyProviderError, safeProviderError } from './provider-error.ts';
import { DirectSourceRetrievalError, explicitSearchDomains, explicitSourceUrls, failedSearchUsage, generateSearchJson, matchesSearchDomains, normalizeSearchText, retrievePersonalSources, searchHash, type SearchModelSettings } from './personal-search-adapter.ts';

export const PERSONAL_SEARCH_LIMITS = { discoverySources: 4, researchSources: 8, sources: 16, units: 24, rounds: 2, jevConcurrency: 4, llmConcurrency: 2 } as const;
export interface PersonalSearchStore {
  saveSession(session: PersonalSearchSession): unknown;
  getSession(id: string): PersonalSearchSession | null | undefined;
  listSessions(): PersonalSearchSession[];
  saveSource(source: PersonalSource): unknown;
  saveUnit(unit: PersonalUnit): unknown;
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
  now?: () => number;
}
const questionSchema = z.object({
  questions: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/), question: z.string().min(8).max(220), options: z.array(z.string().min(1).max(100)).min(2).max(4) })).min(2).max(6),
});
const probability = z.number().finite().min(0).max(1);
export const groundedUnitsSchema = z.object({ units: z.array(z.object({
  title: z.string().trim().min(5).max(120), body: z.string().trim().min(30).max(800),
  kind: z.enum(['fact', 'explanation', 'comparison', 'tradeoff', 'method']),
  evidence: z.array(z.object({ sourceId: z.string(), passageId: z.string().min(3).max(80) })).min(1).max(3),
  concepts: z.array(z.string().trim().min(2).max(80)).min(1).max(4),
  limitations: z.array(z.string().min(5).max(180)).max(3),
  effortMinutes: z.number().int().min(1).max(10),
  depth: probability, evidenceStrength: probability,
  topics: z.array(z.enum(TOPICS)).min(1).max(3),
})).min(1).max(4) });
const answerSchema = z.object({
  paragraphs: z.array(z.object({ text: z.string().trim().min(15).max(2000), unitIds: z.array(z.string()).min(1).max(4) })).min(1).max(5),
  followUp: z.object({ id: z.literal('refine'), question: z.string().min(8).max(200), options: z.array(z.string().min(1).max(90)).min(2).max(3) }).nullable(),
});
const ACTIVE = new Set(['interpreting', 'searching', 'grounding', 'ranking']);
const HALT = new Set(['authentication', 'credits', 'access', 'rate-limit', 'model']);
const EVIDENCE_ERROR = 'A generated quotation did not match a retrieved source. The affected card was rejected.';

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
  const now = options.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  let active: { id: string; controller: AbortController; task: Promise<void> } | null = null;
  const persist = (session: PersonalSearchSession) => { session.updatedAt = iso(); store.saveSession(structuredClone(session)); };
  const event = (session: PersonalSearchSession, stage: string, message: string, extra: Partial<PersonalSearchSession['events'][number]> = {}) => {
    session.events.push({ id: randomUUID(), stage, message, at: iso(), ...extra }); persist(session);
  };
  const usage = (session: PersonalSearchSession, result: { tokens: number; durationMs: number; model: string }, stage: 'llm' | 'jev', message: string) => {
    session.usage ??= { llmTokens: 0, jevTokens: 0, searchCalls: 0, elapsedMs: 0 };
    if (stage === 'llm') session.usage.llmTokens += result.tokens; else session.usage.jevTokens += result.tokens;
    event(session, stage, message, { tokens: result.tokens, durationMs: result.durationMs, model: result.model });
  };
  const json = async <T>(session: PersonalSearchSession, schema: z.ZodType<T>, instructions: string, data: unknown, signal: AbortSignal) => {
    try {
      return await generate(schema, instructions, data, options.configuration(), signal, attempt => {
        event(session, 'llm-attempt', `Structured generation attempt ${attempt.attempt}: ${attempt.phase}.${attempt.reasoningTokens === undefined ? '' : ` Reported reasoning tokens: ${attempt.reasoningTokens}.`}${attempt.issues?.length ? ` Constraints: ${attempt.issues.map(issue => `${issue.field} (${issue.rule})`).join(', ')}.` : ''}`, { tokens: attempt.tokens, durationMs: attempt.durationMs, model: attempt.model });
      });
    } catch (error) {
      const spent = failedSearchUsage(error);
      if (spent) usage(session, spent, 'llm', 'Generation failed; reported token usage was preserved.');
      throw error;
    }
  };
  const get = (id: string) => { const session = store.getSession(id); if (!session) throw new Error('Search session was not found.'); return structuredClone(session); };
  const ensureIdle = () => { if (active) throw new Error('A personal search operation is already running. Cancel it or wait for completion.'); };
  const safeError = (error: unknown) => error instanceof DirectSourceRetrievalError ? error.message : error instanceof Error && error.message === EVIDENCE_ERROR ? EVIDENCE_ERROR : safeProviderError(error, { stage: 'llm', provider: 'gateway' });
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
      event(session, 'error', session.error);
    }).finally(() => {
      session.usage ??= { llmTokens: 0, jevTokens: 0, searchCalls: 0, elapsedMs: 0 };
      session.usage.elapsedMs += now() - start; persist(session);
      if (active?.id === session.id) active = null;
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
      return;
    }
    event(session, directUrls.length ? 'source' : 'search', directUrls.length ? `Reading ${directUrls.length} supplied public page URL(s). No LLM search request is needed.` : 'Searching the live web. Result titles and excerpts are source data, not verified facts.');
    let result: Awaited<ReturnType<typeof retrieve>>;
    try { result = await retrieve(query, count, settings, signal); }
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
      store.saveSource(source); session.sources.push(source);
    }
    persist(session);
  };
  const goal = (session: PersonalSearchSession) => `Primary search intent: ${session.query}\nCurrent refinement: ${session.context.goal}\nClarifications (highest priority): ${JSON.stringify(session.answers)}\nRecorded personal values/preferences, only where relevant to this query: ${JSON.stringify(scopedFacts().filter(fact => fact.kind !== 'knowledge').map(fact => ({ kind: fact.kind, value: fact.value, source: fact.source })))}`.slice(0, 3000);
  const rank = (session: PersonalSearchSession) => {
    const originals = new Map(session.units.map(unit => [unit.id, unit]));
    session.units = store.rank(session.units, session.context).map(unit => originals.get(unit.id)!).filter(Boolean);
    event(session, 'rank', 'Ranked with Jev judgments and the current personal model; source order remains available.', { completed: session.units.length, total: session.units.length });
  };
  const screen = async (session: PersonalSearchSession, units: PersonalUnit[], signal: AbortSignal) => {
    const settings = options.configuration();
    session.status = 'ranking';
    session.pendingUnits ??= [];
    for (const unit of units) {
      if (!session.pendingUnits.some(pending => pending.id === unit.id && pending.version === unit.version)) session.pendingUnits.push(unit);
    }
    event(session, 'jev', 'Jev is judging relevance, novelty, and actionability for each independent card.', { completed: 0, total: units.length, model: settings.jevModel });
    let cursor = 0; let completed = 0; let haltError: unknown;
    const profile: Profile = { ...options.profile(), goal: goal(session), knownConcepts: known(), version: session.context.version };
    const accepted: PersonalUnit[] = [];
    await Promise.all(Array.from({ length: Math.min(PERSONAL_SEARCH_LIMITS.jevConcurrency, units.length) }, async () => {
      while (cursor < units.length && !haltError && !signal.aborted) {
        const unit = units[cursor++];
        const sourceText = unit.evidence.map(e => e.quote).join('\n\n');
        const analysis: Analysis = { summary: unit.body, concepts: unit.concepts, topics: ['ranking'], evidence: unit.evidence.map(e => ({ quote: e.quote, insight: unit.body.slice(0, 250) })), readingMinutes: unit.effortMinutes, source: 'llm', model: settings.llmModel };
        const item: ContentItem = { id: unit.id, title: unit.title, url: session.sources.find(source => unit.sourceIds.includes(source.id))?.url ?? '', publisher: 'Retrieved source excerpts', kind: 'note', text: sourceText, addedAt: unit.createdAt, provenance: 'url-extraction', analysis, decision: null, feedback: null, status: 'processing', error: null };
        const start = now();
        try {
          const result = await evaluate(item, analysis, profile, { apiKey: settings.jevKey, model: settings.jevModel, provider: settings.jevProvider }, signal);
          signal.throwIfAborted();
          const { relevance, novelty, actionability } = result.decision;
          unit.features.values.splice(0, 3, relevance, novelty, actionability);
          unit.features.encoder = 'llm-attributes+jev'; unit.features.model = `${settings.llmModel};${result.decision.model}`;
          unit.prior = 2 * (0.5 * relevance + 0.3 * novelty + 0.2 * actionability - 0.5);
          store.saveUnit(unit); accepted.push(unit);
          session.pendingUnits = session.pendingUnits?.filter(pending => pending.id !== unit.id || pending.version !== unit.version);
          const existing = session.units.findIndex(current => current.id === unit.id);
          if (existing >= 0) session.units[existing] = unit; else session.units.push(unit);
          completed++;
          usage(session, { tokens: result.tokens, durationMs: now() - start, model: result.decision.model }, 'jev', `Scored card ${completed} of ${units.length}.`);
          event(session, 'jev-progress', 'Real Jev judgments received.', { completed, total: units.length });
        } catch (error) {
          if (signal.aborted) break;
          const message = safeProviderError(error, { stage: 'jev', provider: settings.jevProvider });
          event(session, 'error', message);
          if (HALT.has(classifyProviderError(error))) haltError = error;
        }
      }
    }));
    signal.throwIfAborted();
    if (haltError) {
      session.error = safeProviderError(haltError, { stage: 'jev', provider: settings.jevProvider });
      event(session, 'error', 'New Jev requests stopped after a provider access, rate, or billing error.');
    }
    return accepted.length;
  };
  const ground = async (session: PersonalSearchSession, sources: PersonalSource[], signal: AbortSignal) => {
    session.status = 'grounding';
    event(session, 'grounding', 'Turning retrieved excerpts into standalone, independently rankable information cards.');
    const groups: PersonalSource[][] = [];
    for (let index = 0; index < sources.length; index += 2) groups.push(sources.slice(index, index + 2));
    let cursor = 0; let haltError: unknown;
    const units: PersonalUnit[] = [];
    await Promise.all(Array.from({ length: Math.min(PERSONAL_SEARCH_LIMITS.llmConcurrency, groups.length) }, async () => {
      while (cursor < groups.length && !haltError && !signal.aborted) {
        const group = groups[cursor++];
        try {
          const result = await json(session, groundedUnitsSchema,
            ATTRIBUTION_RULE + 'Create 2-4 concise independent information cards from these source excerpts, useful for the query and intent. Each card must stand alone, make one clear point, and select supporting passage IDs from the supplied catalog. Each evidence object contains sourceId and passageId only. Never write, copy, translate, or invent quote text: the server will retrieve the exact original passage for the selected ID. Select only passages that substantively support the entire card. Preserve disagreements and uncertainty. Never turn a source title into authority or a rumor into a confirmed fact. No invented product/entity existence. Do not restate a whole article. Include limitations for truncated or promotional sources. Topic labels are coarse features only: choose the nearest supplied labels. depth and evidenceStrength are editorial estimates, not probabilities of truth. Write titles, bodies, concepts, and limitations in the user question language; use Korean when the query contains Korean prose. Evidence passages stay verbatim in their original language; select their IDs without translating text. Stay compact: body under 450 characters, at most two supporting passage IDs per card.',
            { query: session.query, context: session.context, sources: group.map(source => ({ id: source.id, title: source.title, url: source.url, publisherDomain: source.publisher, authority: 'unverified', passages: sourcePassages(source).map(passage => ({ id: passage.id, text: passage.text })), publishedAt: source.publishedAt, provenance: source.provenance })) }, signal);
          signal.throwIfAborted();
          usage(session, result, 'llm', 'Generated candidate information cards; validating their quotations.');
          let acceptedCards = 0;
          for (const candidate of result.value.units) {
            let card: ResolvedCard;
            try { card = resolveGroundedCard(candidate, group); }
            catch { session.error ??= 'Some generated cards were rejected because their quotes did not match source excerpts.'; event(session, 'evidence-rejected', EVIDENCE_ERROR); continue; }
            if (session.units.length + (session.pendingUnits?.length ?? 0) >= PERSONAL_SEARCH_LIMITS.units) break;
            const identity = searchHash(JSON.stringify({ title: card.title, body: card.body, evidence: card.evidence })).slice(0, 24);
            if (session.units.some(unit => unit.id === `unit-${identity}`) || units.some(unit => unit.id === `unit-${identity}`) || session.pendingUnits?.some(unit => unit.id === `unit-${identity}`)) continue;
            const draft: PersonalUnit = {
              id: `unit-${identity}`, entityId: `content-${searchHash([...new Set(card.evidence.map(e => group.find(source => source.id === e.sourceId)!.url))].sort().join('\n')).slice(0, 24)}`, version: 1, domain: 'content', modality: 'text', kind: card.kind,
              title: card.title, body: card.body, sourceIds: [...new Set(card.evidence.map(e => e.sourceId))],
              evidence: card.evidence.map(e => ({ ...e, sourceVersion: group.find(source => source.id === e.sourceId)!.version })),
              concepts: card.concepts, limitations: card.limitations, effortMinutes: card.effortMinutes,
              features: { schemaId: PERSONAL_FEATURE_SCHEMA, names: [...PERSONAL_FEATURE_NAMES], values: [0, 0, 0, card.depth, card.evidenceStrength, 1 - Math.min(1, card.effortMinutes / 10), ...TOPICS.map(topic => card.topics.includes(topic) ? 1 : 0)], encoder: 'llm-attributes-pending-jev', model: options.configuration().llmModel, contextVersion: session.context.version },
              prior: 0, createdAt: iso(),
            };
            units.push(draft);
            session.pendingUnits ??= []; session.pendingUnits.push(draft);
            persist(session);
            acceptedCards++;
          }
          event(session, 'evidence', `${acceptedCards} of ${result.value.units.length} candidate cards passed exact source-quote matching. This checks provenance, not semantic truth.`);
        } catch (error) {
          if (signal.aborted) break;
          session.error ??= 'Some source batches could not produce valid grounded cards. Results below contain only accepted cards.';
          event(session, 'error', safeError(error));
          if (HALT.has(classifyProviderError(error))) haltError = error;
        }
      }
    }));
    signal.throwIfAborted();
    if (haltError && !units.length) throw haltError;
    return units;
  };
  const automaticSelection = (session: PersonalSearchSession) => {
    const domains = explicitSearchDomains(session.context.goal);
    const preferred = new Set(session.sources.filter(source => domains.length && matchesSearchDomains(source.url, domains)).map(source => source.id));
    const isPreferred = (unit: PersonalUnit) => unit.sourceIds.some(id => preferred.has(id));
    const candidates = preferred.size ? [...session.units.filter(isPreferred), ...session.units.filter(unit => !isPreferred(unit))] : session.units;
    return selectSynthesisUnits(candidates).map(unit => unit.id);
  };
  const answer = async (session: PersonalSearchSession, selectedIds: string[], signal: AbortSignal) => {
    const selected = session.units.filter(unit => selectedIds.includes(unit.id)).slice(0, 6);
    if (!selected.length) throw new Error('Choose at least one existing information card.');
    event(session, 'answer', 'Composing a concise answer from the selected cards only.');
    const result = await json(session, answerSchema,
      ATTRIBUTION_RULE + 'Assemble a short useful answer using only the supplied information cards. Aim for 2-3 paragraphs of 2-3 short sentences each. Every paragraph must cite one or more supplied unitIds that support the paragraph. Do not introduce outside claims, URLs, or citations. The selected cards are only a subset of retrieved evidence. Never claim that a full source or document lacks information because these selected cards omit it. If evidence is insufficient, say only that the selected cards do not establish the claim; do not assert absence from the underlying document. Explicitly retain uncertainty. Return a targeted follow-up only if choosing among existing content or filling a concrete evidence gap would materially improve the answer; otherwise null. Do not infer permanent preferences. Write prose in the query language; use Korean when the query contains Korean prose. Any quoted source words must remain verbatim in their original language.',
      { query: session.query, context: session.context, cards: selected.map(unit => ({ id: unit.id, title: unit.title, body: unit.body, limitations: unit.limitations, sources: session.sources.filter(source => unit.sourceIds.includes(source.id)).map(source => ({ id: source.id, url: source.url, publisherDomain: source.publisher, authority: 'unverified', provenance: source.provenance })), evidence: unit.evidence })) }, signal);
    signal.throwIfAborted();
    const allowed = new Set(selected.map(unit => unit.id));
    if (result.value.paragraphs.some(paragraph => paragraph.unitIds.some(id => !allowed.has(id)))) throw new Error(EVIDENCE_ERROR);
    // Stable references survive personal reranking and identify immutable card versions.
    session.answer = result.value.paragraphs.map(paragraph => `${paragraph.text} ${paragraph.unitIds.map(id => `[unit:${id}@${selected.find(unit => unit.id === id)!.version}]`).join(' ')}`).join('\n\n');
    session.followUp = result.value.followUp ?? undefined;
    usage(session, result, 'llm', 'Answer grounded in the selected card IDs.');
  };
  const processSources = async (session: PersonalSearchSession, signal: AbortSignal, candidates: PersonalSource[]) => {
    await ground(session, candidates, signal);
    const units = session.pendingUnits?.filter(unit => unit.features.contextVersion === session.context.version) ?? [];
    const previous = session.units.filter(unit => unit.features.contextVersion !== session.context.version).map(unit => ({ ...unit, version: unit.version + 1, features: { ...unit.features, values: [...unit.features.values], contextVersion: session.context.version } }));
    session.units = session.units.filter(unit => unit.features.contextVersion === session.context.version);
    const screening = [...previous, ...units].slice(0, PERSONAL_SEARCH_LIMITS.units);
    const accepted = await screen(session, screening, signal);
    if (!session.units.length) throw new Error('No fully grounded and Jev-scored cards were accepted.');
    rank(session);
    await answer(session, automaticSelection(session), signal);
    session.status = accepted < screening.length || !!session.error ? 'partial' : session.followUp ? 'awaiting-refinement' : 'completed';
    event(session, 'complete', `${session.units.length} cards ready. Compare cards to teach the personal model.`);
  };

  const research = async (session: PersonalSearchSession, signal: AbortSignal, query: string, includeDiscovery: boolean) => {
    const oldIds = new Set(includeDiscovery ? [] : session.sources.map(source => source.id));
    await collect(session, query, PERSONAL_SEARCH_LIMITS.researchSources, signal);
    await processSources(session, signal, session.sources.filter(source => !oldIds.has(source.id)));
  };

  return {
    start(query: string) {
      ensureIdle();
      query = query.trim();
      if (!query || query.length > 500) throw new Error('Enter a search query of 1–500 characters.');
      const settings = options.configuration();
      if (!settings.gatewayKey || !settings.jevKey) throw new Error('Configure AI Gateway and Jev provider credentials before searching.');
      const id = randomUUID();
      const session: PersonalSearchSession = { id, query, status: 'interpreting', createdAt: iso(), updatedAt: iso(), context: { id, version: 1, query, goal: query, answers: {} }, questions: [], answers: {}, sources: [], units: [], pendingUnits: [], events: [], answer: '', usage: { llmTokens: 0, jevTokens: 0, searchCalls: 0, elapsedMs: 0 }, round: 0 };
      persist(session);
      return launch(session, async signal => {
        await collect(session, query, PERSONAL_SEARCH_LIMITS.discoverySources, signal);
        event(session, 'clarification', 'Preparing two or three questions that change what information is valuable to you.');
        const result = await json(session, questionSchema,
          'Ask 2-3 short useful multiple-choice clarification questions about this search. Prioritize intent, current knowledge, and a meaningful tradeoff. The current query is primary; use optional background profile context only when relevant and never impose its previous project goal on an unrelated query. If the entity is ambiguous in retrieved evidence, ask what the user means; never assert an invented meaning. Source titles may be misleading. These are bounded source excerpts, not proof of complete document coverage. Never claim that a document does not mention or contain a topic because it is absent from an excerpt; truncated=false only means the supplied slice contains the stored text, not necessarily the whole page. Avoid unverified factual premises in questions: ask about intent, existing knowledge, and constraints instead. Each question must have a unique short id. These are optional questions: the user can search immediately. Write prose in the query language; use Korean when the query contains Korean prose. Any quoted source words must remain verbatim in their original language.',
          { query, goal: session.context.goal, optionalProfileContext: options.profile().goal, recordedFacts: scopedFacts().map(fact => ({ kind: fact.kind, value: fact.value, source: fact.source })), knownConcepts: known(), sources: session.sources.map(source => ({ title: source.title, url: source.url, text: source.text.slice(0, 6000), truncated: source.text.length > 6000, storedCharacters: source.text.length, suppliedCharacters: Math.min(source.text.length, 6000), provenance: source.provenance, limitations: source.limitations ?? [] })) }, signal);
        signal.throwIfAborted();
        if (new Set(result.value.questions.map(question => question.id)).size !== result.value.questions.length) throw new Error('Clarification question identifiers were not unique.');
        session.questions = result.value.questions.slice(0, 3); session.status = 'awaiting-clarification';
        usage(session, result, 'llm', 'Clarification questions are ready. No model request remains open while you choose.');
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
      session.context.version++; session.context.goal = instruction; session.pendingUnits = []; session.answer = ''; session.followUp = undefined; delete session.error;
      session.status = input.research ? 'searching' : 'ranking'; persist(session);
      return launch(session, async signal => {
        if (input.research) { session.round++; await research(session, signal, `${session.query}\nSpecific evidence gap to research: ${instruction}`, false); }
        else {
          const units = session.units.map(unit => ({ ...unit, version: unit.version + 1, features: { ...unit.features, values: [...unit.features.values], contextVersion: session.context.version } }));
          session.units = [];
          const accepted = await screen(session, units, signal);
          if (!session.units.length) throw new Error('No card was scored for the refined context. Previous versions remain in the data export.');
          rank(session);
          await answer(session, automaticSelection(session), signal);
          session.status = accepted < units.length ? 'partial' : session.followUp ? 'awaiting-refinement' : 'completed'; persist(session);
        }
      }, () => {
        if (session.units.some(unit => unit.features.contextVersion === session.context.version)) return false;
        session.units = previous.units; session.pendingUnits = previous.pendingUnits; session.context = previous.context; session.answers = previous.answers; session.answer = previous.answer; session.followUp = previous.followUp;
        return true;
      });
    },
    retry(id: string) {
      ensureIdle(); const session = get(id);
      if (!['failed', 'partial', 'cancelled'].includes(session.status) || !session.sources.length) throw new Error('Only an interrupted exploration with stored sources can resume.');
      delete session.error; session.status = 'grounding'; persist(session);
      return launch(session, async signal => {
        event(session, 'resume', 'Resuming stored source excerpts. No web-search request will be repeated.');
        const covered = new Set([...session.units, ...(session.pendingUnits ?? [])].flatMap(unit => unit.sourceIds));
        const remaining = session.sources.filter(source => !covered.has(source.id));
        if ((remaining.length || session.pendingUnits?.length) && session.units.length < PERSONAL_SEARCH_LIMITS.units) await processSources(session, signal, remaining);
        else {
          rank(session); await answer(session, automaticSelection(session), signal);
          session.status = session.followUp ? 'awaiting-refinement' : 'completed'; persist(session);
        }
      });
    },
    synthesize(id: string, unitIds: string[]) {
      ensureIdle(); const session = get(id);
      if (!unitIds.length || unitIds.length > 6 || unitIds.some(id => !session.units.some(unit => unit.id === id))) throw new Error('Choose 1–6 cards from this session.');
      session.status = 'grounding'; persist(session);
      return launch(session, async signal => { await answer(session, unitIds, signal); session.status = session.followUp ? 'awaiting-refinement' : 'completed'; persist(session); });
    },
    cancel(id: string) {
      if (active?.id !== id) throw new Error('This search has no running operation.');
      active.controller.abort(); return { cancelled: true };
    },
    recoverInterrupted() {
      for (const session of store.listSessions()) {
        if (!ACTIVE.has(session.status)) continue;
        session.status = session.units.length ? 'partial' : 'failed';
        session.error = 'The server restarted before this operation finished. Completed checkpoints were preserved; no paid requests were replayed.'; persist(session);
      }
    },
    isRunning: () => active !== null,
    waitForIdle: async () => { await active?.task; },
  };
}
