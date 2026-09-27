import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis, ContentItem, Profile, TraceEvent } from '../src/domain/types.ts';

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  evaluate: vi.fn(),
  credentials: {
    gatewayKey: 'mock-gateway-key',
    jevKey: 'mock-typesafe-key',
    jevProvider: 'typesafe' as 'typesafe' | 'openrouter',
    llmModel: 'mock/extraction-model',
    jevModel: 'jev-1.13.0',
  },
}));

vi.mock('./harness.ts', () => ({ analyzeSource: mocks.analyze }));
vi.mock('./jev.ts', () => ({ evaluateWithJev: mocks.evaluate }));
vi.mock('./config.ts', () => ({
  config: () => ({ ...mocks.credentials }),
  // Every store below is explicitly in-memory; this path is never opened.
  demoRoot: '/tmp/valuerank-pipeline-test-unused-root',
}));

import { createStore, type Store } from './store.ts';
import { startPipeline } from './pipeline.ts';
import { editProfile } from './service.ts';
import { rankItems } from '../src/domain/ranking.ts';

const stores: Store[] = [];
const makeItem = (index: number): ContentItem => ({
  id: `item-${index}`, title: `Ranking study ${index}`, url: `https://example.com/study-${index}`,
  publisher: 'Test source', kind: 'article',
  text: `Compare pairs of lessons to gather preference labels. This is source number ${index}.`,
  addedAt: '2026-09-26T00:00:00.000Z', provenance: 'user-paste', analysis: null, decision: null,
  feedback: null, status: 'unprocessed', error: null,
});
const makeAnalysis = (item: ContentItem): Analysis => ({
  summary: `Source ${item.id} describes gathering pairwise preference labels.`,
  concepts: ['pairwise preference labels', 'relative ranking'], topics: ['ranking'],
  evidence: [{ quote: 'Compare pairs of lessons to gather preference labels.', insight: 'Collect comparisons before fitting a ranker.' }],
  readingMinutes: 2, source: 'llm', model: mocks.credentials.llmModel,
});
const makeResult = (profile: Profile) => ({
  decision: {
    relevance: 0.91, novelty: 0.72, actionability: 0.84,
    source: 'jev' as const, model: mocks.credentials.jevModel,
    profileVersion: profile.version, createdAt: '2026-09-26T01:00:00.000Z',
  },
  tokens: 500,
});
const makeStore = (count: number) => {
  const store = createStore(':memory:');
  stores.push(store);
  store.update(state => { state.items = Array.from({ length: count }, (_, index) => makeItem(index + 1)); });
  return store;
};
const llmEvent = (item: ContentItem, status: TraceEvent['status']): TraceEvent => ({
  id: `llm-${item.id}`, itemId: item.id, stage: 'llm', title: 'Mock source extraction',
  detail: 'Mocked model output; no external request.', status, at: '2026-09-26T01:00:00.000Z',
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  mocks.analyze.mockReset();
  mocks.evaluate.mockReset();
  mocks.credentials.gatewayKey = 'mock-gateway-key';
  mocks.credentials.jevKey = 'mock-typesafe-key';
  mocks.credentials.jevProvider = 'typesafe';
  mocks.credentials.jevModel = 'jev-1.13.0';
  mocks.analyze.mockImplementation(async (item: ContentItem, _settings: unknown, emit: (event: TraceEvent) => void) => {
    emit(llmEvent(item, 'running'));
    await Promise.resolve();
    emit(llmEvent(item, 'completed'));
    return makeAnalysis(item);
  });
  mocks.evaluate.mockImplementation(async (_item: ContentItem, _analysis: Analysis, profile: Profile) => makeResult(profile));
});
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

