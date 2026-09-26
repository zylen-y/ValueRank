import { describe, expect, it, vi } from 'vitest';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService } from './personal-service.ts';
import { createPersonalSearchService, selectSynthesisUnits, groundedUnitsSchema, resolveGroundedCard, sourcePassages, validateGroundedUnits, type PersonalSearchStore } from './personal-search.ts';
import { explicitSearchDomains, matchesSearchDomains, sourceRegistry, type generateSearchJson } from './personal-search-adapter.ts';
import type { PersonalSearchSession, PersonalSource, PersonalUnit } from '../src/domain/personal.ts';
import type { evaluateWithJev } from './jev.ts';

const quote = 'Jev uses the same model weights for every account and can create downstream ranking features.';
const source: PersonalSource = { id: 's1', version: 1, url: 'https://example.org/docs', title: 'Source', publisher: 'example.org', text: quote, retrievedAt: '2026-09-26T00:00:00.000Z', provenance: 'search-excerpt' };
const card = { title: 'Personalize a downstream ranker', body: 'Use Jev probability judgments as features for a separate personal ranking model.', kind: 'method' as const, evidence: [{ sourceId: 's1', quote }], concepts: ['Personal ranking'], limitations: ['The excerpt describes an approach, not measured performance.'], effortMinutes: 2, depth: 0.8, evidenceStrength: 0.7, topics: ['ranking' as const] };
const profile = { goal: 'Build a personal content engine.', knownConcepts: [], interests: { agents: .5, ranking: .5, rl: .5, web: .5, language: .5, design: .5 }, feedbackCount: 0, version: 1 };
const settings = { gatewayKey: 'mock-key', llmModel: 'mock/model', jevKey: 'mock-key', jevModel: 'typesafe/jev-1.13', jevProvider: 'openrouter' as const };
function setup(extra: Partial<Parameters<typeof createPersonalSearchService>[0]> = {}) {
  const sessions = new Map<string, PersonalSearchSession>();
  const units: PersonalUnit[] = [];
  const store: PersonalSearchStore = {
    saveSession: session => sessions.set(session.id, structuredClone(session)), getSession: id => structuredClone(sessions.get(id)), listSessions: () => [...sessions.values()].map(session => structuredClone(session)),
    saveSource: vi.fn(), saveUnit: unit => units.push(structuredClone(unit)), getFacts: () => [],
    rank: value => value.map(unit => ({ ...unit, score: .8, personalAdjustment: 0, modelVersion: 0, knownConcepts: [] })),
  };
  const generate = vi.fn(async (_schema: unknown, instructions: string, data: unknown) => {
    let value: unknown;
    if (instructions.startsWith('Ask')) value = { questions: [{ id: 'goal', question: 'What do you want to do?', options: ['Build', 'Learn'] }, { id: 'depth', question: 'How much depth do you want?', options: ['Quick', 'Detailed'] }] };
    else if (instructions.includes('Create 2-4')) value = { units: [card] };
    else { const cards = (data as { cards: { id: string }[] }).cards; value = { paragraphs: [{ text: 'A separate ranking model can learn preferences from Jev features.', unitIds: [cards[0].id] }], followUp: null }; }
    return { value, tokens: 100, durationMs: 1, model: 'mock/model' };
  }) as unknown as typeof generateSearchJson;
  const evaluate: typeof evaluateWithJev = vi.fn(async (_item, _analysis, context) => ({ decision: { relevance: .9, novelty: .8, actionability: .7, source: 'jev' as const, provider: 'openrouter' as const, model: 'typesafe/jev-1.13-20260917', profileVersion: context.version, createdAt: '2026-09-26T00:00:00.000Z' }, tokens: 50 }));
  const retrieve = vi.fn(async () => ({ sources: [structuredClone(source)], tokens: 20, durationMs: 1, model: 'mock/model', calls: 1 }));
  const service = createPersonalSearchService({ store, configuration: () => settings, profile: () => profile, retrieve, generate, evaluate, ...extra });
  return { service, sessions, units, store, generate, evaluate, retrieve };
}

