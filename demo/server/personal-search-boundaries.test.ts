import { describe, expect, it, vi } from 'vitest';
import type { PersonalSearchSession, PersonalSource } from '../src/domain/personal.ts';
import type { evaluateWithJev } from './jev.ts';
import { explicitSearchDomains, type generateSearchJson, type retrievePersonalSources } from './personal-search-adapter.ts';
import { createPersonalSearchService, type PersonalSearchStore } from './personal-search.ts';
import { CostBudgetError } from './cost-budget.ts';
import type { VerifySourceSupport } from './source-support.ts';

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
    saveSource: vi.fn(), saveUnit: vi.fn(), getFacts: () => [],
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
    expect(done.answerReview?.checks.map(check => check.status)).toEqual(['unavailable', 'matched', 'unavailable']);
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
    expect(done.answerReview?.checks.map(check => check.status)).toEqual(['unavailable', 'matched', 'unavailable']);
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
