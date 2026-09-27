import { CostBudgetError } from './cost-budget.ts';

export type ProviderFailure = 'budget' | 'evidence' | 'authentication' | 'credits' | 'access' | 'rate-limit' | 'timeout' | 'cancelled' | 'model' | 'output' | 'unavailable' | 'unknown';
type Provider = 'gateway' | 'openrouter' | 'typesafe';
export interface ProviderErrorContext { stage: 'llm' | 'jev'; provider?: Provider }

const EVIDENCE_MESSAGE = 'Evidence validation failed: every quote must occur in the supplied source. No result was accepted.';
const TIMEOUT_NAMES = new Set(['APITimeoutError', 'TimeoutError', 'GatewayTimeoutError', 'AI_GatewayTimeoutError']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);
const ABORT_NAMES = new Set(['AbortError', 'APIUserAbortError']);
const OUTPUT_NAMES = new Set(['AI_ToolChoiceViolationError', 'AI_NoObjectGeneratedError', 'AI_TypeValidationError', 'ZodError']);

function property(value: object, key: string): unknown {
  // Provider errors are normally plain objects. Defensive property access also
  // keeps malformed error objects from breaking the failure-reporting path.
  try { return Reflect.get(value, key); } catch { return undefined; }
}
function object(value: unknown): value is object { return value !== null && typeof value === 'object'; }
function httpStatus(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599 ? value : undefined;
}

export function classifyProviderError(error: unknown): ProviderFailure {
  // Compare to the exact trusted local error. Never persist an arbitrary suffix
  // merely because a provider message begins with the same words.
  if (error instanceof Error && property(error, 'message') === EVIDENCE_MESSAGE) return 'evidence';

  const queue: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const seen = new Set<object>();
  let fallback: ProviderFailure = 'unknown';
  // RetryError uses lastError; other SDK wrappers use cause. Both traversal
  // depth and total inspected objects are bounded, and cycles are ignored.
  for (let inspected = 0; queue.length && inspected < 12; inspected++) {
    const entry = queue.shift()!;
    if (!object(entry.value) || seen.has(entry.value)) continue;
    seen.add(entry.value);
    const value = entry.value;
    if (value instanceof CostBudgetError) return 'budget';
    const status = httpStatus(property(value, 'statusCode')) ?? httpStatus(property(value, 'status'));
    if (status === 401) return 'authentication';
    if (status === 402) return 'credits';
    if (status === 403) return 'access';
    if (status === 429) return 'rate-limit';
    if (status === 404) return 'model';
    if (status === 408 || status === 504) return 'timeout';
    if (status && status >= 500) fallback = 'unavailable';

    const name = property(value, 'name');
    const code = property(value, 'code');
    if (typeof name === 'string' && OUTPUT_NAMES.has(name)) return 'output';
    if ((typeof name === 'string' && TIMEOUT_NAMES.has(name)) || (typeof code === 'string' && TIMEOUT_CODES.has(code))) return 'timeout';
    if ((typeof name === 'string' && ABORT_NAMES.has(name)) || code === 'ABORT_ERR') fallback = 'cancelled';
    if (entry.depth < 5) {
      queue.push({ value: property(value, 'cause'), depth: entry.depth + 1 });
      queue.push({ value: property(value, 'lastError'), depth: entry.depth + 1 });
    }
  }
  return fallback;
}

