import { describe, expect, it } from 'vitest';
import { classifyProviderError, safeProviderError } from './provider-error.ts';
import { CostBudgetError } from './cost-budget.ts';

const gateway = { stage: 'llm' as const, provider: 'gateway' as const };
const secret = 'SECRET-DO-NOT-PERSIST';
const errorWithStatus = (status: number) => Object.assign(new Error(`Raw response ${secret}`), {
  statusCode: status,
  requestBody: { authorization: secret },
  responseBody: `<html>${secret}</html>`,
  headers: { Authorization: `Bearer ${secret}` },
});

describe('safe actionable provider errors', () => {
  it('reports local budget controls clearly through wrappers without exposing arbitrary messages', () => {
    const error = new Error('Structured generation failed', { cause: new CostBudgetError('exhausted', secret) });
    expect(classifyProviderError(error)).toBe('budget');
    expect(safeProviderError(error, gateway)).toContain('spending limit has been reached');
    expect(safeProviderError(error, gateway)).not.toContain(secret);
    expect(safeProviderError(new CostBudgetError('unpriced-provider', secret), { stage: 'jev', provider: 'typesafe' })).toContain('existing OpenRouter route');
    expect(safeProviderError(new CostBudgetError(secret, secret), gateway)).not.toContain(secret);
    expect(classifyProviderError({ name: 'CostBudgetError', code: 'exhausted', message: secret })).toBe('unknown');
  });
  it.each([
    [401, 'authentication'], [402, 'credits'], [403, 'access'], [429, 'rate-limit'],
    [408, 'timeout'], [504, 'timeout'], [404, 'model'], [500, 'unavailable'], [529, 'unavailable'],
  ] as const)('classifies HTTP %s without exposing provider payloads', (status, kind) => {
    const error = errorWithStatus(status);
    expect(classifyProviderError(error)).toBe(kind);
    const message = safeProviderError(error, gateway);
    expect(message).toContain('LLM extraction via Vercel AI Gateway');
    expect(message).not.toContain(secret);
    expect(message).not.toContain('<html>');
    expect(message).not.toContain('Bearer');
  });

  it('makes the observed Gateway internal-error/403 free-tier failure actionable', () => {
    const error = Object.assign(errorWithStatus(403), {
      name: 'GatewayInternalServerError',
      message: `Free tier users do not have access to this model. Upgrade at https://provider.example/${secret}`,
    });
    const message = safeProviderError(error, gateway);
    expect(classifyProviderError(error)).toBe('access');
    expect(message).toContain('HTTP 403');
    expect(message).toContain('paid credits');
    expect(message).toContain('different available model');
    expect(message).not.toContain('https://');
    expect(message).not.toContain(secret);
  });

  it('uses the correct provider and environment variable for authentication', () => {
    expect(safeProviderError({ status: 401 }, { stage: 'jev', provider: 'openrouter' })).toContain('Jev evaluation via OpenRouter: API authentication failed (HTTP 401). Check OPENROUTER_API_KEY');
    expect(safeProviderError({ status: 401 }, { stage: 'jev', provider: 'typesafe' })).toContain('TYPESAFE_API_KEY');
  });

  it('looks through retry wrappers and nested causes for an actionable status', () => {
    const error = { name: 'AI_RetryError', lastError: { statusCode: 500, cause: { status: 402, message: secret } } };
    expect(classifyProviderError(error)).toBe('credits');
    expect(safeProviderError(error, gateway)).toContain('billing');
    expect(safeProviderError(error, gateway)).not.toContain(secret);
  });

  it.each([
    { name: 'APITimeoutError' }, { name: 'TimeoutError' }, { name: 'GatewayTimeoutError' },
    { cause: { code: 'ETIMEDOUT' } }, { code: 'UND_ERR_CONNECT_TIMEOUT' },
  ])('recognizes timeout metadata without matching raw message text', error => {
    expect(classifyProviderError(error)).toBe('timeout');
    expect(safeProviderError(error, gateway)).toContain('time limit');
  });

  it('does not misreport a caller abort as a definite provider timeout', () => {
    expect(classifyProviderError({ name: 'APIUserAbortError' })).toBe('cancelled');
    expect(safeProviderError({ name: 'AbortError' }, gateway)).toContain('cancelled or reached its overall time limit');
  });

  it.each(['AI_ToolChoiceViolationError', 'AI_NoObjectGeneratedError', 'AI_TypeValidationError', 'ZodError'])('classifies %s as a rejected output without persisting generated text', name => {
    const error = {
      name, message: secret, text: secret, value: { secret },
      cause: { name: 'AI_TypeValidationError', message: secret, issues: [{ received: secret }] },
    };
    expect(classifyProviderError(error)).toBe('output');
    const message = safeProviderError(error, gateway);
    expect(message).toContain('required tool use or returned an invalid structured response');
    expect(message).toContain('No analysis was accepted');
    expect(message).not.toContain(secret);
  });

  it('finds output errors in nested causes and gives Jev-specific guidance', () => {
    const error = { name: 'Error', cause: { name: 'AI_TypeValidationError', cause: { name: 'ZodError', message: secret } } };
    expect(classifyProviderError(error)).toBe('output');
    const message = safeProviderError(error, { stage: 'jev', provider: 'openrouter' });
    expect(message).toContain('Jev evaluation via OpenRouter');
    expect(message).toContain('No decision was accepted');
    expect(message).not.toContain('tool use');
    expect(message).not.toContain(secret);
  });

  it('does not classify output errors by searching raw provider text', () => {
    expect(classifyProviderError(new Error(`AI_NoObjectGeneratedError ${secret}`))).toBe('unknown');
  });

  it('preserves only the fixed local evidence validation message', () => {
    const fixed = 'Evidence validation failed: every quote must occur in the supplied source. No result was accepted.';
    expect(safeProviderError(new Error(fixed), gateway)).toBe(fixed);
    const disguised = new Error(`Evidence validation failed: ${secret}`);
    expect(classifyProviderError(disguised)).toBe('unknown');
    expect(safeProviderError(disguised, gateway)).not.toContain(secret);
  });

  it('bounds traversal, tolerates cycles and ignores malformed metadata', () => {
    const cyclic: { cause?: unknown; statusCode?: unknown } = {};
    cyclic.cause = cyclic;
    expect(classifyProviderError(cyclic)).toBe('unknown');
    let deep: unknown = { statusCode: 403 };
    for (let i = 0; i < 20; i++) deep = { cause: deep };
    expect(classifyProviderError(deep)).toBe('unknown');
    expect(classifyProviderError({ statusCode: NaN, status: `${secret}403` })).toBe('unknown');
    expect(classifyProviderError(null)).toBe('unknown');
    expect(classifyProviderError(secret)).toBe('unknown');
    expect(classifyProviderError(Object.defineProperty({}, 'statusCode', { get() { throw new Error(secret); } }))).toBe('unknown');
  });

  it('never reads body/header fields or uses message text to infer authorization', () => {
    const error = { status: 403, message: secret };
    Object.defineProperty(error, 'responseBody', { get() { throw new Error('Body must not be read'); } });
    Object.defineProperty(error, 'headers', { get() { throw new Error('Headers must not be read'); } });
    expect(safeProviderError(error, gateway)).toContain('HTTP 403');
    expect(classifyProviderError(new Error('403 unauthorized'))).toBe('unknown');
  });
});
