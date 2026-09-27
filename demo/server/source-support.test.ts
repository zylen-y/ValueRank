import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fetch } from '@typesafe-ai/sdk';
import { CostBudget, withCostAttribution } from './cost-budget.ts';
import { createJevEvaluator } from './jev.ts';
import { createSourceSupportVerifier } from './source-support.ts';

let budget: CostBudget;
beforeEach(() => { const now = Date.now(); budget = new CostBudget(':memory:', { id: 'source-support-test', enabled: true, startsAt: new Date(now - 1000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 }); });
afterEach(() => budget.close());
const settings = () => ({ gatewayKey: '', llmModel: 'unused', openrouterKey: 'mock-key', jevModel: 'typesafe/jev-1.13', jevProvider: 'openrouter' as const, budget });
const response = () => new Response(JSON.stringify({ model: 'typesafe/jev-1.13-20260917', answers: { relevance: { type: 'noul', noul: 0.8 }, novelty: { type: 'noul', noul: 0.8 }, actionability: { type: 'noul', noul: 0.8 }, support: { type: 'noul', noul: 0.84 } }, usage: { input_tokens: 250, output_tokens: 80, cost: 0.00001 } }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('shared metered passage-support verifier', () => {
  it('sends exact full passages and claim separately in one metered four-question transport', async () => {
    const input = { claim: 'The local prototype stores facts in SQLite.', passages: ['The local prototype\nstores facts in SQLite.', 'No cloud synchronization is provided.'], context: 'Choose a local prototype.' };
    const transport = vi.fn<Fetch>(async (_url, init) => {
      expect(budget.snapshot().active).toBe(1);
      const request = JSON.parse(init?.body as string);
      expect(JSON.parse(request.state.source.excerpt)).toEqual({ passages: input.passages.map(quote => ({ quote })) }); expect(request.state.claim).toBe(input.claim);
      expect(request.state.profile.goal).toBe(input.context); expect(Object.keys(request.questions)).toHaveLength(4);
      return response();
    });
    const result = await withCostAttribution('support-test', () => createSourceSupportVerifier(createJevEvaluator(transport))(input, settings()));
    expect(result).toMatchObject({ score: 0.84, model: 'typesafe/jev-1.13-20260917', tokens: 330, version: 'passage-premise-support-v2' });
    expect(result.checkedAt).toMatch(/^\d{4}-/); expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.entriesFor('support-test')).toHaveLength(1);
  });
  it('preserves passage identity and metadata without treating them as authority', async () => {
    const passages = [
      { quote: 'Records remain local.\nNo sync is included.', title: 'Storage example', publisher: 'fixture.invalid', url: 'https://fixture.invalid/local', sourceId: 'one', sourceVersion: 2 },
      { quote: 'Records remain local.\nNo sync is included.', title: 'Different product', publisher: 'other.invalid', url: 'https://other.invalid/local', sourceId: 'two', sourceVersion: 1 },
    ];
    const transport = vi.fn<Fetch>(async (_url, init) => {
      const request = JSON.parse(init?.body as string);
      expect(JSON.parse(request.state.source.excerpt)).toEqual({ passages });
      expect(request.questions.support.instructions).toContain('does not establish authority');
      return response();
    });
    await createSourceSupportVerifier(createJevEvaluator(transport))({ claim: 'Could we measure the local write latency?', passages }, settings());
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('rejects a late result when an injected evaluator ignores cancellation', async () => {
    const controller = new AbortController();
    const evaluate: Parameters<typeof createSourceSupportVerifier>[0] = async () => {
      controller.abort();
      return { support: 0.99, tokens: 0, decision: { model: 'mock' } } as Awaited<ReturnType<NonNullable<Parameters<typeof createSourceSupportVerifier>[0]>>>;
    };
    await expect(createSourceSupportVerifier(evaluate)({ claim: 'A claim.', passages: ['A passage.'] }, settings(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('rejects unsupported full input sizes, missing keys and cancellation before transport', async () => {
    const transport = vi.fn<Fetch>(); const verify = createSourceSupportVerifier(createJevEvaluator(transport));
    for (const input of [
      { claim: 'A claim.', passages: ['x'.repeat(12_001)] }, { claim: 'x'.repeat(2001), passages: ['A passage.'] },
      { claim: 'A claim.', passages: [] }, { claim: 'A claim.', passages: ['A passage.', ' '] },
      { claim: 'A claim.', passages: ['A passage.'], context: 'x'.repeat(3001) },
      { claim: 'A claim.', passages: [{ quote: 'A passage.', title: 'x'.repeat(12_000) }] },
    ]) await expect(verify(input, settings())).rejects.toMatchObject({ code: 'support-input-limit' });
    await expect(verify({ claim: 'A claim.', passages: ['A passage.'] }, { ...settings(), openrouterKey: '' })).rejects.toMatchObject({ code: 'support-key-missing' });
    const controller = new AbortController(); controller.abort();
    await expect(verify({ claim: 'A claim.', passages: ['A passage.'] }, settings(), controller.signal)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(budget.snapshot().accountedUsd).toBe(0);
  });
});
