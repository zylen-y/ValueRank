import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

/** Prices verified against official provider catalogues on 2026-09-27.
 * Reserves use higher rates, UTF-8 bytes rather than chars/4, and 25% headroom.
 * Unknown models and provider-managed tools are deliberately not admitted.
 */
export const PRICING_VERSION = '2026-09-27-v1';
export const budgetPolicySchema = z.object({
  id: z.string().min(1).max(100), enabled: z.boolean(),
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
  operatingLimitUsd: z.number().positive().max(80), absoluteLimitUsd: z.number().positive().max(100),
  maxConcurrent: z.number().int().min(1).max(2).default(2),
}).strict().refine(p => Date.parse(p.endsAt) > Date.parse(p.startsAt) && p.operatingLimitUsd <= p.absoluteLimitUsd, 'Invalid budget window or limits.');
export type BudgetPolicy = z.infer<typeof budgetPolicySchema>;
export type BudgetProvider = 'gateway' | 'openrouter';
export interface BudgetRequest {
  provider: BudgetProvider; model: string; operation: string;
  /** Complete serialized text input, including trusted instructions and schemas. Never stored. */
  input: string; maxOutputTokens: number; timeoutMs?: number;
  /** Conservative full-context reservation for the reviewed Qwen multimodal route. */
  reserveContextWindow?: boolean;
}
export interface BudgetUsage { inputTokens?: number; outputTokens?: number; costUsd?: number; requestId?: string }
export interface BudgetReservation { id: string; reservedUsd: number; signal: AbortSignal }
export interface BudgetReceipt {
  id: string; provider: BudgetProvider; model: string; operation: string; state: string;
  reservedUsd: number; accountedUsd: number; reportedUsd: number | null;
  inputTokens: number | null; outputTokens: number | null; requestId: string | null;
  createdAt: string; finishedAt: string | null;
}
const attributionContext = new AsyncLocalStorage<string>();
export function withCostAttribution<T>(id: string, action: () => Promise<T>): Promise<T> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(id)) return Promise.reject(new CostBudgetError('invalid-attribution', 'Invalid cost attribution ID.'));
  return attributionContext.run(id, action);
}
type Price = { input: number; output: number; maxInputBytes: number; maxOutputTokens: number; inputCeiling?: number; fixedMicros?: number };
type Entry = { id: string; state: string; reserved_micros: number; accounted_micros: number; reported_micros: number | null; input_ceiling: number; output_ceiling: number; provider: BudgetProvider; model: string };

