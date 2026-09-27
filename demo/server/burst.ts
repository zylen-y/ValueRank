import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { BURST_CORPUS } from '../src/domain/burst-corpus.ts';
import { BURST_CONCURRENCY, BURST_MAX_ITEMS, type BurstItem, type BurstJob } from '../src/domain/burst.ts';
import { rankItems } from '../src/domain/ranking.ts';
import { TOPICS, type ContentItem, type Profile } from '../src/domain/types.ts';
import { evaluateWithJev } from './jev.ts';
import { classifyProviderError, safeProviderError } from './provider-error.ts';

type Evaluator = typeof evaluateWithJev;
type Configuration = Parameters<Evaluator>[3];
interface Options {
  configuration: () => Configuration;
  corpus?: ContentItem[];
  evaluate?: Evaluator;
  persistencePath?: string;
  now?: () => number;
}

const probability = z.number().finite().min(0).max(1);
const timestamp = z.iso.datetime();
const persistedSchema = z.object({
  version: z.literal(1),
  corpusHash: z.string().regex(/^[a-f0-9]{64}$/),
  job: z.object({
    id: z.string().uuid(), status: z.enum(['running', 'completed', 'failed', 'cancelled']),
    profile: z.object({
      goal: z.string().max(3_000), knownConcepts: z.array(z.string().max(240)).max(100),
      interests: z.record(z.enum(TOPICS), probability), feedbackCount: z.number().int().nonnegative(), version: z.number().int().nonnegative(),
    }),
    provider: z.enum(['typesafe', 'openrouter']), model: z.string().max(128),
    startedAt: timestamp, finishedAt: timestamp.nullable(), cancelRequested: z.boolean(),
    stopReason: z.string().max(1_000).nullable(),
    items: z.array(z.object({
      id: z.string().max(160), status: z.enum(['queued', 'running', 'completed', 'error', 'cancelled', 'skipped']),
      startedAt: timestamp.nullable(), completedAt: timestamp.nullable(), durationMs: z.number().finite().nonnegative().nullable(),
      tokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), error: z.string().max(1_000).nullable(),
      decision: z.object({
        relevance: probability, novelty: probability, actionability: probability, source: z.literal('jev'),
        provider: z.enum(['typesafe', 'openrouter']).optional(), model: z.string().max(128),
        profileVersion: z.number().int().nonnegative(), createdAt: timestamp,
      }).nullable(),
    })).min(1).max(BURST_MAX_ITEMS),
  }),
});

const HALT_FAILURES = new Set(['authentication', 'credits', 'access', 'rate-limit', 'model']);
const CANCELLED = 'Screening cancelled. No decision was accepted for this item.';
const SKIPPED = 'Not sent because a provider access, billing, model, or rate limit stopped the batch.';
const INTERRUPTED = 'The server restarted before this screening finished. Start a new run to evaluate the unfinished briefs.';

