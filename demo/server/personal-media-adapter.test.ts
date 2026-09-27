import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { generate } = vi.hoisted(() => ({ generate: vi.fn() }));
vi.mock('ai', async () => ({ ...await vi.importActual<typeof import('ai')>('ai'), generateText: generate, createGateway: () => () => ({}) }));
import { CostBudget } from './cost-budget.ts';
import { encodeImage } from './personal-media.ts';
import { VISUAL_FEATURE_NAMES } from '../src/domain/personal-media.ts';

// Header-only image bytes exercise the local gate with a mocked encoder, not vision quality.
function fixture(width = 400) {
  const bytes = Buffer.alloc(28); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(400, 20); return bytes;
}
let budget: CostBudget;
let settings: { apiKey: string; model: string; budget: CostBudget };
beforeEach(() => {
  generate.mockReset(); const now = Date.now();
  budget = new CostBudget(':memory:', { id: 'vision-adapter-test', enabled: true, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 });
  settings = { apiKey: 'test', model: 'alibaba/qwen3.8-flash', budget };
});
afterEach(() => budget.close());

describe('metered vision boundary', () => {
  it('reserves the complete model context before one capped image call and reconciles actual usage', async () => {
    let reserved = 0;
    generate.mockImplementation(async () => {
      reserved = budget.snapshot().accountedUsd;
      return { output: { description: 'Mocked geometry for adapter verification only.', features: Object.fromEntries(VISUAL_FEATURE_NAMES.map(name => [name, 0.5])) }, response: { modelId: settings.model }, totalUsage: { inputTokens: 1000, outputTokens: 100, totalTokens: 1100 }, providerMetadata: { gateway: { cost: 0.000197 } } };
    });
    const result = await encodeImage(fixture(), 'image/png', settings);
    expect(generate).toHaveBeenCalledTimes(1); expect(reserved).toBe(0.31325);
    expect(generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 800, providerOptions: { gateway: { only: ['alibaba'] } } });
    expect(result.tokens).toBe(1100); expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 0, frozen: false });
    expect(budget.snapshot().accountedUsd).toBeLessThan(0.001);
  });
  it('retains the whole context reservation after an uncertain transport failure', async () => {
    generate.mockRejectedValue(new Error('connection lost'));
    await expect(encodeImage(fixture(), 'image/png', settings)).rejects.toThrow('connection lost');
    expect(generate).toHaveBeenCalledTimes(1); expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 1, accountedUsd: 0.31325 });
  });
  it('rejects oversized images, unreviewed models, and cancelled work before transport', async () => {
    await expect(encodeImage(fixture(2000), 'image/png', settings)).rejects.toThrow('Resize');
    await expect(encodeImage(fixture(), 'image/png', { ...settings, model: 'unreviewed/vision' })).rejects.toMatchObject({ code: 'unpriced-model' });
    const cancelled = new AbortController(); cancelled.abort();
    await expect(encodeImage(fixture(), 'image/png', settings, cancelled.signal)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled(); expect(budget.snapshot().accountedUsd).toBe(0);
  });
});