/** Static messages only: no raw message, body, header, URL, key, or model string. */
export function safeProviderError(error: unknown, context: ProviderErrorContext): string {
  const kind = classifyProviderError(error);
  if (kind === 'evidence') return EVIDENCE_MESSAGE;
  if (kind === 'budget') return safeBudgetError(error);
  const provider = context.provider ?? (context.stage === 'llm' ? 'gateway' : 'typesafe');
  const providerNames: Record<Provider, string> = { gateway: 'Vercel AI Gateway', openrouter: 'OpenRouter', typesafe: 'TypeSafe' };
  const keyNames: Record<Provider, string> = { gateway: 'AI_GATEWAY_API_KEY', openrouter: 'OPENROUTER_API_KEY', typesafe: 'TYPESAFE_API_KEY' };
  const prefix = `${context.stage === 'llm' ? 'LLM extraction' : 'Jev evaluation'} via ${providerNames[provider]}`;
  const actions: Record<Exclude<ProviderFailure, 'evidence' | 'budget'>, string> = {
    authentication: `API authentication failed (HTTP 401). Check ${keyNames[provider]} in demo/.env.local, then run the engine again.`,
    credits: 'The provider requires credits or billing (HTTP 402). Check the account balance and billing setup, add credits if needed, then run the engine again.',
    access: 'Access to the configured model was denied (HTTP 403). Check model permissions and your account plan. Free-tier access may require paid credits or a different available model; rerun after updating access.',
    'rate-limit': 'The provider rate or quota limit was reached (HTTP 429). Wait before retrying and check the account limits if this continues.',
    timeout: 'The request exceeded its time limit. Retry the item; if this continues, check provider availability or shorten the source.',
    cancelled: 'The request was cancelled or reached its overall time limit. Run the engine again when ready.',
    model: 'The configured model or endpoint was not found (HTTP 404). Check the model setting and provider availability before retrying.',
    output: context.stage === 'llm'
      ? 'The model ignored required tool use or returned an invalid structured response. No analysis was accepted. Retry or choose a model that supports the required tool and structured-output workflow.'
      : 'The provider returned an invalid structured decision. No decision was accepted. Retry and check the configured model and response format if this continues.',
    unavailable: 'The provider could not complete the request. It may be temporarily unavailable; wait before retrying.',
    unknown: 'The request did not complete. Check credentials, credits, model availability, and source validity before retrying.',
  };
  return `${prefix}: ${actions[kind]}`;
}

function safeBudgetError(error: unknown) {
  const messages: Record<string, string> = {
    exhausted: 'The research spending limit has been reached. Your existing sources and saved work remain available.',
    disabled: 'Paid research is paused by the local spending controls. Existing results and public URL reading remain available.',
    'outside-window': 'The approved research spending window has ended or has not started. Existing results remain available.',
    frozen: 'Paid research is paused because a provider exceeded its reserved usage. Review the local cost ledger before continuing.',
    'missing-policy': 'Paid research needs a reviewed local spending policy before it can run.',
    'policy-mismatch': 'The local spending policy changed. Paid research is paused until its ledger is reviewed.',
    'unpriced-model': 'This model has no reviewed spending limit. Use the configured, reviewed Qwen model for this research session.',
    'unpriced-provider': 'Direct TypeSafe calls are paused during this budgeted session. Use the existing OpenRouter route.',
    'unpriced-modality': 'This image or media route has no reviewed spending limit. Paid processing is paused.',
    'input-limit': 'The supplied material is too large for this research request. Use fewer or shorter sources and try again.',
    'output-limit': 'This request exceeds the configured response limit. Shorten the requested result and try again.',
    'queue-full': 'Other research requests are using the available capacity. Try again after they finish.',
    'queue-timeout': 'The research request waited too long for capacity. Try again after the active requests finish.',
    'search-key-missing': 'Bounded web search needs OPENROUTER_API_KEY in the local configuration. You can also supply a public source URL.',
  };
  const queue: unknown[] = [error]; const seen = new Set<object>();
  for (let inspected = 0; queue.length && inspected < 12; inspected++) {
    const value = queue.shift(); if (!object(value) || seen.has(value)) continue; seen.add(value);
    if (value instanceof CostBudgetError) return messages[value.code] ?? 'Paid research was stopped by the local spending controls. Existing results remain available.';
    queue.push(property(value, 'cause'), property(value, 'lastError'));
  }
  return 'Paid research was stopped by the local spending controls. Existing results remain available.';
}
