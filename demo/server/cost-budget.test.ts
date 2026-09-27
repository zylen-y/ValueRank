import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CostBudget, withCostAttribution, type BudgetPolicy, type BudgetReservation, type BudgetUsage } from './cost-budget.ts';
import { gatewayUsage } from './metered-ai.ts';

const NOW = Date.parse('2026-09-27T12:00:00.000Z');
const policy: BudgetPolicy = { id: 'isolated-test', enabled: true, startsAt: '2026-09-27T11:00:00.000Z', endsAt: '2026-09-28T07:00:00.000Z', operatingLimitUsd: 80, absoluteLimitUsd: 100, maxConcurrent: 2 };
const request = { provider: 'gateway' as const, model: 'alibaba/qwen3.8-flash', operation: 'test', input: 'x'.repeat(10_000), maxOutputTokens: 1_000 };
const opened: CostBudget[] = []; const paths: string[] = [];
const create = (overrides: Partial<BudgetPolicy> = {}, path = ':memory:', now = () => NOW) => { const budget = new CostBudget(path, { ...policy, ...overrides }, { now }); opened.push(budget); return budget; };
const tempPath = () => { const path = mkdtempSync(join(tmpdir(), 'valuerank-budget-test-')); paths.push(path); return join(path, 'ledger.sqlite'); };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
afterEach(() => { opened.splice(0).forEach(budget => budget.close()); paths.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });

