# ValueRank prototype architecture

## End-to-end path

```mermaid
flowchart LR
  I[URL or pasted text] --> S[Bounded source text]
  S --> H[LLM tool-loop harness]
  H --> Q[Validate exact evidence quotes]
  Q --> J[Jev typed judgments]
  P[Goal and known concepts] --> J
  J --> R[Personal utility policy]
  P --> R
  R --> U[Ranked reading queue]
  U --> F[Explicit feedback]
  F --> D[(SQLite event history)]
  D --> P
```

## Responsibilities

- `server/extract.ts`: public HTML/plain-text retrieval. Validate every redirect,
  reject private/reserved addresses, pin the resolved DNS address to the connection,
  cap bytes, and enforce a total deadline. No scripts execute.
- `server/harness.ts`: a bounded harness. A one-step `ToolLoopAgent` reads the
  authorized source; a separate `generateText` call synthesizes typed reading notes.
  Separating tool selection and JSON output avoids incompatible simultaneous
  constraints on some providers. MiMo uses JSON mode, a schema in the trusted
  prompt, and local Zod validation; other models receive native structured output.
  A JSON parsing or schema failure allows one repair using a fixed formatting
  instruction or field/rule codes and the original source. Raw failed output is
  never replayed as an instruction. At most three model calls share the same
  90-second deadline; token accounting includes failed generation usage when reported.
  Unsupported evidence quotes fail immediately rather than being accepted or repaired.
  The only tool cannot browse, write files, or invoke arbitrary tools.
  Source content is untrusted data. Zod validates output and evidence quotes must
  match source text after whitespace normalization. Matching quotes is a provenance
  check, not a proof that every inference is semantically correct.
- `server/jev.ts`: three explicit predicates evaluated in one real SDK call per item.
  Runtime schema and model-version checks prevent malformed responses becoming scores.
- `src/domain/ranking.ts`: a transparent local policy combines judgments, goal
  matching, recorded knowledge overlap, learned preferences, and reading cost.
- `server/store.ts` and `service.ts`: synchronous SQLite transactions, active
  feedback, immutable observation history, profile replay, and JSONL export.
- `server/pipeline.ts`: durable trace snapshots and sequential job execution. A
  restarted server marks incomplete work failed; it does not silently resume billing.
- `server/provider-error.ts`: bounded error classification with static user-facing
  actions for authentication, billing, model access, rate limits, and timeouts;
  no raw provider errors, response bodies, or headers are persisted.
- `src/App.tsx`: queue, knowledge editor, source/evidence reader, and actual run trace.

## Utility policy

All component inputs are in [0,1]. The final score is clamped to [0,100]:

```
100 * (0.40 relevance + 0.26 novelty + 0.16 actionability
       + 0.18 preference - 0.06 timeCost - knownPenalty
       + explicitItemFeedbackAdjustment)
```

With a current Jev decision, relevance and novelty blend 65% Jev with 35% local
signals; actionability uses the Jev forecast. A missing, invalid, or stale decision
uses local signals, with the mode visible in the UI. Weights are design choices,
not learned causal effects or calibrated probability estimates.

Useful feedback increases corresponding topic preferences toward one by 22% of the
remaining distance. Not-useful feedback scales them by 0.76. Already-known feedback
records specific concept tags; broad topic names are excluded. Knowledge overlap
reduces novelty and adds a separate penalty. These mechanisms are intentionally
inspectable baselines, not claims of learned general intelligence.

## Integrity boundaries

- No secrets enter the frontend bundle or API response. Credentials are loaded on
  the server and omitted from persisted traces.
- One current verdict per item; repeating the same verdict is idempotent.
- Replacing or undoing feedback rebuilds from a declared baseline rather than
  applying an inverse gradient or compounding updates.
- Historical feature snapshots remain immutable when summaries or profiles change.
- Explicit edits to known concepts override replay without rewriting observations.
- Every profile mutation increments a version, making old Jev judgments stale.
- Source excerpts are limited to 12,000 characters for inference; traces say when
  truncated. Full retained source text is capped at 50,000 characters.
- New runs are explicit, bounded, and serialized. Failures stop additional requests.
- Each reading brief can start a single-source run. The queue exposes its batch
  size, traces link to source titles, and the reader shows saved model provenance.
- Profile editing and feedback controls are disabled while a UI run is active.

## Next engineering boundary

The local single-user app is useful for evaluating the product loop. A hosted
multi-user version needs authentication, tenant-scoped database rows, protected
paid endpoints, queues/checkpointing, and retention/deletion controls. A learned
ranker should follow a source-grouped evaluation protocol with fresh preference
labels and delayed learning assessments. Exported feedback is raw material for that
work, not an automatically valid training dataset.