describe('retrieved source registry and evidence boundaries', () => {
  it('rejects generated-looking objects, private URLs, empty excerpts, and duplicate URLs', () => {
    const results = [{ id: 'a', url: source.url, title: 'A', text: quote }, { id: 'b', url: source.url + '#fragment', title: 'B', text: quote }, { id: 'c', url: 'http://127.0.0.1/admin', title: 'Secret', text: quote }, { id: 'd', url: 'javascript:alert(1)', title: 'X', text: quote }, { id: 'e', url: 'https://example.net/', title: 'Empty', text: '' }];
    const registry = sourceRegistry([{ results }, { requestId: 'real-tool-result', results }], 8);
    expect(registry).toHaveLength(1); expect(registry[0].url).toBe(source.url); expect(registry[0].provenance).toBe('search-excerpt');
  });
  it('changes source identity when the same URL returns different text', () => {
    const output = (text: string) => [{ requestId: 'r', results: [{ id: 'a', url: source.url, title: 'A', text }] }];
    expect(sourceRegistry(output(quote), 2)[0].id).not.toBe(sourceRegistry(output(quote + ' New content.'), 2)[0].id);
  });
  it('validates exact quotes and rejects unknown IDs or fabricated quotes', () => {
    expect(validateGroundedUnits({ units: [card] }, [source])).toBeTruthy();
    expect(() => validateGroundedUnits({ units: [{ ...card, evidence: [{ sourceId: 'invented', quote }] }] }, [source])).toThrow('quotation');
    expect(() => validateGroundedUnits({ units: [{ ...card, evidence: [{ sourceId: 's1', quote: 'A fact that the source did not say.' }] }] }, [source])).toThrow('quotation');
  });
});

describe('deterministic source passage grounding', () => {
  it('keeps exact contiguous original text, stable IDs, and bounded full-text coverage', () => {
    const value = { ...source, text: `${'First sentence with original punctuation. '.repeat(20)}\n\n${'Second paragraph keeps its exact source language. '.repeat(20)}` };
    const passages = sourcePassages(value);
    expect(passages.length).toBeGreaterThan(1); expect(passages.length).toBeLessThanOrEqual(32);
    expect(sourcePassages(value)).toEqual(passages);
    for (const passage of passages) { expect(passage.text).toBe(value.text.slice(passage.start, passage.end)); expect(passage.text.length).toBeLessThanOrEqual(629); }
    expect(passages.at(-1)?.end).toBe(value.text.trimEnd().length);
  });
  it('resolves selected IDs to exact original quotations without asking the model to transcribe them', () => {
    const passage = sourcePassages(source)[0];
    const generated = groundedUnitsSchema.parse({ units: [{ ...card, evidence: [{ sourceId: source.id, passageId: passage.id }] }] });
    const resolved = resolveGroundedCard(generated.units[0], [source]);
    expect(resolved.evidence).toEqual([{ sourceId: source.id, quote: source.text }]);
    expect(validateGroundedUnits({ units: [resolved] }, [source])).toBeTruthy();
  });
  it('rejects invented passage IDs and passage/source mismatches', () => {
    const other = { ...source, id: 'other', text: 'A separate document has different provenance and cannot be cited as the first source.' };
    const otherPassage = sourcePassages(other)[0];
    expect(() => resolveGroundedCard({ ...card, evidence: [{ sourceId: source.id, passageId: 'invented-id' }] }, [source])).toThrow('quotation');
    expect(() => resolveGroundedCard({ ...card, evidence: [{ sourceId: source.id, passageId: otherPassage.id }] }, [source, other])).toThrow('quotation');
  });
});

