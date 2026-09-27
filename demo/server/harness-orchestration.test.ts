import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { APICallError, type LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import type { ContentItem, TraceEvent } from '../src/domain/types.ts';

const gateway = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('ai', async (importOriginal) => ({
  ...await importOriginal<typeof import('ai')>(),
  createGateway: gateway.create,
}));
import { analyzeSource } from './harness.ts';
import { CostBudget } from './cost-budget.ts';

const source = 'Compare pairs of lessons to obtain relative preference labels. Fit a ranking model using those labels.';
const item: ContentItem = {
  id: 'source-1', title: 'Preference learning', url: 'https://example.com/preferences', publisher: 'Example',
  kind: 'article', text: source, addedAt: '2026-09-26T00:00:00.000Z', provenance: 'user-paste',
  analysis: null, decision: null, feedback: null, status: 'unprocessed', error: null,
};
const notes = {
  summary: 'Pairwise comparisons yield preference labels that can train a ranking model.',
  concepts: ['pairwise comparison', 'relative preference labels'],
  topics: ['ranking'],
  evidence: [{ quote: 'Compare pairs of lessons to obtain relative preference labels.', insight: 'Pairwise lesson judgments supply relative training labels.' }],
  readingMinutes: 1,
};
const usage = (input: number, output: number): LanguageModelV4GenerateResult['usage'] => ({
  inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: output, text: output, reasoning: 0 },
});
const readTool = (): LanguageModelV4GenerateResult => ({
  content: [{ type: 'tool-call', toolCallId: 'read-1', toolName: 'read_source', input: '{}' }],
  finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
  usage: usage(20, 10), warnings: [],
});
const synthesize = (value: unknown = notes): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: usage(50, 20), warnings: [],
});
const invalidJson = (text: string, finishReason: 'stop' | 'length' = 'stop'): LanguageModelV4GenerateResult => ({
  content: [{ type: 'text', text }],
  finishReason: { unified: finishReason, raw: finishReason },
  usage: usage(60, 9), warnings: [],
});
let settings: { apiKey: string; model: string; budget: CostBudget };
const configure = (model: MockLanguageModelV4) => gateway.create.mockReturnValue(() => model);

beforeEach(() => {
  gateway.create.mockReset(); const now = Date.now();
  settings = { apiKey: 'mock-gateway-key', model: 'alibaba/qwen3.8-flash', budget: new CostBudget(':memory:', { id: 'harness-test', enabled: true, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 120_000).toISOString(), operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 }) };
});
afterEach(() => settings.budget.close());

