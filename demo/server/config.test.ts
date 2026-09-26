import { describe, expect, it } from 'vitest';
import { resolveConfig } from './config.ts';

describe('server credential routing', () => {
  it('uses an OpenRouter key without requiring a TypeSafe account', () => {
    const c = resolveConfig({ AI_GATEWAY_API_KEY: ' gateway ', OPENROUTER_API_KEY: ' router ' }, {});
    expect(c).toMatchObject({ gatewayKey: 'gateway', jevKey: 'router', jevProvider: 'openrouter', jevModel: 'typesafe/jev-1.13' });
  });

  it('keeps a direct TypeSafe model pin separate from the OpenRouter model', () => {
    const c = resolveConfig({ OPENROUTER_API_KEY: 'router', VALUERANK_JEV_MODEL: 'jev-1.13.0' }, {});
    expect(c.jevModel).toBe('typesafe/jev-1.13');
    expect(resolveConfig({ OPENROUTER_API_KEY: 'router', VALUERANK_OPENROUTER_JEV_MODEL: 'typesafe/jev-1.13-20260917' }, {}).jevModel).toBe('typesafe/jev-1.13-20260917');
  });

  it('prefers OpenRouter when both keys exist, unless explicitly configured otherwise', () => {
    const keys = { OPENROUTER_API_KEY: 'router', TYPESAFE_API_KEY: 'direct' };
    expect(resolveConfig(keys, {}).jevProvider).toBe('openrouter');
    expect(resolveConfig({ ...keys, VALUERANK_JEV_PROVIDER: 'typesafe' }, {})).toMatchObject({ jevProvider: 'typesafe', jevKey: 'direct', jevModel: 'jev-1.13.0' });
  });

  it('never sends a TypeSafe key to OpenRouter when its key is missing', () => {
    expect(resolveConfig({ VALUERANK_JEV_PROVIDER: 'openrouter', TYPESAFE_API_KEY: 'direct' }, {}).jevKey).toBe('');
    expect(resolveConfig({ VALUERANK_JEV_PROVIDER: 'typesafe', OPENROUTER_API_KEY: 'router' }, {}).jevKey).toBe('');
  });

  it('supports environment values and rejects unknown providers', () => {
    expect(resolveConfig({}, { TYPESAFE_API_KEY: 'direct' })).toMatchObject({ jevProvider: 'typesafe', jevKey: 'direct' });
    expect(() => resolveConfig({ VALUERANK_JEV_PROVIDER: 'other' }, {})).toThrow('VALUERANK_JEV_PROVIDER');
  });
});
