import { describe, expect, it, vi } from 'vitest';
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
const schema = z.object({ units: z.array(z.object({ title: z.string() })).min(1) });
const settings = { gatewayKey: 'test', llmModel: 'xiaomi/mimo-test' };

describe('search JSON boundary and format repair', () => {
  it('rejects a schema echo, performs only one bounded repair, and accounts both calls', async () => {
    generate.mockReset().mockResolvedValueOnce({ output: z.toJSONSchema(schema), totalUsage: { totalTokens: 10 } }).mockResolvedValueOnce({ output: { units: [{ title: 'Actual content' }] }, totalUsage: { totalTokens: 20 } });
    const events: { phase: string }[] = [];
    const result = await generateSearchJson(schema, 'Extract a card.', { source: 'Public text.' }, settings, undefined, event => events.push(event));
    expect(result.value.units[0].title).toBe('Actual content'); expect(result.tokens).toBe(30); expect(generate).toHaveBeenCalledTimes(2);
    expect(events.map(event => event.phase)).toEqual(['started', 'completed', 'validation-failed', 'started', 'completed']);
    expect(generate.mock.calls[1][0].instructions).toContain('Required format correction:');
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