describe('source targeting and synthesis diversity', () => {
  it('honors explicit site operators and rejects suffix impersonation', () => {
    expect(explicitSearchDomains('Jev site:docs.typesafe.ai methods')).toEqual(['docs.typesafe.ai']);
    expect(explicitSearchDomains('Use docs.typesafe.ai if useful')).toEqual([]);
    expect(matchesSearchDomains('https://docs.typesafe.ai/models', ['docs.typesafe.ai'])).toBe(true);
    expect(matchesSearchDomains('https://docs.typesafe.ai.evil.example/models', ['docs.typesafe.ai'])).toBe(false);
    const registry = sourceRegistry([{ requestId: 'r', results: [{ id: 'a', title: 'Official sounding title', url: 'https://jev-agent.com/docs', text: quote }, { id: 'b', title: 'Models', url: 'https://docs.typesafe.ai/models', text: quote }] }], 8, source.retrievedAt, ['docs.typesafe.ai']);
    expect(registry.map(item => item.publisher)).toEqual(['docs.typesafe.ai']);
  });
  it('selects distinct sources first and never exceeds two cards per source', () => {
    const units = [ ['a1', 'a'], ['a2', 'a'], ['a3', 'a'], ['b1', 'b'], ['b2', 'b'], ['c1', 'c'] ].map(([id, sourceId]) => ({ id, sourceIds: [sourceId] }) as PersonalUnit);
    expect(selectSynthesisUnits(units).map(unit => unit.id)).toEqual(['a1', 'b1', 'c1', 'a2', 'b2']);
    expect(selectSynthesisUnits(units.slice(0, 3)).map(unit => unit.id)).toEqual(['a1', 'a2']);
  });
});

