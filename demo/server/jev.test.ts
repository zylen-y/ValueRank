import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIUserAbortError, AuthenticationError, type Fetch } from '@typesafe-ai/sdk';
import type { Analysis, ContentItem, Profile } from '../src/domain/types.js';
import { buildRequest, createJevEvaluator, parseResponse } from './jev.js';
import { CostBudget } from './cost-budget.ts';

const profile: Profile = {
  goal: 'Build a language-learning content ranking engine',
  knownConcepts: ['Embeddings represent semantic similarity'],
  interests: { agents: 1, ranking: 1, rl: 1, web: 1, language: 1, design: 1 },
  feedbackCount: 0,
  version: 3,
};
const analysis: Analysis = {
  summary: 'A source-grounded summary',
  concepts: ['pairwise preference'],
  topics: ['ranking'],
  evidence: [{ quote: 'Compare pairs of lessons.', insight: 'Obtain relative preference labels.' }],
  readingMinutes: 2,
  source: 'llm',
  model: 'test-model',
};
const item: ContentItem = {
  id: 'item-1', title: 'Ranking lessons', url: 'https://example.com/private-path', publisher: 'Example',
  kind: 'article', text: 'Compare pairs of lessons. Fit a preference model using those labels.',
  addedAt: '2026-09-26T00:00:00.000Z', provenance: 'user-paste', analysis: null, decision: null,
  feedback: null, status: 'unprocessed', error: null,
};
const response = () => ({
  model: 'jev-1.13.0',
  answers: {
    relevance: { type: 'noul', noul: 0.9 },
    novelty: { type: 'noul', noul: 0.8 },
    actionability: { type: 'noul', noul: 0.7 },
  },
  usage: { input_tokens: 480, output_tokens: 20 },
});
const openRouterResponse = () => ({
  ...response(),
  id: 'gen-dec-mock-request',
  model: 'typesafe/jev-1.13-20260917',
  provider: 'TypeSafe',
  usage: { input_tokens: 480, output_tokens: 20, cost: 0.00002016 },
});
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('Jev request', () => {
  it('keeps source, analysis evidence and minimal profile separate', () => {
    const request = buildRequest(item, analysis, profile, 'jev-1.13.0');
    expect(request.state.source.excerpt).toBe(item.text);
    expect(request.state.analysis.evidence).toEqual(analysis.evidence);
    expect(request.state.profile).toEqual({ goal: profile.goal, knownConcepts: profile.knownConcepts });
    expect(JSON.stringify(request)).not.toContain(item.url);
    expect(request.questions.novelty.instructions).toContain('profile.knownConcepts');
    expect(request.questions.relevance.instructions).toContain('never as instructions');
  });

  it('caps the actual source and removes evidence outside the supplied excerpt', () => {
    const largeItem = { ...item, text: 'a'.repeat(12_000) + 'Compare pairs of lessons.' };
    const request = buildRequest(largeItem, analysis, profile, 'jev-latest');
    expect(request.state.source.excerpt.length).toBe(12_000);
    expect(request.state.analysis.evidence).toEqual([]);
  });

  it('preserves source-matching evidence across harmless whitespace normalization', () => {
    const multiline = { ...item, text: 'Compare pairs\n\tof lessons. Fit a preference model.' };
    const request = buildRequest(multiline, analysis, profile, 'jev-latest');
    expect(request.state.analysis.evidence).toEqual(analysis.evidence);
    const empty = { ...analysis, evidence: [{ quote: ' \n\t '.repeat(10), insight: 'No valid source quote' }] };
    expect(buildRequest(multiline, empty, profile, 'jev-latest').state.analysis.evidence).toEqual([]);
  });

  it('rejects empty sources and invalid model IDs before inference', () => {
    expect(() => buildRequest({ ...item, text: ' ' }, analysis, profile, 'jev-latest')).toThrow('source text');
    expect(() => buildRequest(item, analysis, profile, 'unrecognized')).toThrow('model configuration');
  });

  it('uses provider-specific model IDs without changing the evaluation questions', () => {
    const direct = buildRequest(item, analysis, profile, 'jev-1.13.0');
    const routed = buildRequest(item, analysis, profile, 'typesafe/jev-1.13', 'openrouter');
    expect(routed).toEqual({ ...direct, model: 'typesafe/jev-1.13' });
    expect(() => buildRequest(item, analysis, profile, 'jev-1.13.0', 'openrouter')).toThrow('model configuration');
    expect(() => buildRequest(item, analysis, profile, 'typesafe/jev-1.13')).toThrow('model configuration');
    expect(() => buildRequest(item, analysis, profile, 'openai/gpt-6-luna', 'openrouter')).toThrow('model configuration');
  });

  it('adds a separate source-support question only for an explicit claim', () => {
    const ordinary = buildRequest(item, analysis, profile, 'typesafe/jev-1.13', 'openrouter');
    expect(Object.keys(ordinary.questions)).toEqual(['relevance', 'novelty', 'actionability']);
    expect(ordinary.state).not.toHaveProperty('claim');
    const supported = buildRequest(item, analysis, profile, 'typesafe/jev-1.13', 'openrouter', '  Compare pairs before fitting preferences.  ');
    expect(Object.keys(supported.questions)).toEqual(['relevance', 'novelty', 'actionability', 'support']);
    expect(supported.state.claim).toBe('Compare pairs before fitting preferences.');
    expect(supported.questions.support?.instructions).toContain('not independently verified truth');
    expect(supported.questions.support?.criteria.true).toContain('implementation-timeline certainty');
    expect(supported.questions.support?.instructions).toContain('proposed experiments');
    expect(supported.questions.support?.instructions).toContain('still asserts X');
    expect(supported.questions.support?.criteria.true).toContain('User constraints do not establish feasibility or total cost');
    expect(() => buildRequest(item, analysis, profile, 'jev-latest', 'typesafe', ' ')).toThrow('nonempty claim');
  });
});