describe('grounded two-stage harness with the real AI SDK', () => {
  it('reads the scoped source before requesting JSON and counts both model calls', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [readTool(), synthesize()] });
    configure(model);
    const events: TraceEvent[] = [];
    const result = await analyzeSource(item, settings, event => events.push(event));

    expect(result).toEqual({ ...notes, source: 'llm', model: settings.model });
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(settings.budget.snapshot()).toMatchObject({ active: 0, unknown: 0, frozen: false });
    expect(settings.budget.snapshot().accountedUsd).toBeGreaterThan(0);
    const [read, write] = model.doGenerateCalls;
    expect(read.toolChoice).toEqual({ type: 'tool', toolName: 'read_source' });
    expect(read.responseFormat?.type).not.toBe('json');
    expect(write.toolChoice).toEqual({ type: 'none' });
    expect(write.responseFormat).toMatchObject({ type: 'json', schema: { type: 'object' } });
    expect(JSON.stringify(write.prompt)).toContain(source);
    expect(JSON.stringify(write.prompt)).toContain('user-paste');
    expect(events.filter(event => event.stage === 'source' && event.status === 'completed')).toHaveLength(1);
    expect(events.find(event => event.stage === 'llm' && event.status === 'completed')).toMatchObject({ tokens: 100, detail: '2 model steps; 2 concepts.' });
    expect(events.some(event => event.stage === 'evidence' && event.status === 'completed')).toBe(true);
  });

  it('rejects invented evidence even when the model produces valid structured output', async () => {
    const fabricated = { ...notes, evidence: [{ quote: 'This fabricated quotation is not present in the supplied document.', insight: 'A fluent but unsupported claim.' }] };
    const model = new MockLanguageModelV4({ doGenerate: [readTool(), synthesize(fabricated)] });
    configure(model);
    const events: TraceEvent[] = [];

    await expect(analyzeSource(item, settings, event => events.push(event))).rejects.toThrow('Evidence validation failed');
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(events.some(event => event.stage === 'evidence')).toBe(false);
    expect(events.some(event => event.stage === 'llm' && event.status === 'completed')).toBe(false);
  });

  it('rejects a model with no reviewed price before the mocked transport runs', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [readTool(), synthesize()] }); configure(model);
    await expect(analyzeSource(item, { ...settings, model: 'xiaomi/mimo-v2.6-flash' }, () => {})).rejects.toMatchObject({ code: 'unpriced-model' });
    expect(model.doGenerateCalls).toHaveLength(0); expect(settings.budget.snapshot().accountedUsd).toBe(0);
  });

  it('rejects invalid structured JSON after exactly one schema repair without accepting notes', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [
      readTool(),
      synthesize({ insights: ['First wrong schema'] }),
      synthesize({ insights: ['Second wrong schema'] }),
    ] });
    configure(model);
    const events: TraceEvent[] = [];
    await expect(analyzeSource(item, settings, e => events.push(e))).rejects.toMatchObject({ name: 'AI_NoObjectGeneratedError' });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(events.filter(e => e.stage === 'source' && e.status === 'completed')).toHaveLength(1);
    expect(events.filter(e => e.title === 'One response-format repair requested')).toHaveLength(1);
    expect(events.some(e => e.title === 'Reading notes extracted' && e.status === 'completed')).toBe(false);
    expect(events.some(e => e.stage === 'evidence')).toBe(false);
  });

  it('repairs field constraints once using source context and counts all three calls', async () => {
    const generatedText = 'DO_NOT_REPLAY_MODEL_TEXT';
    const invalid = { ...notes, summary: generatedText, readingMinutes: 0 };
    const model = new MockLanguageModelV4({ doGenerate: [readTool(), synthesize(invalid), synthesize()] });
    configure(model);
    const events: TraceEvent[] = [];
    const result = await analyzeSource(item, settings, event => events.push(event));

    expect(result).toEqual({ ...notes, source: 'llm', model: settings.model });
    expect(model.doGenerateCalls).toHaveLength(3);
    const repair = model.doGenerateCalls[2];
    expect(repair.toolChoice).toEqual({ type: 'none' });
    expect(repair.responseFormat).toMatchObject({ type: 'json' });
    const repairPrompt = JSON.stringify(repair.prompt);
    expect(repairPrompt).toContain(source);
    expect(repairPrompt).not.toContain(generatedText);
    const correction = repair.prompt.at(-1);
    expect(correction).toMatchObject({ role: 'user' });
    const correctionText = correction?.content;
    expect(JSON.stringify(correctionText)).toContain('complete, compact JSON object');
    expect(events.filter(event => event.stage === 'source' && event.status === 'completed')).toHaveLength(1);
    expect(events.filter(event => event.title === 'One response-format repair requested')).toHaveLength(1);
    expect(events.find(event => event.title === 'Reading notes extracted')).toMatchObject({
      status: 'completed', tokens: 170, detail: '3 model steps; 2 concepts.',
    });
    expect(events.some(event => event.stage === 'evidence' && event.status === 'completed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain(generatedText);
  });

  it.each([
    { failure: 'malformed', text: '{"summary":"UNTRUSTED_FAILED_TEXT","concepts":[}', finishReason: 'stop' as const },
    { failure: 'truncated', text: '{"summary":"UNTRUSTED_FAILED_TEXT","concepts":[', finishReason: 'length' as const },
  ])('repairs $failure JSON once while counting the failed generation tokens', async ({ text, finishReason }) => {
    const model = new MockLanguageModelV4({ doGenerate: [readTool(), invalidJson(text, finishReason), synthesize()] });
    configure(model);
    const events: TraceEvent[] = [];
    const result = await analyzeSource(item, settings, event => events.push(event));

    expect(result).toEqual({ ...notes, source: 'llm', model: settings.model });
    expect(model.doGenerateCalls).toHaveLength(3);
    const repair = model.doGenerateCalls[2];
    expect(repair.toolChoice).toEqual({ type: 'none' });
    const repairPrompt = JSON.stringify(repair.prompt);
    expect(repairPrompt).toContain(source);
    expect(repairPrompt).not.toContain('UNTRUSTED_FAILED_TEXT');
    expect(JSON.stringify(repair.prompt.at(-1))).toContain('correctly escaped strings');
    expect(events.filter(event => event.stage === 'source' && event.status === 'completed')).toHaveLength(1);
    expect(events.filter(event => event.title === 'One response-format repair requested')).toHaveLength(1);
    expect(events.find(event => event.title === 'Reading notes extracted')).toMatchObject({
      status: 'completed', tokens: 169, detail: '3 model steps; 2 concepts.',
    });
    expect(events.some(event => event.stage === 'evidence' && event.status === 'completed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('UNTRUSTED_FAILED_TEXT');
  });

  it('stops after three calls when both synthesis attempts contain invalid JSON', async () => {
    const model = new MockLanguageModelV4({ doGenerate: [
      readTool(),
      invalidJson('{"summary":"FIRST_INVALID_TEXT","concepts":[}'),
      invalidJson('{"summary":"SECOND_INVALID_TEXT","concepts":[', 'length'),
    ] });
    configure(model);
    const events: TraceEvent[] = [];
    await expect(analyzeSource(item, settings, event => events.push(event)))
      .rejects.toMatchObject({ name: 'AI_NoObjectGeneratedError' });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(events.filter(event => event.stage === 'source' && event.status === 'completed')).toHaveLength(1);
    expect(events.filter(event => event.title === 'One response-format repair requested')).toHaveLength(1);
    expect(events.some(event => event.title === 'Reading notes extracted' || event.stage === 'evidence')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('FIRST_INVALID_TEXT');
    expect(JSON.stringify(events)).not.toContain('SECOND_INVALID_TEXT');
  });

  it('does not repair non-output provider failures or start another model call', async () => {
    const authenticationError = new APICallError({
      message: 'UNTRUSTED_PROVIDER_ERROR', url: 'https://example.com/model', requestBodyValues: {},
      statusCode: 401, isRetryable: false,
    });
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (++calls === 1) return readTool();
      throw authenticationError;
    } });
    configure(model);
    const events: TraceEvent[] = [];
    await expect(analyzeSource(item, settings, event => events.push(event)))
      .rejects.toBe(authenticationError);
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(events.some(event => event.title === 'One response-format repair requested')).toBe(false);
    expect(events.some(event => event.title === 'Reading notes extracted' || event.stage === 'evidence')).toBe(false);
    expect(JSON.stringify(events)).not.toContain('UNTRUSTED_PROVIDER_ERROR');
  });

  it('stops before synthesis when the provider ignores the required source tool', async () => {
    const model = new MockLanguageModelV4({ doGenerate: synthesize() });
    configure(model);
    const events: TraceEvent[] = [];

    await expect(analyzeSource(item, settings, event => events.push(event))).rejects.toMatchObject({ name: 'AI_ToolChoiceViolationError' });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(events.some(event => event.stage === 'source' || event.stage === 'evidence')).toBe(false);
  });

  it('uses one total deadline that cancels synthesis after the source has been read', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async options => {
      if (++calls === 1) return readTool();
      return await new Promise<LanguageModelV4GenerateResult>((_resolve, reject) => {
        options.abortSignal?.addEventListener('abort', () => reject(new DOMException('Deadline elapsed', 'AbortError')), { once: true });
        queueMicrotask(() => deadline.abort());
      });
    } });
    configure(model);
    try {
      await expect(analyzeSource(item, settings, () => {})).rejects.toMatchObject({ name: 'AbortError' });
      expect(timeout).toHaveBeenCalledWith(90_000);
      expect(timeout).toHaveBeenCalledWith(60_000);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(model.doGenerateCalls.every(call => call.abortSignal?.aborted)).toBe(true);
    } finally {
      timeout.mockRestore();
    }
  });
});