describe('durable personal search workflow', () => {
  it('persists the query before discovery; pauses for choices then grounds, scores and answers', async () => {
    const { service, sessions, store, evaluate } = setup();
    const session = service.start('How can I personalize Jev?');
    expect(sessions.get(session.id)?.status).toBe('interpreting');
    expect(() => service.start('Overlapping work')).toThrow('already running');
    await service.waitForIdle();
    expect(sessions.get(session.id)?.status).toBe('awaiting-clarification');
    expect(service.isRunning()).toBe(false);
    expect(evaluate).not.toHaveBeenCalled();
    service.continue(session.id, { goal: 'Build' }); await service.waitForIdle();
    const done = sessions.get(session.id)!;
    expect(done.status).toBe('completed'); expect(done.units).toHaveLength(1); expect(done.answer).toContain('[unit:unit-');
    expect(done.units[0].features.values.slice(0, 3)).toEqual([.9, .8, .7]);
    expect(done.units[0].features.names).toHaveLength(12); expect(done.usage?.jevTokens).toBe(50); expect(done.usage?.searchCalls).toBe(2);
    expect(store.saveSource).toHaveBeenCalledTimes(1);
  });
  it('grounds a generated passage selection through the durable workflow', async () => {
    const fixture = setup();
    const generate = (async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4')) {
        const data = args[2] as { sources: { id: string; passages: { id: string; text: string }[] }[] };
        return { value: { units: [{ ...card, evidence: [{ sourceId: data.sources[0].id, passageId: data.sources[0].passages[0].id }] }] }, tokens: 50, durationMs: 1, model: 'mock/model' };
      }
      return fixture.generate(...args);
    }) as typeof generateSearchJson;
    const { service, sessions } = setup({ generate });
    const session = service.start('Personal ranker'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
    const completed = sessions.get(session.id)!;
    expect(completed.status).toBe('completed');
    expect(completed.units[0].evidence).toEqual([{ sourceId: source.id, sourceVersion: 1, quote: source.text }]);
    expect(completed.pendingUnits).toHaveLength(0);
  });
  it('accepts four valid generated questions and exposes only three without another generation', async () => {
    const fixture = setup();
    const generate = vi.fn(async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].startsWith('Ask')) {
        const candidate = { questions: Array.from({ length: 4 }, (_, index) => ({ id: `question_${index}`, question: `What matters for decision ${index}?`, options: ['Implementation', 'Overview'] })) };
        return { value: args[0].parse(candidate), tokens: 100, durationMs: 1, model: 'mock/model' };
      }
      return fixture.generate(...args);
    }) as unknown as typeof generateSearchJson;
    const { service, sessions } = setup({ generate });
    const session = service.start('Personal ranker'); await service.waitForIdle();
    expect(sessions.get(session.id)?.status).toBe('awaiting-clarification');
    expect(sessions.get(session.id)?.questions).toHaveLength(3);
    expect(sessions.get(session.id)?.questions.map(question => question.id)).toEqual(['question_0', 'question_1', 'question_2']);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('gives clarification later source facts and explicit bounded-coverage metadata', async () => {
    const laterFact = 'Jev is not fine-tuned or LoRA-adapted with customer data.';
    const longSource = { ...source, text: `${'Context. '.repeat(240)}${laterFact}${' More context.'.repeat(400)}` };
    const retrieve = vi.fn(async () => ({ sources: [longSource], tokens: 0, durationMs: 1, model: 'public-url-extractor', calls: 0, mode: 'direct-url' as const }));
    const { service, generate } = setup({ retrieve });
    service.start('Can Jev be fine-tuned?'); await service.waitForIdle();
    const call = vi.mocked(generate).mock.calls.find(call => call[1].startsWith('Ask'))!;
    const data = call[2] as { sources: { text: string; truncated: boolean; storedCharacters: number; suppliedCharacters: number }[] };
    expect(data.sources[0].text).toContain(laterFact);
    expect(data.sources[0].text).toHaveLength(6000);
    expect(data.sources[0].truncated).toBe(true);
    expect(data.sources[0].storedCharacters).toBe(longSource.text.length);
    expect(data.sources[0].suppliedCharacters).toBe(6000);
    expect(call[1]).toContain('Never claim that a document does not mention or contain a topic');
  });
  it('rejects invalid clarification keys without launching another operation', async () => {
    const { service } = setup(); const session = service.start('Personal ranker'); await service.waitForIdle();
    expect(() => service.continue(session.id, { unknown: 'Do anything' })).toThrow('current questions'); expect(service.isRunning()).toBe(false);
  });
  it('rejects unsupported generated cards before paying for Jev', async () => {
    const fixture = setup(); const original = fixture.generate;
    const badGenerate = (async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4')) return { value: { units: [{ ...card, evidence: [{ sourceId: 's1', quote: 'Totally fabricated quotation.' }] }] }, tokens: 10, durationMs: 1, model: 'mock/model' };
      return original(...args);
    }) as typeof generateSearchJson;
    const { service, sessions, evaluate } = setup({ generate: badGenerate });
    const session = service.start('Personal ranker'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
    expect(sessions.get(session.id)?.status).toBe('failed'); expect(sessions.get(session.id)?.units).toHaveLength(0); expect(evaluate).not.toHaveBeenCalled();
  });
  it('preserves checkpoints on cancel and does not record an aborted tool result', async () => {
    let begin!: () => void; const started = new Promise<void>(resolve => { begin = resolve; });
    const retrieve = vi.fn(async (_query, _count, _settings, signal?: AbortSignal) => { begin(); await new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); return { sources: [source], tokens: 0, durationMs: 0, model: 'mock', calls: 1 }; });
    const { service, sessions } = setup({ retrieve }); const session = service.start('Personal ranker'); await started;
    service.cancel(session.id); await service.waitForIdle();
    expect(sessions.get(session.id)?.status).toBe('cancelled'); expect(sessions.get(session.id)?.sources).toEqual([]); expect(service.isRunning()).toBe(false);
  });
  it('marks interrupted jobs without replaying paid calls', () => {
    const { service, sessions, retrieve, generate } = setup();
    const value: PersonalSearchSession = { id: 'interrupted', query: 'x', status: 'grounding', createdAt: '', updatedAt: '', context: { id: 'x', query: 'x', goal: '', answers: {}, version: 1 }, questions: [], answers: {}, sources: [source], units: [], events: [], answer: '', round: 1 };
    sessions.set(value.id, value); service.recoverInterrupted();
    expect(sessions.get(value.id)?.status).toBe('failed'); expect(sessions.get(value.id)?.error).toContain('no paid requests were replayed'); expect(retrieve).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
  it('reranks existing cards under a new context with new versions and no web search', async () => {
    const { service, sessions, retrieve, units } = setup(); const session = service.start('Personal ranker'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
    service.refine(session.id, { instruction: 'Focus on implementation steps.' }); await service.waitForIdle();
    const done = sessions.get(session.id)!; expect(done.status).toBe('completed'); expect(done.units[0].version).toBe(2); expect(done.units[0].features.contextVersion).toBe(3); expect(retrieve).toHaveBeenCalledTimes(2); expect(units.map(unit => unit.version)).toEqual([1, 2]);
  });
  it('never silently keeps old-context Jev scores after a refinement failure', async () => {
    const { service, sessions, evaluate } = setup(); const session = service.start('Personal ranker'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
    vi.mocked(evaluate).mockRejectedValueOnce({ status: 402, message: 'Secret provider token should not be printed' });
    service.refine(session.id, { instruction: 'New direction' }); await service.waitForIdle();
    const done = sessions.get(session.id)!; expect(done.units).toHaveLength(1); expect(done.units[0].features.contextVersion).toBe(done.context.version); expect(done.context.version).toBe(2); expect(done.status).toBe('partial'); expect(done.error).toContain('previous context and cards were restored'); expect(JSON.stringify(done)).not.toContain('Secret provider token');
  });
  it('checkpoints grounded drafts and resumes Jev without regenerating paid LLM output', async () => {
    const database = createPersonalStore(':memory:');
    try {
      const personal = createPersonalService(database);
      const { service, evaluate, generate, retrieve } = setup({ store: personal });
      vi.mocked(evaluate).mockRejectedValueOnce({ status: 402 });
      const session = service.start('Personal ranking'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
      expect(personal.getSession(session.id)?.pendingUnits).toHaveLength(1);
      expect(personal.exportData().units).toHaveLength(0);
      expect(personal.getSession(session.id)?.status).toBe('failed');
      service.retry(session.id); await service.waitForIdle();
      expect(personal.getSession(session.id)?.status).toBe('completed');
      expect(personal.getSession(session.id)?.pendingUnits).toHaveLength(0);
      expect(personal.exportData().units).toHaveLength(1);
      expect(vi.mocked(generate).mock.calls.filter(call => call[1].includes('Create 2-4'))).toHaveLength(1);
      expect(retrieve).toHaveBeenCalledTimes(2);
    } finally { database.close(); }
  });
  it('resumes stored source checkpoints without paying for another web search', async () => {
    const fixture = setup(); let fail = true;
    const generate = (async (...args: Parameters<typeof generateSearchJson>) => {
      if (args[1].includes('Create 2-4') && fail) { fail = false; throw new Error('Invalid model result'); }
      return fixture.generate(...args);
    }) as typeof generateSearchJson;
    const { service, sessions, retrieve } = setup({ generate });
    const session = service.start('Personal ranking'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
    expect(sessions.get(session.id)?.status).toBe('failed');
    service.retry(session.id); await service.waitForIdle();
    expect(sessions.get(session.id)?.status).toBe('completed');
    expect(sessions.get(session.id)?.units).toHaveLength(1);
    expect(retrieve).toHaveBeenCalledTimes(2);
  });
  it('persists a complete search and refinement through the actual strict SQLite service', async () => {
    const database = createPersonalStore(':memory:');
    try {
      const personal = createPersonalService(database);
      const { service } = setup({ store: personal });
      const session = service.start('Personal ranking'); await service.waitForIdle();
      service.continue(session.id); await service.waitForIdle();
      expect(personal.getSession(session.id)?.status).toBe('completed');
      service.refine(session.id, { instruction: 'Focus on implementation' }); await service.waitForIdle();
      expect(personal.getSession(session.id)?.status).toBe('completed');
      expect(personal.exportData().units).toHaveLength(2);
      expect(personal.exportData().sources).toHaveLength(1);
    } finally { database.close(); }
  });
  it('validates selection IDs before starting answer generation', async () => {
    const { service } = setup(); const session = service.start('Personal ranker'); await service.waitForIdle(); service.continue(session.id); await service.waitForIdle();
    expect(() => service.synthesize(session.id, ['invented'])).toThrow('Choose 1–6 cards'); expect(service.isRunning()).toBe(false);
  });
});
