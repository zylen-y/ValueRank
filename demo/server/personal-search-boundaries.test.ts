import { describe, expect, it, vi } from 'vitest';
import type { PersonalSearchSession, PersonalSource } from '../src/domain/personal.ts';
import type { evaluateWithJev } from './jev.ts';
import { explicitSearchDomains, type generateSearchJson, type retrievePersonalSources } from './personal-search-adapter.ts';
import { createPersonalSearchService, type PersonalSearchStore } from './personal-search.ts';
import { CostBudget, CostBudgetError } from './cost-budget.ts';
import type { VerifySourceSupport } from './source-support.ts';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService } from './personal-service.ts';

const source: PersonalSource = {
  id: 'scope-source', version: 1, url: 'https://docs.example.com/memory', title: 'Memory documentation', publisher: 'docs.example.com',
  text: 'The local memory component stores records in SQLite. Applications can delete a stored record by its identifier.',
  retrievedAt: '2026-09-27T00:00:00.000Z', provenance: 'search-excerpt',
};
const plan = { options: [], facets: [{ id: 'implementation', label: 'Implementation details' }], queries: ['local memory implementation documentation', 'local memory deletion documentation'] };
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const retrieval = () => ({ sources: [structuredClone(source)], tokens: 20, durationMs: 1, model: 'mock/search', calls: 1 });
function fixture(overrides: Partial<Parameters<typeof createPersonalSearchService>[0]> = {}) {
  const sessions = new Map<string, PersonalSearchSession>();
  const store: PersonalSearchStore = {
    saveSession: session => sessions.set(session.id, structuredClone(session)), getSession: id => structuredClone(sessions.get(id)), listSessions: () => [...sessions.values()].map(session => structuredClone(session)),
    saveSource: vi.fn(), getFacts: () => [],
    rank: units => units.map(unit => ({ ...unit, score: .8, personalAdjustment: 0, modelVersion: 0, knownConcepts: [] })),
  };
  const generate = vi.fn(async (schema, instructions, data) => {
    let value: unknown;
    if (instructions.startsWith('Ask')) value = { researchPlan: plan, questions: [] };
    else if (instructions.includes('Create 2-4')) {
      const group = data as { sources: { id: string; passages: { id: string }[] }[] };
      value = { units: [{ title: 'Local memory supports record deletion', body: 'The documented component stores records in SQLite and permits deleting a record by its identifier.', kind: 'method', evidence: [{ sourceId: group.sources[0].id, passageId: group.sources[0].passages[0].id }], optionIds: [], facetIds: ['implementation'], concepts: ['Record deletion'], limitations: ['The passage does not measure deletion latency.'], effortMinutes: 2, depth: .7, evidenceStrength: .7, topics: ['agents'] }] };
    } else {
      const cards = (data as { cards: { id: string }[] }).cards;
      value = { optionAssessments: [], paragraphs: [{ text: 'Inspect the documented deletion operation before choosing the memory component.', unitIds: [cards[0].id] }], followUp: null };
    }
    return { value: schema.parse(value), tokens: 100, durationMs: 1, model: 'mock/model' };
  }) as unknown as typeof generateSearchJson;
  const evaluate = vi.fn(async () => ({ decision: { relevance: .9, novelty: .8, actionability: .7, source: 'jev', provider: 'openrouter', model: 'mock/jev', profileVersion: 1, createdAt: source.retrievedAt }, support: .9, tokens: 50 })) as unknown as typeof evaluateWithJev;
  const retrieve = vi.fn(async () => retrieval());
  const service = createPersonalSearchService({ store, configuration: () => ({ gatewayKey: 'mock', llmModel: 'mock/model', jevKey: 'mock', jevModel: 'mock/jev', jevProvider: 'openrouter' }), profile: () => ({ goal: 'Build a useful app', knownConcepts: [], interests: { agents: .5, ranking: .5, rl: .5, web: .5, language: .5, design: .5 }, feedbackCount: 0, version: 1 }), generate, evaluate, retrieve, ...overrides });
  return { service, sessions, store, generate, evaluate, retrieve };
}