export class CostBudgetError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'CostBudgetError'; this.code = code; }
}
const fail = (code: string, message: string): never => { throw new CostBudgetError(code, message); };
const micros = (usd: number) => Math.ceil(usd * 1_000_000);
function priceFor(provider: BudgetProvider, model: string): Price {
  if (provider === 'gateway' && model === 'alibaba/qwen3.8-flash') return { input: 0.25, output: 0.75, maxInputBytes: 120_000, maxOutputTokens: 4_096 };
  // The OpenRouter Exa plugin runs exactly once and injects extractive highlights.
  // Reserve the ENTIRE model context: adaptive highlights have no byte-size cap.
  if (provider === 'openrouter' && model === 'qwen/qwen3.8-flash') return { input: 0.25, output: 0.75, maxInputBytes: 12_000, maxOutputTokens: 256, inputCeiling: 1_000_000, fixedMicros: 7_000 };
  if (provider === 'openrouter' && /^typesafe\/jev-1\.13(?:-20260917)?$/.test(model)) return { input: 0.06, output: 0, maxInputBytes: 60_000, maxOutputTokens: 512 };
  return fail('unpriced-model', 'This model has no reviewed price and request bound. Paid request stopped.');
}
const validCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const validCost = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Isolated from all personal databases. Reservations are committed before transport starts. */
export class CostBudget {
  readonly policy: BudgetPolicy;
  private db: DatabaseSync;
  private queued = 0;
  private now: () => number;
  private isEnabled: () => boolean;
  constructor(path: string, policy: BudgetPolicy, options: { now?: () => number; isEnabled?: () => boolean } = {}) {
    this.policy = budgetPolicySchema.parse(policy); this.now = options.now ?? Date.now;
    this.isEnabled = options.isEnabled ?? (() => this.policy.enabled);
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS budget_policy (singleton INTEGER PRIMARY KEY CHECK(singleton=1), policy TEXT NOT NULL, frozen INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS budget_entries (
        id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT NOT NULL, operation TEXT NOT NULL, pricing_version TEXT NOT NULL,
        state TEXT NOT NULL, reserved_micros INTEGER NOT NULL, accounted_micros INTEGER NOT NULL,
        input_ceiling INTEGER NOT NULL, output_ceiling INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
        reported_micros INTEGER, request_id TEXT, created_at TEXT NOT NULL, finished_at TEXT, expires_at INTEGER NOT NULL, attribution TEXT
      );`);
    if (!(this.db.prepare('PRAGMA table_info(budget_entries)').all() as { name: string }[]).some(column => column.name === 'expires_at')) {
      // Early ledgers had no leases: retain their whole reservation as uncertain spend.
      this.db.exec('ALTER TABLE budget_entries ADD COLUMN expires_at INTEGER NOT NULL DEFAULT 0');
    }
    if (!(this.db.prepare('PRAGMA table_info(budget_entries)').all() as { name: string }[]).some(column => column.name === 'attribution')) this.db.exec('ALTER TABLE budget_entries ADD COLUMN attribution TEXT');
    // enabled is an operational switch, not a way to reset the durable spend policy.
    const durablePolicy = JSON.stringify({ ...this.policy, enabled: undefined });
    try { this.transaction(() => {
      const stored = this.db.prepare('SELECT policy FROM budget_policy WHERE singleton=1').get() as { policy: string } | undefined;
      if (stored && stored.policy !== durablePolicy) fail('policy-mismatch', 'The existing ledger belongs to a different budget policy.');
      if (!stored) this.db.prepare('INSERT INTO budget_policy(singleton,policy) VALUES(1,?)').run(durablePolicy);
    }); } catch (error) { this.db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = action(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  snapshot() {
    const row = this.db.prepare(`SELECT COALESCE(SUM(accounted_micros),0) accounted, COALESCE(SUM(reported_micros),0) reported,
      COALESCE(SUM(CASE WHEN state='reserved' THEN 1 ELSE 0 END),0) active,
      COALESCE(SUM(CASE WHEN state='unknown' THEN 1 ELSE 0 END),0) unknown FROM budget_entries`).get() as { accounted: number; reported: number; active: number; unknown: number };
    const { frozen } = this.db.prepare('SELECT frozen FROM budget_policy WHERE singleton=1').get() as { frozen: number };
    return { policyId: this.policy.id, accountedUsd: row.accounted / 1_000_000, reportedUsd: row.reported / 1_000_000, active: row.active, unknown: row.unknown, frozen: Boolean(frozen), queued: this.queued, operatingLimitUsd: this.policy.operatingLimitUsd, absoluteLimitUsd: this.policy.absoluteLimitUsd };
  }
  entriesFor(attribution: string): BudgetReceipt[] {
    return this.db.prepare(`SELECT id,provider,model,operation,state,reserved_micros/1000000.0 AS reservedUsd,
      accounted_micros/1000000.0 AS accountedUsd,reported_micros/1000000.0 AS reportedUsd,
      input_tokens AS inputTokens,output_tokens AS outputTokens,request_id AS requestId,created_at AS createdAt,finished_at AS finishedAt
      FROM budget_entries WHERE attribution=? ORDER BY rowid`).all(attribution) as unknown as BudgetReceipt[];
  }
  private reserve(request: BudgetRequest): { id: string; reservedUsd: number } | undefined {
    if (!this.isEnabled()) fail('disabled', 'Paid calls are paused until the budget policy is enabled.');
    const now = this.now();
    if (now < Date.parse(this.policy.startsAt) || now >= Date.parse(this.policy.endsAt)) fail('outside-window', 'The approved paid-call window is not active.');
    const price = priceFor(request.provider, request.model);
    const bytes = Buffer.byteLength(request.input, 'utf8');
    if (bytes > price.maxInputBytes) fail('input-limit', 'The paid request exceeds the reviewed input limit. Shorten the supplied material.');
    if (!validCount(request.maxOutputTokens) || request.maxOutputTokens > price.maxOutputTokens) fail('output-limit', 'The paid request exceeds the reviewed output limit.');
    if (!/^[a-z0-9][a-z0-9:/_-]{0,79}$/i.test(request.operation)) fail('invalid-operation', 'Invalid cost attribution label.');
    // One byte per token is deliberately pessimistic for supported text tokenizers.
    // Add framing/schema overhead, then reserve the capped output including reasoning.
    if (request.reserveContextWindow && (request.provider !== 'gateway' || request.model !== 'alibaba/qwen3.8-flash')) fail('unpriced-modality', 'This multimodal route has no reviewed input bound.');
    const inputCeiling = request.reserveContextWindow ? 1_000_000 : price.inputCeiling ?? bytes + 2_048;
    const reserveMicros = Math.max(1, Math.ceil((inputCeiling * price.input + request.maxOutputTokens * price.output + (price.fixedMicros ?? 0)) * 1.25));
    return this.transaction(() => {
      // A killed process cannot settle its request. After its enforced transport
      // deadline plus grace, free the concurrency slot but NEVER release its spend.
      this.db.prepare("UPDATE budget_entries SET state='unknown',finished_at=? WHERE state='reserved' AND expires_at<=?")
        .run(new Date(now).toISOString(), now);
      const state = this.snapshot();
      if (state.frozen) fail('frozen', 'Cost reconciliation exceeded a request bound. Paid calls are paused for review.');
      if (micros(state.accountedUsd) + reserveMicros > Math.min(micros(this.policy.operatingLimitUsd), micros(this.policy.absoluteLimitUsd))) fail('exhausted', 'The sprint operating budget is exhausted. Existing results remain available.');
      if (state.active >= this.policy.maxConcurrent) return undefined;
      const id = randomUUID();
      const expiresAt = Math.min(now + requestTimeout(request), Date.parse(this.policy.endsAt)) + 30_000;
      this.db.prepare(`INSERT INTO budget_entries(id,provider,model,operation,pricing_version,state,reserved_micros,accounted_micros,input_ceiling,output_ceiling,created_at,expires_at,attribution)
        VALUES(?,?,?,?,?,'reserved',?,?,?,?,?,?,?)`).run(id, request.provider, request.model, request.operation, PRICING_VERSION, reserveMicros, reserveMicros, inputCeiling, request.maxOutputTokens, new Date(now).toISOString(), expiresAt, attributionContext.getStore() ?? null);
      return { id, reservedUsd: reserveMicros / 1_000_000 };
    });
  }
  /** Missing usage consumes the entire reservation. Reconciliation never erases uncertain spend. */
  reconcile(id: string, usage?: BudgetUsage) {
    this.transaction(() => {
      const entry = this.db.prepare('SELECT * FROM budget_entries WHERE id=?').get(id) as Entry | undefined;
      if (!entry) return fail('unknown-reservation', 'Budget reservation does not exist.');
      const price = priceFor(entry.provider, entry.model);
      const countsKnown = validCount(usage?.inputTokens) && validCount(usage?.outputTokens);
      if (entry.state === 'settled') fail('already-reconciled', 'Budget reservation was already reconciled.');
      // An expired request can still report its final usage; partial reports can
      // only retain/increase the uncertain amount, never release it.
      const reportedKnown = validCost(usage?.costUsd);
      const estimatedMicros = countsKnown ? Math.ceil((usage!.inputTokens! * price.input + usage!.outputTokens! * price.output + (price.fixedMicros ?? 0)) * 1.25) : entry.reserved_micros;
      const reportedMicros = reportedKnown ? Math.max(micros(usage!.costUsd!), entry.reported_micros ?? 0) : entry.reported_micros ?? undefined;
      const accounted = Math.max(estimatedMicros, reportedMicros ?? 0);
      const overrun = accounted > entry.reserved_micros || (countsKnown && (usage!.inputTokens! > entry.input_ceiling || usage!.outputTokens! > entry.output_ceiling));
      this.db.prepare(`UPDATE budget_entries SET state=?,accounted_micros=?,input_tokens=?,output_tokens=?,reported_micros=?,request_id=?,finished_at=? WHERE id=?`)
        .run(countsKnown ? 'settled' : 'unknown', accounted, countsKnown ? usage!.inputTokens! : null, countsKnown ? usage!.outputTokens! : null, reportedMicros ?? null,
          typeof usage?.requestId === 'string' && /^[a-zA-Z0-9_.:-]{1,200}$/.test(usage.requestId) ? usage.requestId : null, new Date(this.now()).toISOString(), id);
      if (overrun) this.db.prepare('UPDATE budget_policy SET frozen=1 WHERE singleton=1').run();
    });
  }
  async run<T>(request: BudgetRequest, execute: (reservation: BudgetReservation) => Promise<{ value: T; usage?: BudgetUsage }>, options: { signal?: AbortSignal; usageFromError?: (error: unknown) => BudgetUsage | undefined; queueTimeoutMs?: number } = {}): Promise<T> {
    options.signal?.throwIfAborted();
    if (this.queued >= 24) fail('queue-full', 'The paid-call queue is full. Try again after active research finishes.');
    this.queued++;
    let reservation: { id: string; reservedUsd: number } | undefined;
    const queueDeadline = Date.now() + Math.min(20_000, Math.max(0, options.queueTimeoutMs ?? 20_000));
    try {
      do {
        options.signal?.throwIfAborted();
        reservation = this.reserve(request);
        if (reservation) break;
        if (Date.now() >= queueDeadline) fail('queue-timeout', 'The paid-call queue timed out. Try again after active research finishes.');
        await delay(25, undefined, { signal: options.signal });
      } while (!reservation);
    } finally { this.queued--; }
    const timeout = Math.min(requestTimeout(request), Math.max(1, Date.parse(this.policy.endsAt) - this.now()));
    const deadline = AbortSignal.timeout(timeout);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    let result: { value: T; usage?: BudgetUsage };
    try { signal.throwIfAborted(); result = await execute({ ...reservation, signal }); }
    catch (error) { this.reconcile(reservation.id, options.usageFromError?.(error)); throw error; }
    this.reconcile(reservation.id, result.usage);
    return result.value;
  }
}

function requestTimeout(request: BudgetRequest) {
  if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) return fail('invalid-timeout', 'Invalid paid request timeout.');
  return Math.min(90_000, Math.max(1, Math.floor(request.timeoutMs ?? 60_000)));
}

let defaultBudget: CostBudget | undefined;
/** Root records this ignored policy only after reviewing prices and the run window. */
export function getCostBudget(): CostBudget {
  if (defaultBudget) return defaultBudget;
  const directory = resolve(import.meta.dirname, '../.data');
  let policy: BudgetPolicy;
  try { policy = budgetPolicySchema.parse(JSON.parse(readFileSync(resolve(directory, 'sprint-budget-policy.json'), 'utf8'))); }
  catch { return fail('missing-policy', 'A reviewed local budget policy is required before paid calls.'); }
  const durable = (value: BudgetPolicy) => JSON.stringify({ ...value, enabled: undefined });
  defaultBudget = new CostBudget(resolve(directory, 'sprint-budget.sqlite'), policy, { isEnabled: () => {
    let current: BudgetPolicy;
    try { current = budgetPolicySchema.parse(JSON.parse(readFileSync(resolve(directory, 'sprint-budget-policy.json'), 'utf8'))); }
    catch { return fail('missing-policy', 'The reviewed local budget policy is missing or invalid. Paid calls are paused.'); }
    if (durable(current) !== durable(policy)) return fail('policy-mismatch', 'The active budget policy changed. Paid calls are paused for review.');
    return current.enabled;
  } });
  return defaultBudget;
}
