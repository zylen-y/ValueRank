# Sprint spending controls

The authorized ceiling is **US$100** across existing Gateway and OpenRouter calls.
The application stops admitting paid work at **US$80** of accounted spend,
including outstanding reservations. The remaining US$20 is a billing-uncertainty
buffer, not a separate spending target. No subscription or new service account is
required by these routes.

## Local policy and ledger

All production adapters use `demo/server/cost-budget.ts`. Its default files are:

- `demo/.data/sprint-budget-policy.json`: reviewed policy and runtime switch.
- `demo/.data/sprint-budget.sqlite`: independent SQLite ledger, with WAL and full
  synchronous commits. Neither file belongs in Git or a personal-data export.

The integrator creates this policy after reviewing current prices and the sprint
window. Start disabled until code review is complete:

```json
{
  "id": "valuerank-20h-2026-09-27",
  "enabled": false,
  "startsAt": "2026-09-27T11:47:31.000Z",
  "endsAt": "2026-09-28T07:47:31.000Z",
  "operatingLimitUsd": 80,
  "absoluteLimitUsd": 100,
  "maxConcurrent": 2
}
```

The policy is checked before every reservation. Setting `enabled` to `false`
stops new paid requests without restarting the server. Existing requests retain
their deadlines and reserved amounts. Missing or invalid policy, a changed policy
identity/window/limits, and an unreadable ledger stop requests before transport.
Do not delete or replace the ledger to reset spend during an active sprint.

`getCostBudget().snapshot()` reports `accountedUsd`, `reportedUsd`, active
reservations, uncertain requests, and whether an overrun froze further spending.
`accountedUsd` is conservative spend plus reservations. `reportedUsd` contains only
available provider-reported costs, rounded upward to integer microdollars; missing
reports are not zero-cost evidence. Token usage is also preserved when available.
The ledger stores no prompts, source text, image bytes, or API credentials.

## Reviewed routes and prices

Verified from official documentation and endpoint metadata on **2026-09-27**.

| Route | Published price | Reservation basis |
| --- | --- | --- |
| Gateway `alibaba/qwen3.8-flash`, Alibaba only | US$0.15/M input, US$0.47/M output; cache creation US$0.20/M | US$0.25/M input and US$0.75/M output, plus 25% margin |
| OpenRouter `qwen/qwen3.8-flash`, Alibaba only | US$0.15/M input, US$0.47/M output; cache creation US$0.20/M | Same conservative rates; reserve the entire 1,000,000-token context for search |
| OpenRouter Exa `web` plugin, `fast` | US$0.007 per request, including up to 10 results | One plugin invocation, at most 8 results; include the fee and 25% margin |
| OpenRouter `typesafe/jev-1.13` or `typesafe/jev-1.13-20260917` | US$0.042/M input, US$0 output | US$0.06/M input plus 25% margin; repeat serialized state for each question |

Sources: [Gateway Qwen model](https://vercel.com/ai-gateway/models/qwen3.8-flash),
[OpenRouter Qwen model](https://openrouter.ai/qwen/qwen3.8-flash),
[OpenRouter Qwen endpoints](https://openrouter.ai/api/v1/models/qwen/qwen3.8-flash/endpoints),
[OpenRouter web plugin](https://openrouter.ai/docs/guides/features/plugins/web-search),
[OpenRouter provider restrictions](https://openrouter.ai/docs/guides/routing/provider-selection),
[OpenRouter Jev model](https://openrouter.ai/typesafe/jev-1.13/api).

The Exa plugin runs once per request. The model-controlled Gateway Exa tool route
was removed because a prompt requesting one search does not enforce a call cap.
OpenRouter native search and server tools are not used. The request pins the
provider, disables fallback, requires parameter support, sets token price ceilings,
and supplies no model tools. Adaptive search excerpts have no fixed size guarantee,
so the ledger reserves the full model context rather than estimating their length.
Only extractive `url_citation.content` annotations become sources; the model's
generated body and unsupported citations are discarded.

## Execution bounds

- At most two active reservations across processes, acquired atomically before
  transport. Up to 24 local waiting callers, with cancellation and a 20-second
  queue deadline. No SDK or HTTP automatic retries.
- Text synthesis: at most 120,000 UTF-8 input bytes and 3,200 output tokens. The
  reservation uses one input token per byte plus 2,048 framing tokens, then the
  conservative prices and margin. One response-format repair is permitted and
  must obtain its own reservation.
- Search: one 45-second OpenRouter request, at most eight results, 256 output
  tokens, a 1 MiB response-body limit, and approximately US$0.32149 reserved before
  transport. Public URLs explicitly supplied by the user bypass paid retrieval.
- Source analysis: one scoped local-source tool step and one synthesis step,
  each capped at 1,800 output tokens; one separately reserved format repair.
- Jev: one SDK request with an eight-second transport timeout, 20-second overall
  bound, three ranking questions plus an optional source-support question, and a 60,000-byte repeated-state input
  limit. Direct TypeSafe and unreviewed model versions are blocked.
- Vision: one validated PNG/JPEG, at most 650 KB and 1,600 pixels per side; 800
  output tokens and a full-context reservation of US$0.31325. No image-generation
  or provider-managed tool path is used.

These controls rely on the reviewed providers honoring context, output, routing,
and plugin contracts. Gateway dashboard budgets alone have soft-cap behavior and
do not replace application reservations. Review changed provider contracts before
adding another route or model.

## Reconciliation and restart

Successful requests reconcile provider-reported costs and token counts against
the reserved amount. The accounted amount is the larger of the conservative
token/fee estimate and reported cost. Missing usage or interrupted transport keeps
the entire reservation. A provider overrun freezes new paid calls.

Reservations persist their enforced request deadline plus 30 seconds of transport
grace. After a crash, a new reservation may reclaim an expired concurrency slot,
but its whole amount remains accounted as uncertain spend. Late, complete usage
can still reconcile it. Active unexpired requests are not reclaimed. A restart
does not reset budget totals.

Tests use isolated in-memory or temporary ledgers and mocked transports. They
verify mechanics and failure behavior; they do not demonstrate live provider
latency, retrieval quality, or realized API spend.