const support = () => ({ score: .9, model: 'mock/jev', tokens: 10, durationMs: 1, checkedAt: source.retrievedAt, version: 'test' });
function threeParagraphs(standard: typeof generateSearchJson): typeof generateSearchJson {
  return (async (...args: Parameters<typeof generateSearchJson>) => {
    if (!args[1].includes('Assemble')) return standard(...args);
    const cards = (args[2] as { cards: { id: string }[] }).cards;
    return { value: args[0].parse({ optionAssessments: [], paragraphs: Array.from({ length: 3 }, (_, index) => ({ text: `Inspect documented operation ${index + 1} before choosing a memory component.`, unitIds: [cards[0].id] })), followUp: null }), tokens: 100, durationMs: 1, model: 'mock/model' };
  }) as typeof generateSearchJson;
}

describe('personal search request boundaries', () => {
  it('publishes a ranked batch while another source batch is still grounding', async () => {
    const standard = fixture(); const lateBatch = deferred<void>(); const firstRank = deferred<void>();
    const sources = Array.from({ length: 4 }, (_, index) => ({ ...source, id: `progress-${index}`, url: `https://docs.example.com/memory/${index}` }));
    let groups = 0;
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4') && ++groups === 2) await lateBatch.promise;
      return standard.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const { service, sessions, store } = fixture({ generate, retrieve: async () => ({ ...retrieval(), sources }) });
    const rank = store.rank; store.rank = (units, context) => { const result = rank(units, context); if (units.length) firstRank.resolve(); return result; };
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await firstRank.promise;
    expect(service.isRunning()).toBe(true);
    expect(sessions.get(started.id)?.units).toHaveLength(1);
    expect(sessions.get(started.id)?.events.some(event => event.stage === 'rank' && event.completed === 1)).toBe(true);
    expect(sessions.get(started.id)?.answer).toBe('');
    lateBatch.resolve(); await service.waitForIdle();
    expect(sessions.get(started.id)?.units).toHaveLength(2);
    expect(sessions.get(started.id)?.answer).not.toBe('');
    expect(sessions.get(started.id)?.status).toBe('completed');
  });

  it('counts both concurrent successful screening batches before choosing the final status', async () => {
    const standard = fixture(); const release = deferred<void>(); const bothEntered = deferred<void>();
    const sources = Array.from({ length: 4 }, (_, index) => ({ ...source, id: `overlap-${index}`, url: `https://docs.example.com/memory/${index}` }));
    let checks = 0;
    const evaluate: typeof evaluateWithJev = async (...args) => { if (++checks === 2) bothEntered.resolve(); await release.promise; return standard.evaluate(...args); };
    const { service, sessions } = fixture({ evaluate, verifySynthesis: async () => support(), retrieve: async () => ({ ...retrieval(), sources }) });
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await bothEntered.promise; release.resolve(); await service.waitForIdle();
    expect(checks).toBe(2); expect(sessions.get(started.id)?.units).toHaveLength(2);
    expect(sessions.get(started.id)?.status).toBe('completed'); expect(sessions.get(started.id)?.error).toBeUndefined();
  });

  it('releases the operation lock and exposes an honest transient failure when terminal storage stays unavailable', async () => {
    const { service, store, sessions, evaluate } = fixture();
    const save = store.saveSession.bind(store); let storageUnavailable = false;
    vi.spyOn(store, 'saveSession').mockImplementation(session => {
      if (session.status === 'grounding') storageUnavailable = true;
      if (storageUnavailable) throw new Error('Disk unavailable');
      return save(session);
    });
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await expect(service.waitForIdle()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(false); expect(evaluate).not.toHaveBeenCalled();
    expect(sessions.get(started.id)?.status).toBe('searching');
    expect(service.getSession(started.id)).toMatchObject({ status: 'failed', answer: '', error: expect.stringContaining('could not be saved locally') });
    expect(service.listSessions()[0].error).toContain('only until the server restarts');
    expect(service.getSession(started.id)?.sources).toEqual(sessions.get(started.id)?.sources);
    expect(() => service.start('Try another question')).toThrow('checkpoint');
    // Removing the storage fault permits an explicit retry and replaces the overlay.
    vi.mocked(store.saveSession).mockImplementation(save);
    service.retry(started.id); await service.waitForIdle();
    expect(service.getSession(started.id)?.status).toBe('completed'); expect(service.isRunning()).toBe(false);
    expect(service.getSession(started.id)?.error).toBeUndefined();
  });

  it('retries a scored-card checkpoint failure without an orphaned immutable version blocking recovery', async () => {
    const database = createPersonalStore(':memory:');
    try {
      const personal = createPersonalService(database);
      let unavailable = false;
      const save = personal.saveSession;
      const { service, evaluate, generate, retrieve } = fixture({ store: personal, verifySynthesis: async () => support() });
      vi.spyOn(personal, 'saveSession').mockImplementation(session => {
        if (session.units.length) unavailable = true;
        if (unavailable) throw new Error('Synthetic disk failure after card scoring');
        return save(session);
      });
      const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id); await service.waitForIdle();
      expect(service.isRunning()).toBe(false); expect(service.getSession(started.id)?.status).toBe('failed');
      expect(personal.getSession(started.id)?.pendingUnits).toHaveLength(1);
      expect(personal.exportData().units).toHaveLength(0);
      const originalSources = personal.exportData().sources;
      const retrievals = vi.mocked(retrieve).mock.calls.length;
      const groundings = vi.mocked(generate).mock.calls.filter(call => call[1].includes('Create 2-4')).length;
      // A new score and timestamp must be able to commit the same previously
      // uncommitted draft; no old immutable unit is rewritten.
      vi.mocked(personal.saveSession).mockImplementation(save);
      vi.mocked(evaluate).mockResolvedValueOnce({ decision: { relevance: .7, novelty: .6, actionability: .5, source: 'jev', provider: 'openrouter', model: 'mock/jev', profileVersion: 2, createdAt: source.retrievedAt }, support: .85, tokens: 50 });
      service.retry(started.id); await service.waitForIdle();
      expect(service.getSession(started.id)?.status).toBe('completed');
      expect(personal.exportData().units).toHaveLength(1); expect(personal.exportData().units[0].features.values[0]).toBe(.7);
      expect(personal.exportData().sources).toEqual(originalSources);
      expect(vi.mocked(retrieve).mock.calls).toHaveLength(retrievals);
      expect(vi.mocked(generate).mock.calls.filter(call => call[1].includes('Create 2-4'))).toHaveLength(groundings);
    } finally { database.close(); }
  });

  it('awaits the late grounding worker after checkpoint failure and never publishes its late card', async () => {
    const standard = fixture(); const late = deferred<void>(); const entered = deferred<void>(); const halted = deferred<void>();
    const sources = Array.from({ length: 4 }, (_, index) => ({ ...source, id: `write-${index}`, url: `https://docs.example.com/memory/${index}` }));
    let groups = 0;
    const generate: typeof generateSearchJson = async (...args) => {
      if (args[1].includes('Create 2-4') && ++groups === 2) { args[4]!.addEventListener('abort', () => halted.resolve(), { once: true }); entered.resolve(); await late.promise; }
      return standard.generate(...args);
    };
    const { service, store, sessions, evaluate } = fixture({ generate, retrieve: async () => ({ ...retrieval(), sources }) });
    const save = store.saveSession.bind(store); let failed = false;
    vi.spyOn(store, 'saveSession').mockImplementation(session => {
      if (!failed && session.events.at(-1)?.stage === 'evidence') { failed = true; throw new Error('Checkpoint unavailable'); }
      return save(session);
    });
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await entered.promise; await halted.promise;
    expect(service.isRunning()).toBe(true); expect(() => service.start('Overlap')).toThrow('already running');
    late.resolve(); await expect(service.waitForIdle()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(false); expect(evaluate).not.toHaveBeenCalled();
    expect(sessions.get(started.id)).toMatchObject({ status: 'failed', units: [], answer: '' });
    expect(sessions.get(started.id)?.pendingUnits).toHaveLength(1);
    expect(sessions.get(started.id)?.error).toContain('checkpoint could not be saved');
    const writes = vi.mocked(store.saveSession).mock.calls.length;
    await Promise.resolve(); expect(vi.mocked(store.saveSession).mock.calls).toHaveLength(writes);
  });

  it('recognizes a generation adapter wrapping an attempt checkpoint failure and stops additional batches', async () => {
    const standard = fixture(); const late = deferred<void>(); const entered = deferred<void>(); const halted = deferred<void>();
    const sources = Array.from({ length: 6 }, (_, index) => ({ ...source, id: `wrapped-${index}`, url: `https://docs.example.com/memory/${index}` }));
    let groups = 0;
    const generate: typeof generateSearchJson = async (...args) => {
      if (args[1].includes('Create 2-4')) {
        const group = ++groups;
        if (group === 1) {
          await entered.promise;
          try { args[5]?.({ phase: 'completed', attempt: 1, tokens: 0, durationMs: 1, model: 'mock/model' }); }
          catch (error) { throw new Error('Structured generation failed.', { cause: error }); }
        } else {
          args[4]!.addEventListener('abort', () => halted.resolve(), { once: true }); entered.resolve(); await late.promise;
        }
      }
      return standard.generate(...args);
    };
    const { service, store, sessions, evaluate } = fixture({ generate, retrieve: async () => ({ ...retrieval(), sources }) });
    const save = store.saveSession.bind(store); let failed = false;
    vi.spyOn(store, 'saveSession').mockImplementation(session => {
      if (!failed && session.events.at(-1)?.stage === 'llm-attempt') { failed = true; throw new Error('Local checkpoint unavailable'); }
      return save(session);
    });
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await halted.promise; expect(service.isRunning()).toBe(true);
    late.resolve(); await service.waitForIdle();
    expect(groups).toBe(2); expect(evaluate).not.toHaveBeenCalled(); expect(service.isRunning()).toBe(false);
    expect(sessions.get(started.id)?.error).toContain('checkpoint could not be saved');
    expect(sessions.get(started.id)?.status).toBe('failed');
  });

  it('aborts queued card requests across both batches while the shared budget keeps at most two transports active', async () => {
    const standard = fixture(); const allQueued = deferred<void>(); const lateTransport = deferred<void>(); const halted = deferred<void>();
    const now = Date.now();
    const budget = new CostBudget(':memory:', { id: 'synthetic-search-boundary', enabled: true, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 });
    const sources = Array.from({ length: 4 }, (_, index) => ({ ...source, id: `queue-${index}`, url: `https://docs.example.com/memory/${index}` }));
    const generate: typeof generateSearchJson = async (...args) => {
      const result = await standard.generate(...args);
      if (!args[1].includes('Create 2-4')) return result;
      const card = (result.value as { units: Record<string, unknown>[] }).units[0];
      return { ...result, value: args[0].parse({ units: Array.from({ length: 4 }, (_, index) => ({ ...card, title: `${card.title} ${index}` })) }) };
    };
    let invocations = 0; let transports = 0; let peak = 0;
    const evaluate: typeof evaluateWithJev = async (...args) => {
      if (++invocations === 8) allQueued.resolve();
      const signal = args[4]!;
      signal.addEventListener('abort', () => halted.resolve(), { once: true });
      return budget.run({ provider: 'openrouter', model: 'typesafe/jev-1.13', operation: 'synthetic-boundary', input: 'Synthetic fixture only', maxOutputTokens: 1 }, async () => {
        const transport = ++transports; peak = Math.max(peak, budget.snapshot().active);
        await allQueued.promise;
        if (transport === 1) throw Object.assign(new Error('Synthetic credits failure'), { status: 402 });
        await lateTransport.promise;
        return { value: await standard.evaluate(...args), usage: { inputTokens: 1, outputTokens: 0, costUsd: 0 } };
      }, { signal });
    };
    const { service, sessions } = fixture({ evaluate, generate, retrieve: async () => ({ ...retrieval(), sources }), verifySynthesis: async () => support() });
    try {
      const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
      await halted.promise;
      expect(invocations).toBe(8); expect(transports).toBe(2); expect(peak).toBe(2); expect(service.isRunning()).toBe(true);
      lateTransport.resolve(); await service.waitForIdle();
      expect(transports).toBe(2); expect(budget.snapshot().active).toBe(0); expect(service.isRunning()).toBe(false);
      expect(sessions.get(started.id)).toMatchObject({ status: 'failed', units: [], answer: '' });
      expect(sessions.get(started.id)?.pendingUnits).toHaveLength(8);
    } finally { lateTransport.resolve(); await service.waitForIdle(); budget.close(); }
  });

  it('preserves an early ranked batch when a later grounding batch is cancelled', async () => {
    const standard = fixture(); const lateBatch = deferred<void>(); const firstRank = deferred<void>();
    const sources = Array.from({ length: 4 }, (_, index) => ({ ...source, id: `cancel-progress-${index}`, url: `https://docs.example.com/memory/${index}` }));
    let groups = 0;
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4') && ++groups === 2) await lateBatch.promise;
      return standard.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const { service, sessions, store } = fixture({ generate, retrieve: async () => ({ ...retrieval(), sources }) });
    const rank = store.rank; store.rank = (units, context) => { const result = rank(units, context); if (units.length) firstRank.resolve(); return result; };
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await firstRank.promise; service.cancel(started.id);
    expect(service.isRunning()).toBe(true);
    lateBatch.resolve(); await service.waitForIdle();
    const done = sessions.get(started.id)!;
    expect(done.status).toBe('cancelled'); expect(done.units).toHaveLength(1); expect(done.pendingUnits).toHaveLength(0);
    expect(done.answer).toBe(''); expect(service.isRunning()).toBe(false);
  });

  it('halts new grounding and synthesis when progressive screening hits the budget boundary', async () => {
    const standard = fixture(); const lateBatch = deferred<void>(); const failedScreen = deferred<void>();
    const sources = Array.from({ length: 6 }, (_, index) => ({ ...source, id: `halt-progress-${index}`, url: `https://docs.example.com/memory/${index}` }));
    let groups = 0;
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4') && ++groups === 2) await lateBatch.promise;
      return standard.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const evaluate = vi.fn(async () => { failedScreen.resolve(); throw new CostBudgetError('operating-limit', 'No capacity remains.'); });
    const { service, sessions } = fixture({ generate, evaluate, retrieve: async () => ({ ...retrieval(), sources }) });
    const started = service.start('Compare local memory'); await service.waitForIdle(); service.continue(started.id);
    await failedScreen.promise; await Promise.resolve(); await Promise.resolve();
    lateBatch.resolve(); await service.waitForIdle();
    expect(groups).toBe(2); expect(evaluate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(generate).mock.calls.filter(call => call[1].includes('Assemble'))).toHaveLength(0);
    expect(sessions.get(started.id)?.pendingUnits).toHaveLength(1);
    expect(service.isRunning()).toBe(false);
  });

  it('retains explicit user source domains in every generated focused search', async () => {
    const standard = fixture();
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].startsWith('Ask')) return { value: args[0].parse({ researchPlan: { ...plan, queries: plan.queries.map(query => `${query} site:unrequested.example.org`) }, questions: [] }), tokens: 100, durationMs: 1, model: 'mock/model' };
      return standard.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const { service, retrieve } = fixture({ generate });
    const started = service.start('Compare memory implementations site:docs.example.com');
    await service.waitForIdle(); service.continue(started.id); await service.waitForIdle();
    expect(retrieve).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(retrieve as typeof retrievePersonalSources).mock.calls) expect(explicitSearchDomains(call[0])).toEqual(['docs.example.com']);
  });

  it('retains the new evidence gap independently of a long original query', async () => {
    const { service, retrieve } = fixture();
    const started = service.start(`Compare local memory. ${'Provide implementation context. '.repeat(14)}`.slice(0, 500));
    await service.waitForIdle(); service.continue(started.id); await service.waitForIdle();
    const gap = `${'More implementation detail. '.repeat(6)}Verify erase behavior after a process restart.`;
    service.refine(started.id, { instruction: gap, research: true }); await service.waitForIdle();
    const finalQuery = vi.mocked(retrieve as typeof retrievePersonalSources).mock.calls.at(-1)![0];
    expect(finalQuery).toContain('Verify erase behavior after a process restart.');
    expect(finalQuery.length).toBeLessThanOrEqual(2000);
  });

  it('resumes failed planning before grounding discovery-only evidence', async () => {
    const standard = fixture();
    let planningAttempts = 0;
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].startsWith('Ask') && ++planningAttempts === 1) throw new Error('Temporary planning failure');
      return standard.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const { service, sessions, retrieve, evaluate } = fixture({ generate });
    const started = service.start('Compare memory implementations'); await service.waitForIdle();
    expect(sessions.get(started.id)?.status).toBe('failed');
    expect(sessions.get(started.id)?.sources).toHaveLength(1);
    service.retry(started.id); await service.waitForIdle();
    expect(sessions.get(started.id)?.status).toBe('awaiting-clarification');
    expect(sessions.get(started.id)?.researchPlan).toEqual(plan);
    expect(sessions.get(started.id)?.units).toHaveLength(0);
    expect(planningAttempts).toBe(2); expect(retrieve).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('keeps a successful parallel search and waits for it after the other search fails', async () => {
    const pending = deferred<ReturnType<typeof retrieval>>();
    const entered = deferred<void>();
    let calls = 0;
    const retrieve = vi.fn(async () => {
      calls++;
      if (calls === 1) return retrieval();
      if (calls === 2) throw new Error('Temporary search failure');
      entered.resolve(); return pending.promise;
    });
    const { service, sessions } = fixture({ retrieve });
    const started = service.start('Compare local memory'); await service.waitForIdle();
    service.continue(started.id); await entered.promise;
    expect(service.isRunning()).toBe(true);
    expect(() => service.start('Overlapping search')).toThrow('already running');
    pending.resolve(retrieval()); await service.waitForIdle();
    expect(sessions.get(started.id)?.status).toBe('partial');
    expect(sessions.get(started.id)?.error).toContain('One planned search failed');
    expect(sessions.get(started.id)?.units).toHaveLength(1);
    expect(service.isRunning()).toBe(false);
  });

  it('keeps cancellation active until both focused transports settle and does not accept their late results', async () => {
    const pending = [deferred<ReturnType<typeof retrieval>>(), deferred<ReturnType<typeof retrieval>>()];
    const entered = deferred<void>();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const retrieve = vi.fn(async (_query: string, _count: number, _settings: unknown, signal?: AbortSignal) => {
      calls++;
      if (calls === 1) return retrieval();
      signals.push(signal!);
      if (calls === 3) entered.resolve();
      return pending[calls - 2].promise;
    });
    const { service, sessions, evaluate, generate } = fixture({ retrieve });
    const started = service.start('Compare local memory'); await service.waitForIdle();
    service.continue(started.id); await entered.promise; service.cancel(started.id);
    expect(signals).toHaveLength(2); expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(service.isRunning()).toBe(true);
    pending[0].resolve(retrieval()); await Promise.resolve();
    expect(service.isRunning()).toBe(true);
    pending[1].resolve(retrieval()); await service.waitForIdle();
    expect(sessions.get(started.id)?.status).toBe('cancelled');
    expect(sessions.get(started.id)?.units).toHaveLength(0);
    expect(generate).toHaveBeenCalledTimes(1); expect(evaluate).not.toHaveBeenCalled();
    expect(service.isRunning()).toBe(false);
  });

  it('waits for both cancelled grounding workers without accepting their late drafts or starting Jev', async () => {
    const standard = fixture();
    const pending = [deferred<void>(), deferred<void>()];
    const entered = deferred<void>();
    let groundCalls = 0;
    const signals: AbortSignal[] = [];
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4')) {
        const index = groundCalls++;
        signals.push(args[4]!);
        if (groundCalls === 2) entered.resolve();
        await pending[index].promise;
      }
      return standard.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const retrieve = vi.fn(async () => ({ ...retrieval(), sources: Array.from({ length: 4 }, (_, index) => ({ ...source, id: `source-${index}`, url: `https://docs.example.com/${index}` })) }));
    const { service, sessions, evaluate } = fixture({ retrieve, generate });
    const started = service.start('Compare memory implementations'); await service.waitForIdle();
    service.continue(started.id); await entered.promise; service.cancel(started.id);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    pending[0].resolve(); await Promise.resolve(); expect(service.isRunning()).toBe(true);
    pending[1].resolve(); await service.waitForIdle();
    const done = sessions.get(started.id)!;
    expect(done.status).toBe('cancelled'); expect(done.units).toHaveLength(0); expect(done.pendingUnits).toHaveLength(0);
    expect(evaluate).not.toHaveBeenCalled(); expect(service.isRunning()).toBe(false);
  });

  it.each(['authentication', 'budget'] as const)('stops scheduling synthesis checks on %s failure but waits for the in-flight peer', async kind => {
    const standard = fixture(); const pending = deferred<ReturnType<typeof support>>(); const entered = deferred<void>();
    const verifySynthesis = vi.fn<VerifySourceSupport>(async () => {
      if (verifySynthesis.mock.calls.length === 1) throw kind === 'budget' ? new CostBudgetError('exhausted', 'Stopped') : Object.assign(new Error('Stopped'), { status: 401 });
      entered.resolve(); return pending.promise;
    });
    const { service, sessions } = fixture({ generate: threeParagraphs(standard.generate), verifySynthesis });
    const started = service.start('Compare memory implementations'); await service.waitForIdle();
    service.continue(started.id); await entered.promise;
    expect(service.isRunning()).toBe(true); expect(verifySynthesis).toHaveBeenCalledTimes(2);
    pending.resolve(support()); await service.waitForIdle();
    const done = sessions.get(started.id)!;
    expect(verifySynthesis).toHaveBeenCalledTimes(2); expect(done.status).toBe('partial'); expect(done.answer).toBe('');
    expect(done.answerReview?.checks.map(check => check.status)).toEqual(['unavailable', 'unavailable', 'unavailable']);
    expect(done.answerReview?.status).toBe('needs-review'); expect(service.isRunning()).toBe(false);
  });

  it('halts synthesis checking after a checkpoint write fails while preserving the draft', async () => {
    const standard = fixture(); const pending = deferred<ReturnType<typeof support>>(); const entered = deferred<void>();
    const verifySynthesis = vi.fn<VerifySourceSupport>(async () => {
      if (verifySynthesis.mock.calls.length === 1) return support();
      entered.resolve(); return pending.promise;
    });
    const { service, sessions, store } = fixture({ generate: threeParagraphs(standard.generate), verifySynthesis });
    const save = store.saveSession.bind(store); let failed = false;
    vi.spyOn(store, 'saveSession').mockImplementation(session => {
      if (!failed && session.answerReview?.checks[0].status === 'matched') { failed = true; throw new Error('Checkpoint unavailable'); }
      save(session);
    });
    const started = service.start('Compare memory implementations'); await service.waitForIdle();
    service.continue(started.id); await entered.promise; expect(service.isRunning()).toBe(true);
    pending.resolve(support()); await service.waitForIdle();
    const done = sessions.get(started.id)!;
    expect(failed).toBe(true); expect(verifySynthesis).toHaveBeenCalledTimes(2);
    expect(done.answer).toBe(''); expect(done.answerReview?.draft).toContain('Inspect documented operation');
    expect(done.answerReview?.checks.map(check => check.status)).toEqual(['unavailable', 'unavailable', 'unavailable']);
  });

  it('rejects an invalid high synthesis score at the orchestration boundary', async () => {
    const verifySynthesis = vi.fn<VerifySourceSupport>(async () => ({ ...support(), score: Infinity }));
    const { service, sessions } = fixture({ verifySynthesis });
    const started = service.start('Compare memory implementations'); await service.waitForIdle(); service.continue(started.id); await service.waitForIdle();
    expect(sessions.get(started.id)?.answer).toBe('');
    expect(sessions.get(started.id)?.answerReview?.checks[0].status).toBe('unavailable');
  });

  it('checks the published option label together with its assessment', async () => {
    const standard = fixture(); const label = 'Guaranteed encrypted storage';
    const generate = (async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].startsWith('Ask')) return { value: args[0].parse({ researchPlan: { ...plan, options: [{ id: 'memory', label }] }, questions: [] }), tokens: 100, durationMs: 1, model: 'mock/model' };
      if (args[1].includes('Create 2-4')) {
        const generated = await standard.generate(...args); const value = generated.value as { units: Record<string, unknown>[] };
        return { ...generated, value: args[0].parse({ units: value.units.map(unit => ({ ...unit, optionIds: ['memory'] })) }) };
      }
      const cards = (args[2] as { cards: { id: string }[] }).cards;
      return { value: args[0].parse({ optionAssessments: [{ optionId: 'memory', text: 'The component stores records in SQLite.', unitIds: [cards[0].id] }], paragraphs: [{ text: 'Inspect the documented storage operation.', unitIds: [cards[0].id] }], followUp: null }), tokens: 100, durationMs: 1, model: 'mock/model' };
    }) as typeof generateSearchJson;
    const verifySynthesis = vi.fn<VerifySourceSupport>(async input => ({ ...support(), score: input.claim.includes(label) ? .1 : .9 }));
    const { service, sessions } = fixture({ generate, verifySynthesis });
    const started = service.start('Compare memory implementations'); await service.waitForIdle(); service.continue(started.id); await service.waitForIdle();
    const check = sessions.get(started.id)?.answerReview?.checks.find(item => item.id === 'option-memory');
    expect(check?.claim).toBe(`${label}: The component stores records in SQLite.`); expect(check?.status).toBe('flagged');
    expect(sessions.get(started.id)?.answer).toBe('');
  });
});