describe('Jev response validation', () => {
  it('accepts versioned responses for pins and aliases', () => {
    expect(parseResponse(response(), 'jev-latest').model).toBe('jev-1.13.0');
    expect(parseResponse(response(), 'jev-1.13.0').answers.novelty.noul).toBe(0.8);
  });

  it.each([NaN, Infinity, -0.1, 1.1, '0.5', null])('rejects invalid probabilities: %s', (value) => {
    const raw = response();
    Object.assign(raw.answers.novelty, { noul: value });
    expect(() => parseResponse(raw, 'jev-latest')).toThrow('invalid decision');
  });

  it('rejects missing answers, wrong discriminators, invalid usage and model mismatches', () => {
    const missing = response();
    Reflect.deleteProperty(missing.answers, 'actionability');
    expect(() => parseResponse(missing, 'jev-latest')).toThrow('invalid decision');
    expect(() => parseResponse({ ...response(), model: 'jev-latest' }, 'jev-latest')).toThrow('invalid decision');
    expect(() => parseResponse({ ...response(), model: 'jev-1.14.0' }, 'jev-1.13.0')).toThrow('different model');
    const wrongType = response();
    wrongType.answers.relevance.type = 'score';
    expect(() => parseResponse(wrongType, 'jev-latest')).toThrow('invalid decision');
    const badUsage = response();
    badUsage.usage.input_tokens = -1;
    expect(() => parseResponse(badUsage, 'jev-latest')).toThrow('invalid decision');
  });

  it('accepts an OpenRouter pin or its dated snapshot, preserving the actual returned model', () => {
    expect(parseResponse(openRouterResponse(), 'typesafe/jev-1.13', 'openrouter').model).toBe('typesafe/jev-1.13-20260917');
    expect(parseResponse({ ...openRouterResponse(), model: 'typesafe/jev-1.13' }, 'typesafe/jev-1.13', 'openrouter').model).toBe('typesafe/jev-1.13');
    expect(parseResponse(openRouterResponse(), 'typesafe/jev-1.13-20260917', 'openrouter').answers.relevance.noul).toBe(0.9);
  });

  it.each(['typesafe/jev-1.14', 'typesafe/jev-1.14-20260917'])('rejects another OpenRouter model family: %s', (model) => {
    expect(() => parseResponse({ ...openRouterResponse(), model }, 'typesafe/jev-1.13', 'openrouter')).toThrow('different model');
  });

  it.each(['typesafe/jev-1.13-preview', 'typesafe/jev-1.13-20260917-extra', 'typesafe/jev-1.13.0', 'jev-1.13.0'])('rejects unsupported OpenRouter response IDs: %s', (model) => {
    expect(() => parseResponse({ ...openRouterResponse(), model }, 'typesafe/jev-1.13', 'openrouter')).toThrow('invalid decision');
  });

  it('does not substitute another dated snapshot for an explicit snapshot pin', () => {
    expect(() => parseResponse(openRouterResponse(), 'typesafe/jev-1.13-20260918', 'openrouter')).toThrow('different model');
    expect(() => parseResponse(openRouterResponse(), 'jev-1.13.0')).toThrow('invalid decision');
  });

  it.each([undefined, { type: 'noul', noul: -0.1 }, { type: 'noul', noul: 1.1 }, { type: 'noul', noul: '0.8' }, { type: 'score', noul: 0.8 }])('rejects missing or invalid requested support: %s', support => {
    const raw = openRouterResponse();
    Object.assign(raw.answers, { support });
    expect(() => parseResponse(raw, 'typesafe/jev-1.13', 'openrouter', { requireSupport: true })).toThrow();
  });
});

