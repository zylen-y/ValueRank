import { describe, expect, it, vi } from 'vitest';
import { APIUserAbortError, AuthenticationError, type Fetch } from '@typesafe-ai/sdk';
import type { Analysis, ContentItem, Profile } from '../src/domain/types.js';
import { buildRequest, createJevEvaluator, parseResponse } from './jev.js';

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
});

describe('real SDK, mocked transport', () => {
  it('sends the exact authenticated HTTP contract and records only validated live decisions', async () => {
    let calls = 0;
    const transport: Fetch = async (url, init) => {
      calls++;
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer mock-key');
      expect(JSON.parse(init?.body as string)).toEqual(buildRequest(item, analysis, profile, 'jev-1.13.0'));
      return json(response());
    };
    const result = await createJevEvaluator(transport)(item, analysis, profile, { apiKey: 'mock-key', model: 'jev-1.13.0' });
    expect(calls).toBe(1);
    expect(result.tokens).toBe(500);
    expect(result.decision).toMatchObject({ source: 'jev', provider: 'typesafe', model: 'jev-1.13.0', profileVersion: 3, relevance: 0.9, novelty: 0.8, actionability: 0.7 });
    expect('confidence' in result.decision).toBe(false);
  });

  it('routes the same real SDK through OpenRouter with its own key and preserves the snapshot', async () => {
    const transport = vi.fn<Fetch>(async (url, init) => {
      expect(url).toBe('https://openrouter.ai/api/v1/systemone');
      expect(init?.method).toBe('POST');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer mock-openrouter-key');
      expect(JSON.parse(init?.body as string)).toEqual(buildRequest(item, analysis, profile, 'typesafe/jev-1.13', 'openrouter'));
      return json(openRouterResponse());
    });
    const result = await createJevEvaluator(transport)(item, analysis, profile, { apiKey: 'mock-openrouter-key', model: 'typesafe/jev-1.13', provider: 'openrouter' });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(result.tokens).toBe(500);
    expect(result.decision).toMatchObject({ source: 'jev', provider: 'openrouter', model: 'typesafe/jev-1.13-20260917', profileVersion: 3, relevance: 0.9, novelty: 0.8, actionability: 0.7 });
    expect('confidence' in result.decision).toBe(false);
  });

  it.each(['typesafe', 'openrouter'] as const)('rejects missing %s credentials before calling the transport', async (provider) => {
    const transport = vi.fn<Fetch>();
    const model = provider === 'openrouter' ? 'typesafe/jev-1.13' : 'jev-1.13.0';
    await expect(createJevEvaluator(transport)(item, analysis, profile, { apiKey: ' ', model, provider })).rejects.toThrow(`${provider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'} API key`);
    expect(transport).not.toHaveBeenCalled();
  });

  it('does not retry OpenRouter authentication failures or fall back to another provider', async () => {
    const transport = vi.fn<Fetch>(async () => json({ error: { code: 401, message: 'Invalid key' } }, 401));
    await expect(createJevEvaluator(transport)(item, analysis, profile, { apiKey: 'mock-key', model: 'typesafe/jev-1.13', provider: 'openrouter' })).rejects.toBeInstanceOf(AuthenticationError);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('does not retry authentication failures or return heuristic predictions', async () => {
    let calls = 0;
    const evaluate = createJevEvaluator(async () => { calls++; return json({ detail: 'Invalid key' }, 401); });
    await expect(evaluate(item, analysis, profile, { apiKey: 'mock-key', model: 'jev-latest' })).rejects.toBeInstanceOf(AuthenticationError);
    expect(calls).toBe(1);
  });

  it.each([429, 529])('retries HTTP %s once', async (status) => {
    let calls = 0;
    const evaluate = createJevEvaluator(async () => ++calls === 1 ? json({ detail: 'Retry' }, status, { 'retry-after-ms': '1' }) : json(response()));
    const result = await evaluate(item, analysis, profile, { apiKey: 'mock-key', model: 'jev-latest' });
    expect(calls).toBe(2);
    expect(result.decision.source).toBe('jev');
  });

  it('cancels a pending 60-second provider retry wait', async () => {
    let calls = 0;
    const controller = new AbortController();
    const evaluate = createJevEvaluator(async () => { calls++; return json({ detail: 'Busy' }, 529, { 'retry-after': '60' }); });
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      await expect(evaluate(item, analysis, profile, { apiKey: 'mock-key', model: 'jev-latest' }, controller.signal)).rejects.toBeInstanceOf(APIUserAbortError);
      expect(calls).toBe(1);
    } finally {
      clearTimeout(timer);
    }
  });

  it('enforces the overall 20-second deadline across a long Retry-After wait', async () => {
    vi.useFakeTimers();
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      expect(ms).toBe(20_000);
      setTimeout(() => deadline.abort(new DOMException('Deadline elapsed', 'TimeoutError')), ms);
      return deadline.signal;
    });
    const evaluate = createJevEvaluator(async () => json({ detail: 'Busy' }, 529, { 'retry-after': '60' }));
    try {
      const pending = expect(evaluate(item, analysis, profile, { apiKey: 'mock-key', model: 'jev-latest' })).rejects.toBeInstanceOf(APIUserAbortError);
      await vi.advanceTimersByTimeAsync(20_000);
      await pending;
      expect(deadline.signal.aborted).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});
