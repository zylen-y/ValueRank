import { NoObjectGeneratedError } from 'ai';
import { CostBudget, getCostBudget, type BudgetUsage } from './cost-budget.ts';

type GatewayResult = {
  totalUsage: { inputTokens?: number; outputTokens?: number };
  providerMetadata?: unknown;
  response?: { id?: string };
};

export function gatewayUsage(result: GatewayResult): BudgetUsage {
  const metadata = result.providerMetadata as { gateway?: { cost?: unknown; generationId?: unknown } } | undefined;
  const cost = metadata?.gateway?.cost;
  const numericCost = typeof cost === 'string' && cost.trim() ? Number(cost) : cost;
  return {
    inputTokens: result.totalUsage.inputTokens, outputTokens: result.totalUsage.outputTokens,
    ...(typeof numericCost === 'number' && Number.isFinite(numericCost) && numericCost >= 0 ? { costUsd: numericCost } : {}),
    requestId: typeof metadata?.gateway?.generationId === 'string' ? metadata.gateway.generationId : result.response?.id,
  };
}

/** Pin the reviewed provider; never add provider-managed tools or fallback models. */
export function budgetedGatewayOptions(operation: string) {
  return { gateway: { only: ['alibaba'], tags: ['valuerank', operation, 'strict-budget'] } };
}

/** Each invocation is exactly one transport attempt; callers must set maxRetries: 0. */
export async function meteredGatewayCall<T extends GatewayResult>(
  request: { model: string; operation: string; input: string; maxOutputTokens: number; timeoutMs?: number; reserveContextWindow?: boolean },
  execute: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal; budget?: CostBudget } = {},
): Promise<T> {
  return (options.budget ?? getCostBudget()).run({ ...request, provider: 'gateway' }, async ({ signal }) => {
    const value = await execute(signal);
    return { value, usage: gatewayUsage(value) };
  }, {
    signal: options.signal,
    usageFromError: error => NoObjectGeneratedError.isInstance(error) ? {
      inputTokens: error.usage?.inputTokens, outputTokens: error.usage?.outputTokens,
      requestId: error.response?.id,
    } : undefined,
  });
}
