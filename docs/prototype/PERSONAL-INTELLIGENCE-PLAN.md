# ValueRank: personal search and preference learning

Status: proposed implementation plan, 26 September 2026. This document does not
claim that the new search or preference-learning features are implemented.

## Product contract

ValueRank combines open exploration, grounded synthesis, and a personal ranking
function. The lasting asset is the user's versioned record of knowledge, choices,
and contextual tradeoffs, plus a model that can predict future choices.

Two experiences feed the same learning infrastructure:

1. **Search:** a query becomes a source-backed collection of independently rankable
   information units. Clarification and comparison refine what is valuable now.
2. **Arena:** a dataset becomes an enjoyable sequence of comparisons. Those choices
   train a personal ranking head and test whether it predicts unseen preferences.

The existing Signal Lab remains a benchmark/debug view. The default product entry
becomes a search box and recent explorations. The existing Geist-inspired visual
system is retained.

## Search experience

1. Save the query and session. If the entity is ambiguous, perform a small discovery
   search rather than inventing its meaning. “iPhone Duo” is an example query, not
   an assertion that a particular product exists.
2. Ask up to two or three useful questions about intent and tradeoffs. Offer quick
   answers, free text, “use my profile,” and “search now.” Initial discovery can run
   while the user answers; questions must not block ordinary browsing indefinitely.
3. Retrieve multiple branches: direct evidence, comparisons/alternatives, drawbacks
   or contrary evidence. Preserve source results and their original order.
4. Register real URLs from search-tool results; deduplicate sources and retrieve
   bounded excerpts/full pages where accessible. Publication and retrieval dates,
   source type, and unavailable/truncated content remain distinct.
5. An LLM converts grounded passages into standalone units: a fact, comparison,
   tradeoff, explanation, procedure, or counterargument. A unit carries enough
   context to make sense outside its original page. Do not split a qualified claim
   into a misleading fragment or inflate many duplicates from one source.
6. Jev produces typed semantic judgments; the personal ranker combines them with
   learned preferences and the current objective. Source support and user appeal
   are separate dimensions. Preserve contrary evidence and source diversity.
7. Show three connected views: original sources, ranked information cards, and a
   generated answer assembled from selected cards. Every card can open its evidence,
   be compared, be saved, or be marked already known.
8. Ask a targeted follow-up only when an unresolved preference or fact could change
   the useful shortlist. Rerank existing units immediately; search again for a
   concrete missing fact. Keep follow-up rounds bounded and skippable.

Proposed initial workload: roughly 10–20 retrieved candidates, bounded extraction
of selected sources, and up to 24–60 validated units. These are implementation
limits to verify, not latency promises. Search, extraction, generation, Jev, and
local reranking have separate timing/usage measurements. The old 2.197-second Jev
benchmark does not imply that a fresh full search finishes in that time.

## The information unit

A stable item has immutable content revisions:

- ID, revision/content hash, domain, modality, kind, title, standalone payload.
- Source IDs and supporting spans; source URL, publisher, publication/retrieval time.
- Provenance: search snippet, provider excerpt, directly extracted page, upload,
  or explicitly authored example. LLM-generated URLs are never accepted as evidence.
- Concepts, uncertainty/limitations, duplicates/related units, estimated effort.
- Feature vectors and their encoder, rubric, model, and context versions.
- For images: asset ID/hash, original URL, source/rights metadata, and entity grouping
  where provided by the dataset. Embeddings and captions remain derived artifacts.

Items can appear in multiple sessions and datasets. Source revisions never silently
rewrite historical comparisons or training rows. Grounded quotations validate
provenance; they do not by themselves establish factual correctness.

## Profile and learning model

| Layer | Meaning | How it changes |
|---|---|---|
| Knowledge | Recorded familiarity with specific concepts and supporting evidence | Explicit self-report; later optional recall/performance observations |
| Preferences | Patterns in contextual comparisons within a domain | A learned pairwise model updated from actual choices |
| Values | Stated tradeoffs such as depth/speed or price/repairability | Explicit choices and correctable, scoped hypotheses |
| Current context | Query, intent, budget, constraints | Session clarification; durable only when the user elects to save it |