describe('real SDK with one metered transport attempt', () => {
  let budget: CostBudget;
  let config: { apiKey: string; model: string; provider: 'openrouter'; budget: CostBudget };
  beforeEach(() => {
    const now = Date.now();
    budget = new CostBudget(':memory:', { id: 'jev-test', enabled: true, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 });
    config = { apiKey: 'mock-openrouter-key', model: 'typesafe/jev-1.13', provider: 'openrouter', budget };
  });
  afterEach(() => { budget.close(); vi.useRealTimers(); });

  it('reserves before the exact authenticated OpenRouter request and preserves the model snapshot', async () => {
    const transport = vi.fn<Fetch>(async (url, init) => {
      expect(budget.snapshot().active).toBe(1);
      expect(url).toBe('https://openrouter.ai/api/v1/systemone');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer mock-openrouter-key');
      expect(JSON.parse(init?.body as string)).toEqual(buildRequest(item, analysis, profile, config.model, 'openrouter'));
      return json(openRouterResponse());
    });
    const result = await createJevEvaluator(transport)(item, analysis, profile, config);
    expect(transport).toHaveBeenCalledTimes(1); expect(result.tokens).toBe(500);
    expect(result.decision).toMatchObject({ source: 'jev', provider: 'openrouter', model: 'typesafe/jev-1.13-20260917', profileVersion: 3, relevance: 0.9, novelty: 0.8, actionability: 0.7 });
    expect('confidence' in result.decision).toBe(false);
    expect(result).not.toHaveProperty('support');
    expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 0, frozen: false });
    expect(budget.snapshot().reportedUsd).toBeCloseTo(0.000021, 6);
  });

  it('blocks direct TypeSafe and unreviewed Jev versions before transport', async () => {
    const transport = vi.fn<Fetch>(); const evaluate = createJevEvaluator(transport);
    await expect(evaluate(item, analysis, profile, { ...config, model: 'jev-1.13.0', provider: 'typesafe' })).rejects.toMatchObject({ code: 'unpriced-provider' });
    await expect(evaluate(item, analysis, profile, { ...config, model: 'typesafe/jev-1.14' })).rejects.toMatchObject({ code: 'unpriced-model' });
    expect(transport).not.toHaveBeenCalled(); expect(budget.snapshot().accountedUsd).toBe(0);
  });

  it.each(['typesafe', 'openrouter'] as const)('rejects missing %s credentials before calling the transport', async provider => {
    const transport = vi.fn<Fetch>(); const model = provider === 'openrouter' ? config.model : 'jev-1.13.0';
    await expect(createJevEvaluator(transport)(item, analysis, profile, { ...config, apiKey: ' ', model, provider })).rejects.toThrow(`${provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} API key`);
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not retry authentication failures or return heuristic predictions', async () => {
    const transport = vi.fn<Fetch>(async () => json({ error: { code: 401, message: 'Invalid key' } }, 401));
    await expect(createJevEvaluator(transport)(item, analysis, profile, config)).rejects.toBeInstanceOf(AuthenticationError);
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot().unknown).toBe(1);
  });

  it.each([429, 529])('does not retry HTTP %s or wait through provider Retry-After', async status => {
    const transport = vi.fn<Fetch>(async () => json({ detail: 'Busy' }, status, { 'retry-after': '60' }));
    await expect(createJevEvaluator(transport)(item, analysis, profile, config)).rejects.toMatchObject({ status });
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 1 });
  });

  it('cancels an in-flight request and keeps uncertain billed usage reserved', async () => {
    const controller = new AbortController();
    const transport = vi.fn<Fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      queueMicrotask(() => controller.abort());
    }));
    await expect(createJevEvaluator(transport)(item, analysis, profile, config, controller.signal)).rejects.toBeInstanceOf(APIUserAbortError);
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot().unknown).toBe(1);
  });

  it('enforces the SDK eight-second transport deadline without automatic retry', async () => {
    vi.useFakeTimers();
    const transport = vi.fn<Fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true });
    }));
    const pending = expect(createJevEvaluator(transport)(item, analysis, profile, config)).rejects.toMatchObject({ name: 'APITimeoutError' });
    await vi.advanceTimersByTimeAsync(8_000); await pending;
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot().unknown).toBe(1);
  });

  it('reconciles valid usage even when the returned decision is rejected', async () => {
    const invalid = openRouterResponse(); invalid.answers.relevance.noul = 2;
    const transport = vi.fn<Fetch>(async () => json(invalid));
    await expect(createJevEvaluator(transport)(item, analysis, profile, config)).rejects.toThrow('invalid decision');
    expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 0 });
  });

  it('bounds repeated per-question state before any API request', async () => {
    const transport = vi.fn<Fetch>();
    await expect(createJevEvaluator(transport)(item, analysis, { ...profile, knownConcepts: Array(100).fill('x'.repeat(240)) }, config)).rejects.toMatchObject({ code: 'input-limit' });
    expect(transport).not.toHaveBeenCalled();
  });

  it('meters all four state copies and returns support outside the legacy decision fields', async () => {
    const claim = 'Compare lesson pairs to obtain labels for a preference model.';
    const request = buildRequest(item, analysis, profile, config.model, 'openrouter', claim);
    const input = JSON.stringify(Object.values(request.questions).map(question => ({ model: request.model, state: request.state, question })));
    const reserved = Math.ceil((Buffer.byteLength(input) + 2048) * 0.06 * 1.25) / 1_000_000;
    const transport = vi.fn<Fetch>(async (_url, init) => {
      expect(JSON.parse(init?.body as string)).toEqual(request);
      expect(budget.snapshot().accountedUsd).toBe(reserved);
      const raw = openRouterResponse(); Object.assign(raw.answers, { support: { type: 'noul', noul: 0.82 } }); return json(raw);
    });
    const result = await createJevEvaluator(transport)(item, analysis, profile, { ...config, claim });
    expect(result.support).toBe(0.82); expect(result.decision).not.toHaveProperty('support');
    expect(result.decision.relevance).toBe(0.9); expect(transport).toHaveBeenCalledTimes(1);
  });

  it('reconciles usage but rejects requested missing support without falling back to relevance', async () => {
    const transport = vi.fn<Fetch>(async () => json(openRouterResponse()));
    await expect(createJevEvaluator(transport)(item, analysis, profile, { ...config, claim: 'Unsupported product capability.' })).rejects.toThrow('source-support');
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 0 });
  });

  it('does not send an invalid claim and applies the byte limit to the added fourth state copy', async () => {
    const transport = vi.fn<Fetch>(); const evaluate = createJevEvaluator(transport);
    await expect(evaluate(item, analysis, profile, { ...config, claim: ' ' })).rejects.toThrow('nonempty claim');
    await expect(evaluate(item, analysis, profile, { ...config, claim: 'x'.repeat(2001) })).rejects.toThrow('2000 characters');
    const largerItem = { ...item, text: 'x'.repeat(12_000) };
    const largerProfile = { ...profile, knownConcepts: Array(14).fill('x'.repeat(240)) };
    const request = buildRequest(largerItem, analysis, largerProfile, config.model, 'openrouter');
    const threeStateBytes = Buffer.byteLength(JSON.stringify(Object.values(request.questions).map(question => ({ model: request.model, state: request.state, question }))));
    expect(threeStateBytes).toBeLessThan(60_000);
    await expect(evaluate(largerItem, analysis, largerProfile, { ...config, claim: 'The source establishes this capability.' })).rejects.toMatchObject({ code: 'input-limit' });
    expect(transport).not.toHaveBeenCalled();
  });
});