describe('durable central paid-call budget', () => {
  it('keeps concurrent evaluation receipts attributed without storing private request inputs', async () => {
    const budget = create();
    await Promise.all(['run-one', 'run-two'].map(id => withCostAttribution(id, () => budget.run({ ...request, input: 'private source and key-like data' }, async () => ({ value: 1, usage: { inputTokens: 100, outputTokens: 10 } })))));
    expect(budget.entriesFor('run-one')).toHaveLength(1); expect(budget.entriesFor('run-two')).toHaveLength(1);
    expect(JSON.stringify(budget.entriesFor('run-one'))).not.toContain('private source');
    expect(budget.entriesFor('run-one')[0]).toMatchObject({ state: 'settled', inputTokens: 100, outputTokens: 10 });
  });
  it('reserves before transport and accounts actual usage without storing source content', async () => {
    const budget = create();
    const value = await budget.run(request, async reservation => {
      expect(reservation.reservedUsd).toBeGreaterThan(0.004);
      expect(budget.snapshot().active).toBe(1);
      expect(budget.snapshot().accountedUsd).toBe(reservation.reservedUsd);
      return { value: 'done', usage: { inputTokens: 1_000, outputTokens: 200, costUsd: 0.000244, requestId: 'gen-test' } };
    });
    expect(value).toBe('done');
    expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 0, reportedUsd: 0.000244, accountedUsd: 0.0005, frozen: false });
  });
  it('retains full reservations for transport failures, missing usage and invalid usage', async () => {
    const budget = create(); let reserved = 0;
    await expect(budget.run(request, async reservation => { reserved = reservation.reservedUsd; throw new Error('transport lost'); })).rejects.toThrow('transport lost');
    await budget.run(request, async () => ({ value: 1 }));
    await budget.run(request, async () => ({ value: 1, usage: { inputTokens: NaN, outputTokens: -1, costUsd: -1 } }));
    expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 3, accountedUsd: reserved * 3 });
  });
  it('persists reservations and spend across independent connections and refuses budget resets', async () => {
    const path = tempPath(); const first = create({}, path); const gate = deferred<{ value: number; usage?: BudgetUsage }>();
    const pending = first.run(request, () => gate.promise);
    const second = create({}, path);
    expect(second.snapshot().active).toBe(1);
    expect(second.snapshot().accountedUsd).toBeGreaterThan(0);
    expect(() => create({ operatingLimitUsd: 79 }, path)).toThrow('different budget policy');
    gate.resolve({ value: 1, usage: { inputTokens: 100, outputTokens: 20 } }); await pending;
    expect(second.snapshot().active).toBe(0);
    expect(second.snapshot().accountedUsd).toBe(first.snapshot().accountedUsd);
  });
  it('rejects the next request before transport when existing reservations consume the cap', async () => {
    const budget = create({ operatingLimitUsd: 0.005 });
    await budget.run(request, async () => ({ value: 'unknown usage' }));
    const transport = vi.fn();
    await expect(budget.run(request, transport)).rejects.toMatchObject({ code: 'exhausted' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('freezes further paid calls after a provider exceeds any reserved cost or token bound', async () => {
    const budget = create();
    await budget.run(request, async () => ({ value: 1, usage: { inputTokens: 1_000, outputTokens: 1_001, costUsd: 0.02 } }));
    expect(budget.snapshot()).toMatchObject({ accountedUsd: 0.02, frozen: true });
    await expect(budget.run(request, vi.fn())).rejects.toMatchObject({ code: 'frozen' });
  });
  it('never admits unreviewed models, excess UTF-8 bytes, or unbounded outputs', async () => {
    const budget = create(); const transport = vi.fn();
    await expect(budget.run({ ...request, model: 'unreviewed/model' }, transport)).rejects.toMatchObject({ code: 'unpriced-model' });
    await expect(budget.run({ ...request, input: '한'.repeat(40_001) }, transport)).rejects.toMatchObject({ code: 'input-limit' });
    await expect(budget.run({ ...request, maxOutputTokens: 4_097 }, transport)).rejects.toMatchObject({ code: 'output-limit' });
    expect(transport).not.toHaveBeenCalled(); expect(budget.snapshot().accountedUsd).toBe(0);
  });
  it('rejects disabled, expired and not-yet-started policies without sending requests', async () => {
    for (const budget of [create({ enabled: false }), create({}, ':memory:', () => Date.parse(policy.endsAt)), create({}, ':memory:', () => Date.parse(policy.startsAt) - 1)]) {
      const transport = vi.fn(); await expect(budget.run(request, transport)).rejects.toThrow(); expect(transport).not.toHaveBeenCalled();
    }
    expect(() => create({ operatingLimitUsd: 81 })).toThrow(); expect(() => create({ absoluteLimitUsd: 101 })).toThrow();
  });
  it('waits in a bounded queue across connections, then admits the next request after settlement', async () => {
    const path = tempPath(); const budget = create({}, path); const other = create({}, path);
    const gate = deferred<{ value: number }>();
    const first = budget.run(request, () => gate.promise); const second = other.run(request, () => gate.promise);
    const transport = vi.fn(async () => ({ value: 3, usage: { inputTokens: 100, outputTokens: 10 } }));
    const third = other.run(request, transport);
    expect(budget.snapshot().active).toBe(2); expect(transport).not.toHaveBeenCalled();
    gate.resolve({ value: 1 }); await Promise.all([first, second]);
    await expect(third).resolves.toBe(3); expect(transport).toHaveBeenCalledTimes(1); expect(budget.snapshot().active).toBe(0);
  });
  it('cancels queued requests and enforces queue deadlines without reservations', async () => {
    const budget = create({ maxConcurrent: 1 }); const gate = deferred<{ value: number }>();
    const first = budget.run(request, () => gate.promise);
    const abort = new AbortController(); const transport = vi.fn();
    const queued = budget.run(request, transport, { signal: abort.signal }); abort.abort();
    await expect(queued).rejects.toThrow();
    await expect(budget.run(request, transport, { queueTimeoutMs: 0 })).rejects.toMatchObject({ code: 'queue-timeout' });
    expect(transport).not.toHaveBeenCalled(); expect(budget.snapshot().active).toBe(1);
    gate.resolve({ value: 1 }); await first;
  });
  it('supplies a request deadline and accounts output even when structured parsing fails', async () => {
    const budget = create();
    await expect(budget.run({ ...request, timeoutMs: 1 }, async ({ signal }) => {
      await new Promise(resolve => setTimeout(resolve, 5)); signal.throwIfAborted(); return { value: 1 };
    })).rejects.toThrow();
    const error = new Error('parser rejected paid output');
    await expect(budget.run(request, async () => { throw error; }, { usageFromError: () => ({ inputTokens: 100, outputTokens: 10 }) })).rejects.toBe(error);
    expect(budget.snapshot()).toMatchObject({ active: 0, unknown: 1 });
  });
  it('rejects duplicate reconciliation so settled usage cannot erase a reservation twice', async () => {
    const budget = create(); let id = '';
    await budget.run(request, async (reservation: BudgetReservation) => { id = reservation.id; return { value: 1, usage: { inputTokens: 10, outputTokens: 1 } }; });
    await expect(budget.run({ ...request, operation: 'secret prompt content' }, vi.fn())).rejects.toMatchObject({ code: 'invalid-operation' });
    expect(() => budget.reconcile(id, { inputTokens: 0, outputTokens: 0 })).toThrow('already reconciled');
  });
  it('reclaims crashed request slots only after the persisted deadline and grace, retaining all spend', async () => {
    let now = NOW; const path = tempPath(); const first = create({ maxConcurrent: 1 }, path, () => now);
    const gate = deferred<{ value: number }>(); const pending = first.run({ ...request, timeoutMs: 10_000 }, () => gate.promise);
    const reserved = first.snapshot().accountedUsd;
    const restarted = create({ maxConcurrent: 1 }, path, () => now);
    now += 39_999;
    await expect(restarted.run(request, vi.fn(), { queueTimeoutMs: 0 })).rejects.toMatchObject({ code: 'queue-timeout' });
    expect(restarted.snapshot()).toMatchObject({ active: 1, unknown: 0, accountedUsd: reserved });
    now += 1;
    await restarted.run(request, async () => ({ value: 2, usage: { inputTokens: 10, outputTokens: 1 } }));
    expect(restarted.snapshot()).toMatchObject({ active: 0, unknown: 1 });
    expect(restarted.snapshot().accountedUsd).toBeGreaterThanOrEqual(reserved);
    gate.resolve({ value: 1 }); await pending;
    expect(restarted.snapshot().accountedUsd).toBeGreaterThanOrEqual(reserved);
  });
  it('checks the runtime kill switch before every reservation', async () => {
    let enabled = true; const budget = new CostBudget(':memory:', policy, { now: () => NOW, isEnabled: () => enabled }); opened.push(budget);
    await budget.run(request, async () => ({ value: 1, usage: { inputTokens: 1, outputTokens: 1 } }));
    enabled = false; const transport = vi.fn();
    await expect(budget.run(request, transport)).rejects.toMatchObject({ code: 'disabled' }); expect(transport).not.toHaveBeenCalled();
  });
});

describe('provider usage reconciliation', () => {
  it('recognizes Gateway reported costs without trusting malformed metadata', () => {
    expect(gatewayUsage({ totalUsage: { inputTokens: 10, outputTokens: 5 }, providerMetadata: { gateway: { cost: '0.005', generationId: 'gen-1' } } })).toEqual({ inputTokens: 10, outputTokens: 5, costUsd: 0.005, requestId: 'gen-1' });
    expect(gatewayUsage({ totalUsage: {}, providerMetadata: { gateway: { cost: 'invalid' } } }).costUsd).toBeUndefined();
  });
});
