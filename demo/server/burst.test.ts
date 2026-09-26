import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContentItem, Profile } from '../src/domain/types.ts';
import { createBurstService } from './burst.ts';
import type { evaluateWithJev } from './jev.ts';

// Orchestration tests supply a small corpus so they never depend on source
// selection or make a paid request. The editorial corpus has its own tests.
vi.mock('../src/domain/burst-corpus.ts', () => ({ BURST_CORPUS: [] }));

const profile: Profile = {
  goal: 'Build a language-learning content curation engine', knownConcepts: ['Semantic retrieval'],
  interests: { agents: 0.8, ranking: 1, rl: 0.9, web: 0.5, language: 1, design: 0.5 }, feedbackCount: 2, version: 5,
};
const configuration = () => ({ apiKey: 'secret-must-not-persist', model: 'typesafe/jev-1.13', provider: 'openrouter' as const });
const corpus = (count = 12): ContentItem[] => Array.from({ length: count }, (_, index) => ({
  id: `burst-${index}`, title: `Brief ${index}`, url: 'https://example.com/source', publisher: 'Example', kind: 'note',
  text: 'Compare pairs of lessons to gather relative preferences.', addedAt: '2026-09-26T00:00:00.000Z', provenance: 'editorial-brief',
  analysis: { summary: 'A practical comparison method.', concepts: ['Pairwise preference'], topics: ['ranking'], evidence: [], readingMinutes: 2, source: 'editorial', model: 'editorial-v1' },
  decision: null, feedback: null, status: 'ready', error: null,
}));
const result = (version = profile.version) => ({
  decision: { relevance: 0.9, novelty: 0.8, actionability: 0.7, source: 'jev' as const, provider: 'openrouter' as const, model: 'typesafe/jev-1.13-20260917', profileVersion: version, createdAt: '2026-09-26T00:00:00.000Z' },
  tokens: 120,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const folders: string[] = [];
function checkpoint() { const dir = mkdtempSync(join(tmpdir(), 'valuerank-burst-')); folders.push(dir); return join(dir, 'burst.json'); }
afterEach(() => { for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('bounded real-decision screening orchestration', () => {
  it('keeps exactly six requests active, dispatches each brief once, and counts only actual completed decisions', async () => {
    const waiting: Array<ReturnType<typeof deferred<ReturnType<typeof result>>>> = [];
    let active = 0; let peak = 0; let clock = Date.parse('2026-09-26T00:00:00.000Z');
    const evaluate = vi.fn<typeof evaluateWithJev>(async () => {
      const request = deferred<ReturnType<typeof result>>(); waiting.push(request); active++; peak = Math.max(active, peak);
      try { return await request.promise; } finally { active--; }
    });
    const service = createBurstService({ configuration, corpus: corpus(13), evaluate, now: () => clock });
    const { done } = service.start(profile);
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(service.snapshot()).toMatchObject({ total: 13, active: 6, queued: 7, processed: 0, forecasts: 0, tokens: 0 });
    clock += 500;
    waiting[0].resolve(result());
    await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(7));
    expect(service.snapshot()).toMatchObject({ active: 6, queued: 6, processed: 1, forecasts: 3, tokens: 120 });
    expect(service.snapshot()!.items[0]).toMatchObject({ status: 'completed', durationMs: 500, completedAt: '2026-09-26T00:00:00.500Z' });
    for (let index = 1; index < 13; index++) {
      await vi.waitFor(() => expect(waiting[index]).toBeDefined());
      clock += 100; waiting[index].resolve(result());
    }
    await done;
    expect(peak).toBe(6);
    expect(new Set(evaluate.mock.calls.map(call => call[0].id)).size).toBe(13);
    expect(service.snapshot()).toMatchObject({ status: 'completed', processed: 13, errors: 0, forecasts: 39, tokens: 1_560, active: 0, queued: 0, elapsedMs: 1_700 });
    expect(service.snapshot()!.throughputPerSecond).toBeCloseTo(13 / 1.7);
    clock += 10_000;
    expect(service.snapshot()!.elapsedMs).toBe(1_700);
    expect(service.snapshot()!.items.every(item => item.score !== null)).toBe(true);
  });

  it('snapshots the goal and knowledge without changing the saved profile or exposing credentials', async () => {
    const pending = deferred<ReturnType<typeof result>>();
    const supplied = structuredClone(profile);
    const evaluate = vi.fn<typeof evaluateWithJev>(async (_item, analysis, receivedProfile, credentials, signal) => {
      expect(analysis.source).toBe('editorial'); expect(receivedProfile).toEqual(profile);
      expect(credentials).toEqual(configuration()); expect(signal?.aborted).toBe(false);
      receivedProfile.goal = 'A mutation inside a dependency';
      return pending.promise;
    });
    const service = createBurstService({ configuration, corpus: corpus(1), evaluate });
    const { done, job } = service.start(supplied);
    supplied.goal = 'Another goal'; job.profile.goal = 'Changed returned snapshot';
    expect(service.snapshot()!.profile).toEqual(profile);
    expect(JSON.stringify(service.snapshot())).not.toContain(configuration().apiKey);
    pending.resolve(result()); await done;
  });

  it('rejects overlapping jobs and missing credentials before dispatch', async () => {
    const pending = deferred<ReturnType<typeof result>>();
    const evaluate = vi.fn<typeof evaluateWithJev>(async () => pending.promise);
    const service = createBurstService({ configuration, corpus: corpus(1), evaluate });
    const { done } = service.start(profile);
    expect(() => service.start(profile)).toThrow('already in progress');
    pending.resolve(result()); await done;
    const empty = createBurstService({ configuration: () => ({ ...configuration(), apiKey: ' ' }), corpus: corpus(1), evaluate });
    expect(() => empty.start(profile)).toThrow('API_KEY');
    expect(empty.snapshot()).toBeNull(); expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('cancels in-flight requests and never dispatches queued briefs after cancellation', async () => {
    const evaluate = vi.fn<typeof evaluateWithJev>(async (_item, _analysis, _profile, _config, signal) => new Promise((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('private provider message', 'AbortError')), { once: true });
    }));
    const service = createBurstService({ configuration, corpus: corpus(), evaluate });
    const { done } = service.start(profile);
    expect(service.cancel()).toMatchObject({ status: 'running', cancelRequested: true, active: 6, cancelled: 6, queued: 0 });
    expect(() => service.start(profile)).toThrow('already in progress');
    await done;
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(service.snapshot()).toMatchObject({ status: 'cancelled', processed: 0, cancelled: 12, errors: 0, forecasts: 0, tokens: 0 });
    expect(service.snapshot()!.items.every(item => item.decision === null && item.score === null)).toBe(true);
    expect(JSON.stringify(service.snapshot())).not.toContain('private provider message');
  });

  it('keeps earlier successful decisions when the remaining work is cancelled', async () => {
    const first = deferred<ReturnType<typeof result>>();
    let count = 0;
    const evaluate = vi.fn<typeof evaluateWithJev>(async (_item, _analysis, _profile, _config, signal) => {
      if (count++ === 0) return first.promise;
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
    });
    const service = createBurstService({ configuration, corpus: corpus(), evaluate });
    const { done } = service.start(profile);
    first.resolve(result());
    await vi.waitFor(() => expect(service.snapshot()!.processed).toBe(1));
    service.cancel(); await done;
    expect(evaluate).toHaveBeenCalledTimes(7);
    expect(service.snapshot()).toMatchObject({ status: 'cancelled', processed: 1, cancelled: 11, forecasts: 3, tokens: 120 });
    expect(service.snapshot()!.items[0].decision).toEqual(result().decision);
  });

  it.each([401, 402, 403, 404, 429])('stops dispatch after HTTP %s while preserving actual results from already-running calls', async (status) => {
    const waiting = Array.from({ length: 6 }, () => deferred<ReturnType<typeof result>>());
    let index = 0;
    const evaluate = vi.fn<typeof evaluateWithJev>(async () => waiting[index++].promise);
    const service = createBurstService({ configuration, corpus: corpus(), evaluate });
    const { done } = service.start(profile);
    waiting[0].reject({ cause: { status, message: 'Bearer secret-must-not-persist' } });
    await vi.waitFor(() => expect(service.snapshot()!.skipped).toBe(6));
    expect(service.snapshot()).toMatchObject({ errors: 1, active: 5, queued: 0 });
    for (const request of waiting.slice(1)) request.resolve(result());
    await done;
    expect(evaluate).toHaveBeenCalledTimes(6);
    expect(service.snapshot()).toMatchObject({ status: 'failed', processed: 5, errors: 1, skipped: 6, forecasts: 15, tokens: 600 });
    expect(JSON.stringify(service.snapshot())).not.toContain('secret-must-not-persist');
    expect(service.snapshot()!.stopReason).toContain(`HTTP ${status}`);
  });

  it('records a timeout as a failure and keeps processing independent briefs without inventing a forecast', async () => {
    const evaluate = vi.fn<typeof evaluateWithJev>(async (item) => {
      if (item.id === 'burst-0') throw new DOMException('secret', 'TimeoutError');
      return result();
    });
    const service = createBurstService({ configuration, corpus: corpus(8), evaluate });
    await service.start(profile).done;
    expect(evaluate).toHaveBeenCalledTimes(8);
    expect(service.snapshot()).toMatchObject({ status: 'failed', total: 8, processed: 7, errors: 1, forecasts: 21, tokens: 840 });
    expect(service.snapshot()!.items[0]).toMatchObject({ decision: null, score: null, tokens: 0, status: 'error' });
    expect(JSON.stringify(service.snapshot())).not.toContain('secret');
  });

  it('limits corpus size and rejects missing or unlabeled editorial inputs', () => {
    expect(() => createBurstService({ configuration, corpus: corpus(49) })).toThrow('1–48');
    expect(() => createBurstService({ configuration, corpus: [] })).toThrow('1–48');
    expect(() => createBurstService({ configuration, corpus: [corpus(1)[0], corpus(1)[0]] })).toThrow('uniquely');
    expect(() => createBurstService({ configuration, corpus: [{ ...corpus(1)[0], analysis: null }] })).toThrow('editorial');
    expect(() => createBurstService({ configuration, corpus: [{ ...corpus(1)[0], provenance: 'url-extraction' }] })).toThrow('editorial');
  });

  it('restarts with fresh counters and does not reuse an earlier profile decision', async () => {
    const evaluate = vi.fn<typeof evaluateWithJev>(async (_item, _analysis, supplied) => result(supplied.version));
    const service = createBurstService({ configuration, corpus: corpus(2), evaluate });
    const first = service.start(profile); await first.done;
    const next = service.start({ ...profile, goal: 'Build a design tool', version: 6 }); await next.done;
    expect(next.job.id).not.toBe(first.job.id);
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(service.snapshot()).toMatchObject({ processed: 2, tokens: 240, forecasts: 6, profile: { version: 6 } });
    expect(service.snapshot()!.items.every(item => item.decision!.profileVersion === 6)).toBe(true);
  });
});

describe('safe local screening checkpoints', () => {
  it('persists actual completed results and reloads them without inference or credentials', async () => {
    const persistencePath = checkpoint();
    const evaluate = vi.fn<typeof evaluateWithJev>(async () => result());
    const service = createBurstService({ configuration, corpus: corpus(2), evaluate, persistencePath });
    await service.start(profile).done;
    const expected = service.snapshot();
    const raw = readFileSync(persistencePath, 'utf8');
    expect(raw).not.toContain(configuration().apiKey); expect(raw).not.toContain('apiKey');
    const restored = createBurstService({ configuration, corpus: corpus(2), evaluate, persistencePath });
    expect(restored.snapshot()).toEqual(expected); expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('marks interrupted work failed instead of replaying a fabricated completion', async () => {
    const persistencePath = checkpoint();
    const pending = deferred<ReturnType<typeof result>>();
    const service = createBurstService({ configuration, corpus: corpus(1), evaluate: async () => pending.promise, persistencePath });
    const { done } = service.start(profile);
    const restored = createBurstService({ configuration, corpus: corpus(1), persistencePath });
    expect(restored.snapshot()).toMatchObject({ status: 'failed', processed: 0, forecasts: 0, skipped: 1 });
    expect(restored.snapshot()!.stopReason).toContain('restarted');
    pending.resolve(result()); await done;
  });

  it('ignores corrupt, incompatible and invalid-decision checkpoints', async () => {
    const persistencePath = checkpoint();
    writeFileSync(persistencePath, '{broken');
    expect(createBurstService({ configuration, corpus: corpus(1), persistencePath }).snapshot()).toBeNull();
    const service = createBurstService({ configuration, corpus: corpus(1), evaluate: async () => result(), persistencePath });
    await service.start(profile).done;
    expect(createBurstService({ configuration, corpus: corpus(2), persistencePath }).snapshot()).toBeNull();
    const changed = corpus(1); changed[0].text = 'A revised editorial brief with different evidence.';
    expect(createBurstService({ configuration, corpus: changed, persistencePath }).snapshot()).toBeNull();
    const content = JSON.parse(readFileSync(persistencePath, 'utf8'));
    content.job.items[0].decision.relevance = 99;
    writeFileSync(persistencePath, JSON.stringify(content));
    expect(createBurstService({ configuration, corpus: corpus(1), persistencePath }).snapshot()).toBeNull();
  });

  it('reports a checkpoint failure without losing a completed real decision', async () => {
    const persistencePath = checkpoint(); writeFileSync(persistencePath, 'file blocks child directory');
    const service = createBurstService({ configuration, corpus: corpus(1), evaluate: async () => result(), persistencePath: join(persistencePath, 'child.json') });
    await service.start(profile).done;
    expect(service.snapshot()).toMatchObject({ status: 'completed', processed: 1 });
    expect(service.snapshot()!.persistenceError).toContain('could not be saved');
  });
});