A photo preference does not establish an article preference. Shared infrastructure
supports separate domain heads and encoders. Inferred profile statements expose
supporting events, uncertainty, recency, and correction/delete controls.

The first trainable head is a regularized contextual logistic preference model:

`P(A > B | user, domain, context) = sigmoid(s(A) - s(B))`

`score = declared/Jev prior + learned personal feature weights`

The features include content representations, Jev judgments, and scoped context.
Unlike a per-item win count or Elo-only table, content features allow the model to
attempt predictions for previously unseen items. Sparse labels stay close to the
prior; do not imply that a fixed number of choices guarantees accuracy. Update
weights after valid explicit choices, persist a model version, and rerank locally.

Keep a small versioned feature schema initially. Do not let an LLM invent a new
incompatible feature space on every query. Feature discovery and richer heads can
be evaluated later without losing original observations.

### Current Jev boundary

Official TypeSafe documentation states that Jev 1.13 accepts text only and does not
provide customer-specific fine-tuning/LoRA. It supports domain context and questions,
and explicitly describes downstream supervised models built on Jev probabilities.
Therefore:

- LLM: clarification, retrieval planning, grounded unit generation, optional explanation.
- Jev: fast, bounded semantic judgments on textual state.
- Personal head: actual user-specific parameter updates and preference predictions.
- Image encoder/vision model: cached visual features for image preference learning.
  A caption-to-Jev bridge can help with semantic attributes but loses visual detail.

This is supervised preference learning first. No RL infrastructure is required to
prove that the model learns. Future trainable classifiers or adapters are separate
experiments; do not call the hosted Jev model fine-tuned. In particular, the linked
Together tutorial trains a separate Jev-like Tev classifier.

## Arena and datasets

A versioned dataset pack includes items/assets, domain, comparison prompt, feature
schema, provenance, and train/evaluation partitions. Search sessions can become
packs; curated packs and user JSON/CSV/image imports use the same contract.

- Offer **tournament** mode for play and **learn my taste** mode for efficient learning.
- A comparison can be A, B, equal, neither, or skip, with optional reason and undo.
  Equal/neither/skip are distinct outcomes; they do not all become a directional label.
- Randomize display side and retain exposure order. Record only comparisons made:
  a tournament winner has not directly beaten every other item in the dataset.
- Select informative pairs using uncertainty plus feature coverage and a small
  random exploration share. Avoid repeatedly asking indistinguishable pairs.
- Predict before the user answers, hide that prediction until after the choice,
  then show the result. Evaluation must not use the answer before scoring it.
- Use a short training round, then genuinely unseen test items. For example, 20–30
  comparisons followed by ten test pairs is a demo protocol, not an accuracy guarantee.
- Display “7 of 10 next choices predicted” with domain, sample size, and model version;
  never a fabricated “87% understands you” meter.

The first image-pack theme is awaiting the user's choice. An adult public-person
portrait pack, UI/design pack, or content pack can demonstrate the same architecture.
Images must have inspectable provenance; imports should preserve original asset
references rather than reconstruct images from textual descriptions.

## Observation ledger and storage

Replace the single JSON workspace row as the new feature's primary store with
normalized SQLite tables and migrations, while preserving existing data. Suggested
entities: search_sessions, search_attempts, sources/source_versions, information_units,
unit_versions, datasets/dataset_items, exposures, comparisons, profile_facts,
feature_vectors, model_versions, predictions, ranking_runs, and job_events.

An exposure records what was actually shown, order/visibility, selection policy,
query/context/profile/model versions, and timestamps. Record selection probability
only where the policy actually knows it.

A comparison references that exposure, exact item versions, the question/context,
choice, optional reason, explicit/implicit origin, and the prediction made beforehand.
Undo/correction appends an event and rebuilds affected derived state. Intentional
user data deletion removes selected raw and derived data and invalidates/rebuilds
models; audit-style append-only behavior is not an excuse to prevent deletion.

Clicks, dwell, saves, and skips are observations. Initially train primarily on
explicit comparisons; collect implicit signals without treating every unclicked
or unseen item as a rejection. Introduce weak implicit training only after validating
its effect against explicit held-out choices. Never train on Jev's own predictions
as though they were the user's answers.

