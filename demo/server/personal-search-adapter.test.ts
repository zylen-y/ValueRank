import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
const { generate, extract } = vi.hoisted(() => ({ generate: vi.fn(), extract: vi.fn() }));
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, generateText: generate, createGateway: () => () => ({}) };
});
vi.mock('./extract.ts', async () => {
  const actual = await vi.importActual<typeof import('./extract.ts')>('./extract.ts');
  return { ...actual, extractSource: extract };
});
import { explicitSourceUrls, failedSearchUsage, generateSearchJson, retrievePersonalSources } from './personal-search-adapter.ts';
import { CostBudget } from './cost-budget.ts';
const schema = z.object({ units: z.array(z.object({ title: z.string() })).min(1) });
let budget: CostBudget;
let settings: { gatewayKey: string; llmModel: string; openrouterKey: string; budget: CostBudget };
beforeEach(() => {
  const now = Date.now();
  budget = new CostBudget(':memory:', { id: 'search-adapter-test', enabled: true, startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 60_000).toISOString(), operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 });
  settings = { gatewayKey: 'test', llmModel: 'alibaba/qwen3.8-flash', openrouterKey: 'test-openrouter', budget };
});
afterEach(() => { budget.close(); vi.unstubAllGlobals(); });

describe('search JSON boundary and format repair', () => {
  it('rejects a schema echo, performs only one bounded repair, and accounts both calls', async () => {
    generate.mockReset().mockResolvedValueOnce({ output: z.toJSONSchema(schema), totalUsage: { totalTokens: 10 } }).mockResolvedValueOnce({ output: { units: [{ title: 'Actual content' }] }, totalUsage: { totalTokens: 20 } });
    const events: { phase: string }[] = [];
    const result = await generateSearchJson(schema, 'Extract a card.', { source: 'Public text.' }, settings, undefined, event => events.push(event));
    expect(result.value.units[0].title).toBe('Actual content'); expect(result.tokens).toBe(30); expect(generate).toHaveBeenCalledTimes(2);
    expect(events.map(event => event.phase)).toEqual(['started', 'completed', 'validation-failed', 'started', 'completed']);
    expect(generate.mock.calls[1][0].instructions).toContain('Required format correction:');
    expect(generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 3200, providerOptions: { gateway: { only: ['alibaba'] } } });
    expect(budget.snapshot().unknown).toBe(2); // The mock deliberately reports no billable input/output split.
  });
  it('never accepts a second schema echo and preserves usage plus safe constraint paths', async () => {
    generate.mockReset().mockResolvedValue({ output: z.toJSONSchema(schema), totalUsage: { totalTokens: 10 } });
    let failure: unknown;
    try { await generateSearchJson(schema, 'Extract.', {}, settings); } catch (error) { failure = error; }
    expect(failedSearchUsage(failure)?.tokens).toBe(20); expect(generate).toHaveBeenCalledTimes(2);
    expect((failure as { searchValidationIssues: unknown }).searchValidationIssues).toEqual([{ field: 'units', rule: 'invalid_type' }]);
  });
  it('does not attempt a format repair on provider billing or access errors', async () => {
    generate.mockReset().mockRejectedValue({ statusCode: 402, requestHeaders: { authorization: 'never-forward-this' } });
    await expect(generateSearchJson(schema, 'Extract.', {}, settings)).rejects.toThrow('Structured generation failed');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('bounded OpenRouter search plugin', () => {
  const passage = 'This provider-supplied extractive passage describes a specific design method, evidence and its limitations. ';
  const response = (overrides: Record<string, unknown> = {}) => ({
    id: 'gen-search-test', model: 'qwen/qwen3.8-flash',
    choices: [{ message: { content: 'Invented answer at https://invented.example/', annotations: [
      { type: 'url_citation', url_citation: { url: 'https://docs.example.org/method', title: 'Actual provider source', content: passage } },
      { type: 'url_citation', url_citation: { url: 'http://127.0.0.1/private', title: 'Private address', content: passage } },
      { type: 'url_citation', url_citation: { url: 'https://empty.example/', title: 'No supporting passage' } },
    ] } }], usage: { prompt_tokens: 2_000, completion_tokens: 40, total_tokens: 2_040, cost: 0.0073188 }, ...overrides,
  });
  it('sends one fixed search, caps results/output, and accepts only provider annotation passages', async () => {
    generate.mockReset();
    let reservation = 0;
    const transport = vi.fn(async () => { reservation = budget.snapshot().accountedUsd; return Response.json(response()); });
    vi.stubGlobal('fetch', transport);
    const result = await retrievePersonalSources('Research this method site:example.org', 80, settings);
    expect(transport).toHaveBeenCalledTimes(1); expect(generate).not.toHaveBeenCalled();
    const [url, init] = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions'); expect(init.redirect).toBe('error');
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({ model: 'qwen/qwen3.8-flash', max_tokens: 256, reasoning: { enabled: false }, provider: { only: ['alibaba'], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0.25, completion: 0.75 } }, plugins: [{ id: 'web', engine: 'exa', mode: 'fast', max_results: 8, include_domains: ['example.org'] }] });
    expect(payload.tools).toBeUndefined(); expect(reservation).toBeGreaterThan(0.32);
    expect(result).toMatchObject({ calls: 1, tokens: 2040, mode: 'web-search' });
    expect(result.sources).toHaveLength(1); expect(result.sources[0].text).toBe(passage.trim());
    expect(JSON.stringify(result)).not.toContain('invented.example');
    expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 0, frozen: false });
    expect(budget.snapshot().accountedUsd).toBeLessThan(0.01);
  });
  it('preserves the entire context reservation on provider errors and never retries', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('secret provider body', { status: 402 })); vi.stubGlobal('fetch', transport);
    await expect(retrievePersonalSources('a new query', 4, settings)).rejects.toMatchObject({ statusCode: 402 });
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot().unknown).toBe(1); expect(budget.snapshot().accountedUsd).toBeGreaterThan(0.32);
  });
  it('keeps missing usage reserved and rejects generated citations without source passages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(response({ usage: undefined, choices: [{ message: { content: 'https://invented.example' } }] }))));
    await expect(retrievePersonalSources('a new query', 4, settings)).rejects.toThrow('no usable source excerpts');
    expect(budget.snapshot().unknown).toBe(1); expect(budget.snapshot().accountedUsd).toBeGreaterThan(0.32);
  });
  it('rejects oversized provider bodies before parsing and preserves the reservation', async () => {
    const transport = vi.fn().mockResolvedValue(new Response('x'.repeat(1_048_577))); vi.stubGlobal('fetch', transport);
    await expect(retrievePersonalSources('a new query', 4, settings)).rejects.toThrow('size limit');
    expect(budget.snapshot().unknown).toBe(1); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('does not fall back to unbounded Gateway tools when a search key is absent or budget is exhausted', async () => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport); generate.mockReset();
    await expect(retrievePersonalSources('a new query', 4, { ...settings, openrouterKey: undefined })).rejects.toMatchObject({ code: 'search-key-missing' });
    const blocked = new CostBudget(':memory:', { ...budget.policy, operatingLimitUsd: 0.01 });
    try { await expect(retrievePersonalSources('a new query', 4, { ...settings, budget: blocked })).rejects.toMatchObject({ code: 'exhausted' }); }
    finally { blocked.close(); }
    expect(transport).not.toHaveBeenCalled(); expect(generate).not.toHaveBeenCalled();
  });
});

