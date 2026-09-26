# Jev adapter contract

Verified against official documentation and JavaScript SDK **0.6.0**, September 26, 2026. Contract tests use injected HTTP transports; they do not call a model or consume credits.

The adapter calls `POST https://api.typesafe.ai/v1/systemone` through `TypeSafeClient.systemOne`. Server-only `TYPESAFE_API_KEY` supplies bearer authentication. Default prototype model is pinned to `jev-1.13.0`; aliases are supported, and every result records the returned version. See [API reference](https://docs.typesafe.ai/api), [model IDs](https://docs.typesafe.ai/models), and [SDK](https://docs.typesafe.ai/sdk/javascript).

Each candidate is evaluated with three parallel Noul predicates: substantive relevance to the active goal, novelty relative to explicitly recorded knowledge, and concrete actionability. The request contains the first 12,000 source characters, a capped title, supplied concepts/evidence, and only the profile goal/known concepts. Evidence quotes absent from that excerpt are omitted. URLs, feedback history, interest weights, and unrelated user data are not sent. All state is treated as data rather than instructions; this is a prompt boundary, not a guarantee against adversarial content.

Noul is **P(yes)** for its stated predicate and has no separate confidence field. A composite ValueRank score is a ranking heuristic, not a calibrated probability of learning or personal benefit. Novelty is relative to the recorded knowledge list, not the user's entire actual knowledge. Jev calibration in this domain still needs outcome-based evaluation. [Probability vs confidence](https://docs.typesafe.ai/confidence)

The adapter validates JSON at runtime, including exact answer types, finite probabilities in [0,1], nonnegative integer usage, a versioned model ID, and equality to a requested model pin. This is necessary because SDK response types alone do not validate JSON. Invalid responses fail rather than become live scores. [SDK implementation](https://github.com/typesafe-ai/typesafe-sdk-js/blob/v0.6.0/src/client.ts)

Requests use an 8-second per-attempt timeout, at most one retry, and a 20-second overall deadline including retry waits. Caller cancellation participates in the same signal. Logging is off. The SDK retries 408/429/5xx (including 529) and selected transport errors; authentication failures do not retry. [Retry policy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy), [request options](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions)

Published service limits currently list 250k tokens/second, 1,200 requests/minute, 64k total context, and 32k state plus longest question; the provider says limits may change. No separate request-concurrency maximum was found. Input is text-only. Current input price is $0.042 per million tokens with free outputs. Account access requires a key; no guaranteed free allocation was verified. Trace `tokens` is input plus output volume, not a billing amount. [Models and pricing](https://docs.typesafe.ai/models)

Personalization changes request context and downstream ranking. The current Jev service does not fine-tune or LoRA-adapt weights per customer. This prototype makes no claim to train Jev or reproduce proprietary RLCD. [Customization](https://docs.typesafe.ai/models#customizing-jev)