Export both raw versioned observations and separately derived training rows. This
makes the personal dataset portable across later models and encoders.

## Retrieval integration and harness

Use the installed AI SDK and existing AI Gateway authentication first. The preferred
adapter is Gateway Exa for source URLs plus extracted text/highlights; Parallel is
an alternative for objective-driven query branches. A small implementation spike
must verify this account's search access, MiMo tool behavior, raw tool-result events,
Korean retrieval quality, and actual usage before choosing the final adapter.

Keep search/tool execution separate from structured JSON synthesis, preserving the
existing MiMo compatibility fix. Source cards can only cite registered source IDs.
Reuse the current public-network-safe extractor, exact quote checks, Jev contract,
provider-error sanitization, concurrency limits, and interruption handling.

Persist the session state machine: interpreting → awaiting clarification → searching
→ grounding units → ranking → awaiting refinement → completed/partial/failed/cancelled.
Do not hold an inference request open while awaiting a human answer. Resume from
checkpointed state. Stream factual job events; never advance progress by a timer.

Cap search rounds, source extraction, generated units, Jev concurrency, and retries.
Expose partial results and costs/usage when available. Separate caches for source
content, generated units, semantic features, and profile-dependent ranking. A choice
should usually trigger a cheap local update rather than repeating source retrieval.

## Delivery order and acceptance

| Phase | Concrete deliverable | Acceptance |
|---|---|---|
| 0. Capability check | Small real search + source output; image feature route | Registered real URLs, usable excerpts, credential-safe trace; account access verified |
| 1. Shared foundation | Versioned units, datasets, exposures, comparisons, model store | Persist/reload/export, deterministic undo/rebuild, no duplicate training events |
| 2. Search vertical slice | Query → useful questions → real sources → grounded units → Jev ranking | A real query works end to end; source browsing and skip remain available; no fixture substitution |
| 3. Actual personal learning | Pairwise head + compare cards + immediate reranking | Weights/model versions change from genuine choices; a new query uses the saved model |
| 4. Arena + image adapter | Dataset import, tournament/active mode, image features, blind prediction | New-item predictions recorded before answers; ties/skip/undo work; image inference is honestly labeled |
| 5. Unified product verification | Profile editor, history/export/delete, contextual reranking and animations | Search and Arena share infrastructure while respecting domain boundaries; browser-to-model-to-store checks pass |

Reuse React/Node/SQLite and the current design system for this local release. A
framework migration is not required to test the product. Hosted multi-user accounts
and a production database can follow once the learning loop is useful.

## Evidence of success

- Search: time to first useful source/card, traceable citations, duplicates, unsupported
  synthesis, task completion, and changes after a meaningful clarification.
- Learning: chronological next-choice accuracy, log loss/Brier score, sample counts,
  and comparison with initial/Jev-only and random baselines.
- Generalization: hold out items/entities, grouping alternate photos of one person
  and duplicate source passages. A model that memorizes compared items is insufficient.
- UX: users can inspect all sources, correct remembered facts, choose neither, undo,
  see why a ranking changed, and leave without another required question.
- Integrity: reloads preserve data, stale model/context outputs cannot masquerade as
  current, cancellation works, and no provider token or personal dataset is committed.

The desired demonstration is: ask a real question, shape the information, make a few
comparisons, return later, and observe an auditable prediction on something new.
Improvement is measured and reported, not asserted by animations.

## References

- [Vercel AI Gateway search](https://vercel.com/docs/ai-gateway/models-and-providers/web-search)
- [TypeSafe model inputs and customization](https://docs.typesafe.ai/models)
- [TypeSafe downstream feature-learning cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)
- [OpenRouter Jev](https://openrouter.ai/docs/guides/community/jev)
- [RankNet: learning to rank using gradient descent](https://www.microsoft.com/en-us/research/publication/learning-to-rank-using-gradient-descent/)
- [Active preference learning in/out of sample](https://arxiv.org/abs/2405.03059)
- [Learning to rank from biased feedback](https://www.microsoft.com/en-us/research/publication/unbiased-learning-rank-biased-feedback/)
- [Together's Jev-like classifier training tutorial](https://www.together.ai/blog/how-to-train-your-own-jev)
