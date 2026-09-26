import { randomUUID } from 'node:crypto';
import type { Store } from './store.ts';
import type { TraceEvent } from '../src/domain/types.ts';
import { config } from './config.ts';
import { analyzeSource } from './harness.ts';
import { evaluateWithJev } from './jev.ts';
import { safeProviderError } from './provider-error.ts';

export function startPipeline(store: Store, itemIds?: string[]) {
  const credentials = config();
  if (!credentials.gatewayKey || !credentials.jevKey) throw new Error('Add AI_GATEWAY_API_KEY and OPENROUTER_API_KEY (or TYPESAFE_API_KEY) to demo/.env.local first.');
  const state = store.get();
  if (state.run?.status === 'running') throw new Error('An engine run is already in progress.');
  const requested = itemIds?.length ? state.items.filter(i => itemIds.includes(i.id)) : state.items;
  const items = requested.slice(0, 8);
  if (!items.length) throw new Error('There are no matching sources to process.');
  const runId = randomUUID();
  const profile = structuredClone(state.profile);
  store.update(s => { s.run = { id: runId, status: 'running', startedAt: new Date().toISOString(), processed: 0, total: items.length, errors: 0, events: [] }; });
  const emit = (event: TraceEvent) => store.update(s => {
    if (s.run?.id !== runId) return;
    const index = s.run.events.findIndex(e => e.id === event.id);
    if (index >= 0) s.run.events[index] = event; else s.run.events.push(event);
  });
  // One worker is deliberate: an auditable maximum of 8 items, 24 LLM steps,
  // and 8 logical Jev calls per click (each provider may retry once). No automatic background inference.
  const done = (async () => {
    for (const item of items) {
      let stage: 'llm' | 'jev' = 'llm';
      store.update(s => { const stored = s.items.find(i => i.id === item.id)!; stored.status = 'processing'; stored.error = null; });
      try {
        const analysis = item.analysis?.source === 'llm' && item.analysis.model === credentials.llmModel
          ? item.analysis
          : await analyzeSource(item, { apiKey: credentials.gatewayKey, model: credentials.llmModel }, emit);
        if (analysis === item.analysis) emit({ id: randomUUID(), stage: 'llm', title: 'Using saved reading notes', detail: 'Source text and extraction model are unchanged; no LLM call needed.', itemId: item.id, status: 'completed', at: new Date().toISOString(), model: analysis.model, tokens: 0 });
        stage = 'jev';
        store.update(s => { s.items.find(i => i.id === item.id)!.analysis = analysis; });
        const jevEvent = randomUUID(); const started = Date.now();
        emit({ id: jevEvent, stage: 'jev', title: 'Jev is evaluating three bounded questions', detail: `Via ${credentials.jevProvider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'}: goal relevance, knowledge novelty, and actionable value under the saved profile.`, itemId: item.id, status: 'running', at: new Date().toISOString(), model: credentials.jevModel });
        const result = await evaluateWithJev(item, analysis, profile, { apiKey: credentials.jevKey, model: credentials.jevModel, provider: credentials.jevProvider });
        store.update(s => {
          const target = s.items.find(i => i.id === item.id)!;
          target.analysis = analysis; target.decision = result.decision; target.status = 'ready'; target.error = null;
          s.run!.processed += 1;
        });
        emit({ id: jevEvent, stage: 'jev', title: 'Typed decision scores received', detail: `Via ${credentials.jevProvider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'}. Response probabilities validated in [0,1]. These are model estimates, not a calibration guarantee.`, itemId: item.id, status: 'completed', at: new Date().toISOString(), durationMs: Date.now() - started, tokens: result.tokens, model: result.decision.model });
        emit({ id: randomUUID(), stage: 'rank', title: 'Personalized ranking updated', detail: `Profile version ${profile.version}; utility blends typed judgments with explicit knowledge, preferences, and reading cost.`, itemId: item.id, status: 'completed', at: new Date().toISOString() });
      } catch (error) {
        // Never persist provider request objects/headers or raw response bodies.
        const safe = safeProviderError(error, { stage, provider: stage === 'llm' ? 'gateway' : credentials.jevProvider });
        store.update(s => {
          const target = s.items.find(i => i.id === item.id)!; target.status = 'error'; target.error = safe;
          s.run!.errors += 1;
          for (const event of s.run!.events) if (event.itemId === item.id && event.status === 'running') event.status = 'failed';
        });
        emit({ id: randomUUID(), stage: 'error', title: 'Item needs another attempt', detail: safe, itemId: item.id, status: 'failed', at: new Date().toISOString() });
        // Avoid repeating an unavailable or rejected provider across the batch.
        break;
      }
    }
    store.update(s => { if (s.run?.id === runId) { s.run.status = s.run.errors ? 'failed' : 'completed'; s.run.finishedAt = new Date().toISOString(); } });
  })();
  void done.catch(() => store.update(s => { if (s.run?.id === runId) { s.run.status = 'failed'; s.run.finishedAt = new Date().toISOString(); } }));
  return { runId, done };
}
