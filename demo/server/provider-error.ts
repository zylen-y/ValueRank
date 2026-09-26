export type ProviderFailure = 'evidence' | 'authentication' | 'credits' | 'access' | 'rate-limit' | 'timeout' | 'cancelled' | 'model' | 'output' | 'unavailable' | 'unknown';
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
  const provider = context.provider ?? (context.stage === 'llm' ? 'gateway' : 'typesafe');
  const providerNames: Record<Provider, string> = { gateway: 'Vercel AI Gateway', openrouter: 'OpenRouter', typesafe: 'TypeSafe' };
  const keyNames: Record<Provider, string> = { gateway: 'AI_GATEWAY_API_KEY', openrouter: 'OPENROUTER_API_KEY', typesafe: 'TYPESAFE_API_KEY' };
  const prefix = `${context.stage === 'llm' ? 'LLM extraction' : 'Jev evaluation'} via ${providerNames[provider]}`;
  const actions: Record<Exclude<ProviderFailure, 'evidence'>, string> = {
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