describe('bounded inference pipeline with an in-memory SQLite store', () => {
  it('limits a run to eight items and evaluates candidates one at a time', async () => {
    const store = makeStore(12);
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;
    const step = async (label: string) => {
      order.push(label);
      active++;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active--;
    };
    mocks.analyze.mockImplementation(async (item: ContentItem) => {
      await step(`llm:${item.id}`);
      return makeAnalysis(item);
    });
    mocks.evaluate.mockImplementation(async (item: ContentItem, _analysis: Analysis, profile: Profile) => {
      await step(`jev:${item.id}`);
      return makeResult(profile);
    });

    const { done } = startPipeline(store);
    await done;
    expect(mocks.analyze).toHaveBeenCalledTimes(8);
    expect(mocks.evaluate).toHaveBeenCalledTimes(8);
    expect(maximumActive).toBe(1);
    expect(order).toEqual(Array.from({ length: 8 }, (_, i) => [`llm:item-${i + 1}`, `jev:item-${i + 1}`]).flat());
    const saved = store.get();
    expect(saved.run).toMatchObject({ status: 'completed', processed: 8, total: 8, errors: 0 });
    expect(saved.items.slice(0, 8).every(item => item.status === 'ready' && item.decision?.source === 'jev')).toBe(true);
    expect(saved.items.slice(8).every(item => item.status === 'unprocessed' && item.decision === null)).toBe(true);
  });

  it('rejects a duplicate concurrent run before any second model call', async () => {
    const store = makeStore(1);
    const gate = deferred();
    mocks.analyze.mockImplementation(async (item: ContentItem) => {
      await gate.promise;
      return makeAnalysis(item);
    });
    const first = startPipeline(store);
    expect(store.get().run?.status).toBe('running');
    expect(() => startPipeline(store)).toThrow('already in progress');
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first.done;
    expect(store.get().run?.status).toBe('completed');
  });

  it('persists validated Jev decisions and trace metadata, then reuses cached LLM notes', async () => {
    const store = makeStore(2);
    const profile = store.get().profile;
    await startPipeline(store, ['item-2']).done;
    let saved = store.get();
    expect(saved.items[0].analysis).toBeNull();
    expect(saved.items[1].analysis).toEqual(makeAnalysis(saved.items[1]));
    expect(saved.items[1].decision).toEqual(makeResult(profile).decision);
    expect(saved.run).toMatchObject({ status: 'completed', total: 1, processed: 1, errors: 0 });
    expect(saved.run?.finishedAt).toEqual(expect.any(String));
    expect(saved.run?.events.find(event => event.stage === 'jev')).toMatchObject({
      itemId: 'item-2', status: 'completed', tokens: 500, model: 'jev-1.13.0',
    });
    expect(saved.run?.events.some(event => event.stage === 'rank' && event.status === 'completed')).toBe(true);
    expect(saved.run?.events.some(event => event.status === 'running')).toBe(false);

    await startPipeline(store, ['item-2']).done;
    saved = store.get();
    expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(mocks.evaluate).toHaveBeenCalledTimes(2);
    expect(saved.run?.events.find(event => event.title === 'Using saved reading notes')).toMatchObject({ tokens: 0, status: 'completed', itemId: 'item-2' });
    expect(saved.items[1].decision?.source).toBe('jev');
  });

  it.each(['llm', 'jev'] as const)('stops after a %s failure, preserves completed results, and sanitizes errors', async (stage) => {
    const store = makeStore(3);
    const sensitiveError = 'provider body with SECRET-DO-NOT-PERSIST';
    if (stage === 'llm') {
      mocks.analyze.mockImplementation(async (item: ContentItem, _settings: unknown, emit: (event: TraceEvent) => void) => {
        emit(llmEvent(item, 'running'));
        if (item.id === 'item-2') throw new Error(sensitiveError);
        emit(llmEvent(item, 'completed'));
        return makeAnalysis(item);
      });
    } else {
      mocks.evaluate.mockImplementation(async (item: ContentItem, _analysis: Analysis, profile: Profile) => {
        if (item.id === 'item-2') throw new Error(sensitiveError);
        return makeResult(profile);
      });
    }

    await startPipeline(store).done;
    const saved = store.get();
    expect(saved.run).toMatchObject({ status: 'failed', processed: 1, total: 3, errors: 1 });
    expect(saved.items[0]).toMatchObject({ status: 'ready', error: null, decision: { source: 'jev', model: 'jev-1.13.0' } });
    expect(saved.items[1]).toMatchObject({ status: 'error', decision: null });
    expect(saved.items[2]).toMatchObject({ status: 'unprocessed', analysis: null, decision: null });
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    expect(mocks.evaluate).toHaveBeenCalledTimes(stage === 'jev' ? 2 : 1);
    expect(saved.run?.events.some(event => event.itemId === 'item-2' && event.stage === stage && event.status === 'failed')).toBe(true);
    expect(saved.run?.events.some(event => event.status === 'running')).toBe(false);
    expect(JSON.stringify(saved)).not.toContain('SECRET-DO-NOT-PERSIST');
  });

  it('keeps the original profile snapshot when the user changes goals mid-run, making the result stale', async () => {
    const store = makeStore(1);
    const original = structuredClone(store.get().profile);
    const entered = deferred();
    const release = deferred();
    mocks.evaluate.mockImplementation(async (_item: ContentItem, _analysis: Analysis, profile: Profile) => {
      entered.resolve();
      await release.promise;
      expect(profile).toEqual(original);
      return makeResult(profile);
    });
    const { done } = startPipeline(store);
    await entered.promise;
    editProfile(store, { goal: 'Study accessible typography and visual hierarchy' });
    expect(store.get().profile.version).toBeGreaterThan(original.version);
    release.resolve();
    await done;
    const saved = store.get();
    expect(saved.items[0].decision?.profileVersion).toBe(original.version);
    expect(saved.profile.goal).toContain('typography');
    expect(rankItems(saved.items, saved.profile)[0].scoreSource).toBe('stale-jev');
    expect(saved.run?.status).toBe('completed');
  });

  it('requires both provider credentials before starting a run', () => {
    const store = makeStore(1);
    mocks.credentials.jevKey = '';
    expect(() => startPipeline(store)).toThrow('TYPESAFE_API_KEY');
    expect(store.get().run).toBeNull();
    expect(mocks.analyze).not.toHaveBeenCalled();
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it('routes Jev through the configured OpenRouter key and records that route', async () => {
    const store = makeStore(1);
    mocks.credentials.jevKey = 'mock-openrouter-key';
    mocks.credentials.jevProvider = 'openrouter';
    mocks.credentials.jevModel = 'typesafe/jev-1.13';
    await startPipeline(store).done;
    expect(mocks.evaluate).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), {
      apiKey: 'mock-openrouter-key', model: 'typesafe/jev-1.13', provider: 'openrouter',
    });
    expect(store.get().run?.events.find(event => event.stage === 'jev')?.detail).toContain('Via OpenRouter');
    expect(JSON.stringify(store.get())).not.toContain('mock-openrouter-key');
  });
});