/** Six bounded real Jev requests in parallel; no LLM, timers, or synthetic forecasts. */
export function createBurstService(options: Options) {
  const corpus = structuredClone(options.corpus ?? BURST_CORPUS);
  if (!corpus.length || corpus.length > BURST_MAX_ITEMS || new Set(corpus.map(item => item.id)).size !== corpus.length) {
    throw new Error(`A screening corpus must contain 1–${BURST_MAX_ITEMS} uniquely identified briefs.`);
  }
  if (corpus.some(item => !item.analysis || item.analysis.source !== 'editorial' || item.provenance !== 'editorial-brief' || !item.text.trim())) {
    throw new Error('Screening requires explicitly labeled editorial briefs with editorial analysis and source text.');
  }
  const corpusHash = createHash('sha256').update(JSON.stringify(corpus.map(item => ({ id: item.id, text: item.text, analysis: item.analysis })))).digest('hex');
  const evaluate = options.evaluate ?? evaluateWithJev;
  const now = options.now ?? Date.now;
  let current: BurstJob | null = null;
  let controller: AbortController | null = null;
  const iso = () => new Date(now()).toISOString();

  const freshItem = (item: ContentItem): BurstItem => ({
    ...structuredClone(item), status: 'queued', decision: null, feedback: null, error: null,
    topics: [...item.analysis!.topics], readingMinutes: item.analysis!.readingMinutes,
    startedAt: null, completedAt: null, durationMs: null, tokens: 0, score: null,
  });
  function refresh(job: BurstJob) {
    job.elapsedMs = Math.max(0, (job.finishedAt ? Date.parse(job.finishedAt) : now()) - Date.parse(job.startedAt));
    job.processed = job.items.filter(item => item.status === 'completed').length;
    job.errors = job.items.filter(item => item.status === 'error').length;
    job.cancelled = job.items.filter(item => item.status === 'cancelled').length;
    job.skipped = job.items.filter(item => item.status === 'skipped').length;
    job.active = job.items.filter(item => item.status === 'running').length;
    job.queued = job.items.filter(item => item.status === 'queued').length;
    job.forecasts = job.processed * 3;
    job.tokens = job.items.reduce((sum, item) => sum + item.tokens, 0);
    job.throughputPerSecond = job.elapsedMs > 0 ? job.processed * 1_000 / job.elapsedMs : 0;
  }
  function snapshot(): BurstJob | null {
    if (!current) return null;
    refresh(current);
    return structuredClone(current);
  }
  function persist() {
    if (!options.persistencePath || !current) return;
    const temporary = `${options.persistencePath}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(options.persistencePath), { recursive: true });
      current.persistenceError = null;
      writeFileSync(temporary, JSON.stringify({ version: 1, corpusHash, job: snapshot() }), { mode: 0o600 });
      renameSync(temporary, options.persistencePath);
    } catch {
      current.persistenceError = 'This result is available in this session, but could not be saved for the next server start.';
      try { unlinkSync(temporary); } catch { /* A failed write may not have created a temporary file. */ }
    }
  }
  function blank(profile: Profile, configuration: Configuration): BurstJob {
    return {
      id: randomUUID(), status: 'running', profile: structuredClone(profile), provider: configuration.provider ?? 'typesafe', model: configuration.model,
      startedAt: iso(), finishedAt: null, elapsedMs: 0, total: corpus.length, processed: 0, errors: 0,
      cancelled: 0, skipped: 0, active: 0, queued: corpus.length, forecasts: 0, tokens: 0,
      concurrency: BURST_CONCURRENCY, throughputPerSecond: 0, cancelRequested: false, stopReason: null, persistenceError: null,
      items: corpus.map(freshItem),
    };
  }

  if (options.persistencePath) {
    try {
      if (statSync(options.persistencePath).size > 2_000_000) throw new Error('Oversized checkpoint');
      const saved = persistedSchema.parse(JSON.parse(readFileSync(options.persistencePath, 'utf8')));
      if (saved.corpusHash !== corpusHash) throw new Error('Different corpus content');
      const parsed = saved.job;
      const ids = new Set(parsed.items.map(item => item.id));
      if (ids.size !== corpus.length || parsed.items.length !== corpus.length || corpus.some(item => !ids.has(item.id))) throw new Error('Different corpus');
      if (parsed.items.some(item => item.status === 'completed' && (!item.decision || item.decision.profileVersion !== parsed.profile.version))) throw new Error('Incomplete checkpoint');
      if (parsed.status !== 'running' && !parsed.finishedAt) throw new Error('Unfinished checkpoint');
      const restored = blank(parsed.profile, { apiKey: '', model: parsed.model, provider: parsed.provider });
      Object.assign(restored, parsed, { items: corpus.map(item => ({ ...freshItem(item), ...parsed.items.find(saved => saved.id === item.id)! })) });
      for (const item of restored.items) {
        if (item.status === 'completed') item.score = rankItems([{ ...item, status: 'ready' }], restored.profile)[0].score;
      }
      if (restored.status === 'running' || restored.items.some(item => item.status === 'running' || item.status === 'queued')) {
        restored.status = 'failed'; restored.finishedAt = iso(); restored.stopReason = INTERRUPTED;
        for (const item of restored.items) {
          if (item.status === 'running') { item.status = 'error'; item.error = INTERRUPTED; item.completedAt = restored.finishedAt; }
          if (item.status === 'queued') { item.status = 'skipped'; item.error = INTERRUPTED; }
        }
      }
      current = restored;
      refresh(current);
    } catch { /* A missing, corrupt, or incompatible local checkpoint starts clean. */ }
  }

  function start(profile: Profile) {
    if (current?.status === 'running') throw new Error('A screening run is already in progress.');
    const configuration = { ...options.configuration() };
    if (!configuration.apiKey.trim()) throw new Error('Add OPENROUTER_API_KEY (or TYPESAFE_API_KEY) to demo/.env.local before screening.');
    current = blank(profile, configuration);
    const job = current;
    controller = new AbortController();
    const signal = controller.signal;
    persist();
    let halted = false;
    const worker = async () => {
      while (!signal.aborted && !halted) {
        // JavaScript claims a queued row synchronously before yielding, so a
        // second worker cannot dispatch the same source.
        const item = job.items.find(candidate => candidate.status === 'queued');
        if (!item) return;
        item.status = 'running'; item.startedAt = iso();
        try {
          const result = await evaluate(
            { ...item, status: 'unprocessed' }, item.analysis!, structuredClone(job.profile), configuration, signal,
          );
          item.decision = result.decision; item.tokens = result.tokens; item.status = 'completed';
          item.score = rankItems([{ ...item, status: 'ready' }], job.profile)[0].score;
        } catch (error) {
          if (signal.aborted) {
            item.status = 'cancelled'; item.error = CANCELLED;
          } else {
            item.status = 'error';
            item.error = safeProviderError(error, { stage: 'jev', provider: job.provider });
            if (HALT_FAILURES.has(classifyProviderError(error))) {
              halted = true;
              job.stopReason ??= item.error;
              for (const pending of job.items) if (pending.status === 'queued') { pending.status = 'skipped'; pending.error = SKIPPED; }
            }
          }
        } finally {
          item.completedAt = iso();
          item.durationMs = Math.max(0, Date.parse(item.completedAt) - Date.parse(item.startedAt!));
        }
      }
    };
    const done = Promise.all(Array.from({ length: Math.min(BURST_CONCURRENCY, job.total) }, worker)).then(() => {
      refresh(job);
      job.status = job.cancelRequested ? 'cancelled' : job.errors || job.skipped ? 'failed' : 'completed';
      job.finishedAt = iso();
      refresh(job);
      persist();
    });
    return { job: snapshot()!, done };
  }
  function cancel() {
    if (current?.status !== 'running') return snapshot();
    current.cancelRequested = true;
    current.stopReason = 'Cancelled by you. Completed Jev decisions remain available.';
    for (const item of current.items) if (item.status === 'queued') { item.status = 'cancelled'; item.error = CANCELLED; }
    controller?.abort();
    return snapshot();
  }
  return { start, snapshot, cancel };
}