describe('literal source URLs bypass paid search', () => {
  it('accepts only literal public HTTP(S) URLs, deduplicates, and caps extraction at three', () => {
    expect(explicitSourceUrls('Read https://docs.typesafe.ai/models and https://docs.typesafe.ai/models#customization')).toEqual(['https://docs.typesafe.ai/models']);
    expect(explicitSourceUrls('Reference (https://example.org/page).')).toEqual(['https://example.org/page']);
    expect(explicitSourceUrls('docs.typesafe.ai/models')).toEqual([]);
    expect(explicitSourceUrls('https://a.example/ https://b.example/ https://c.example/ https://d.example/')).toHaveLength(3);
    expect(() => explicitSourceUrls('http://127.0.0.1/admin')).toThrow('Private');
    expect(() => explicitSourceUrls('https://secret@example.org/')).toThrow('credentials');
  });
  it('extracts page text with zero LLM tokens or search calls and a 12,000 character bound', async () => {
    generate.mockReset(); extract.mockReset().mockResolvedValue({ title: 'Models', url: 'https://docs.typesafe.ai/models', text: 'Source text. '.repeat(1500) });
    const result = await retrievePersonalSources('https://docs.typesafe.ai/models Jev 파인튜닝이 가능한지 알고 싶어', 8, settings);
    expect(generate).not.toHaveBeenCalled(); expect(extract).toHaveBeenCalledExactlyOnceWith('https://docs.typesafe.ai/models');
    expect(result).toMatchObject({ tokens: 0, calls: 0, model: 'public-url-extractor', mode: 'direct-url' });
    expect(result.sources[0].provenance).toBe('page-extraction'); expect(result.sources[0].text).toHaveLength(12000);
    expect(result.sources[0].limitations).toContain('Page text was limited to the first 12,000 characters.');
  });
  it('does not send a rejected private literal URL to a paid search provider', async () => {
    generate.mockReset(); extract.mockReset();
    await expect(retrievePersonalSources('http://localhost/admin explain this', 4, settings)).rejects.toThrow('supplied URLs');
    expect(generate).not.toHaveBeenCalled(); expect(extract).not.toHaveBeenCalled();
  });
  it('keeps readable supplied pages when another extraction fails', async () => {
    generate.mockReset(); extract.mockReset().mockResolvedValueOnce({ title: 'Readable', url: 'https://a.example/', text: 'Readable evidence. '.repeat(10) }).mockRejectedValueOnce(new Error('Raw provider detail must not escape'));
    const result = await retrievePersonalSources('https://a.example/ https://b.example/', 4, settings);
    expect(result.sources).toHaveLength(1); expect(result.sources[0].limitations).toContain('1 other supplied URL(s) could not be read.');
    expect(JSON.stringify(result)).not.toContain('Raw provider detail'); expect(generate).not.toHaveBeenCalled();
  });
});
