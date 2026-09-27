# ValueRank application

React + Vite + TypeScript frontend, a local Node HTTP API, SQLite, Vercel AI SDK,
and the official TypeSafe Jev SDK. Node 24 or newer is required for built-in SQLite.

## Configuration

Copy `.env.example` to `.env.local` and set:

| Variable | Purpose |
|---|---|
| `AI_GATEWAY_API_KEY` | Server-side Vercel AI Gateway authentication |
| `OPENROUTER_API_KEY` | Server-side OpenRouter authentication for real Jev; no TypeSafe account needed |
| `TYPESAFE_API_KEY` | Optional alternative: direct TypeSafe authentication |
| `VALUERANK_LLM_MODEL` | Optional Gateway model; default `alibaba/qwen3.8-flash` |
| `VALUERANK_JEV_PROVIDER` | `auto` (default), `openrouter`, or `typesafe`; auto prefers a configured OpenRouter key |
| `VALUERANK_OPENROUTER_JEV_MODEL` | Optional OpenRouter Jev model; default `typesafe/jev-1.13` |
| `VALUERANK_JEV_MODEL` | Optional direct TypeSafe model; default pinned `jev-1.13.0` |

Gateway keys: https://vercel.com/docs/ai-gateway/authentication
OpenRouter Jev setup: https://openrouter.ai/docs/guides/community/typesafe-sdk
Direct TypeSafe API: https://docs.typesafe.ai/api

The LLM runs through Vercel AI Gateway. Jev runs through the selected provider;
only that provider's key is sent to its fixed endpoint. Provider selection happens
before the run, with no automatic switch after a failure. The UI shows the selected
route, and persisted decisions record the route and the model snapshot returned.
Direct and OpenRouter model settings are separate because their model IDs differ.

The current Gateway model ID was checked against the live model catalog during
implementation. Availability can change. Configuration errors are visible in the
pipeline; the app never substitutes a model response with a simulated one.

Qwen 3.8 Flash was verified through this account's Gateway key. Routine generation
requests reasoning off; the completed search reported zero reasoning tokens.
MiMo remains an optional route, but repeated 90-second timeouts occurred during
the final search verification. Earlier MiMo runs did complete successfully.
OpenAI GPT-6 Luna
returned HTTP 403 because that model required purchased credits on this account.
Choose an account-eligible model or enable paid access before changing the setting.
See the [Gateway eligibility filter](https://vercel.com/ai-gateway/models?freeTier=true).

The harness separates source-tool selection from JSON synthesis. MiMo's route uses
JSON mode, with the complete schema supplied in the trusted prompt and validated
locally; valid JSON alone is never enough. Reasoning is disabled for this routine
MiMo extraction and the default Qwen routine calls. See [MiMo JSON mode](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output)
and [Gateway reasoning controls](https://vercel.com/docs/ai-gateway/models-and-providers/reasoning).

`npm run dev` launches the API at `127.0.0.1:8787` and UI at `127.0.0.1:5188`.
`npm run build && npm start` serves the compiled app and API together at port 8787.
The earlier reading database is `.data/valuerank.sqlite`. A custom path is available via
`VALUERANK_DB_PATH`, useful for isolated tests. `API_PORT` changes the API port;
update the Vite proxy too if changing it in development.

## Library, personal search, Arena, and Memory

Library is the default entry, with 2,416 real browser-collected items in 18 collections.
The bundled snapshots automatically populate `.data/catalog.sqlite` on startup.
Browse, compare, undo and rerank with the local metadata model without API calls.
`VALUERANK_CATALOG_DB_PATH` selects a different database and
`VALUERANK_SKIP_CATALOG_SEEDS=1` disables bundled imports. This public catalog is
separate from private preference records.

Use `npm run catalog:import` to reimport bundled captures (idempotently),
`npm run catalog:import -- /path/batch.json` for new normalized observations,
`npm run catalog:stats` for counts, and
`npm run catalog:export -- /path/catalog.json` for a portable metadata snapshot.
The UI also exposes source records; `GET /api/catalog/export` downloads the catalog.
See [actual collection coverage, reproduction and learning limits](../docs/prototype/CATALOG.md).

Search remains available in the navigation. Gateway's Exa tool uses the existing Gateway key; no
separate search key is required. The implementation stores actual tool-returned
URLs and text, validates quotations, scores cards with Jev, and uses a separate
trainable pairwise ranking head. A fresh web exploration takes longer than the
prepared-brief lab benchmark. Source excerpts and partial results remain visible.

Arena provides an original 36-image interface pack, explicit comparisons, tournament
play, and held-out predictions. New image imports use the configured LLM's vision
capability; the verified default supports this. Another configured model must also
support image inputs. Image jobs cache encodings and report actual per-image progress.

The new databases are `.data/personal.sqlite` and `.data/personal-media.sqlite`.
`VALUERANK_PERSONAL_DB_PATH` and `VALUERANK_MEDIA_DB_PATH` permit isolated testing.
`VALUERANK_SKIP_SEEDS=1` suppresses the original design pack on first initialization.
Deleting the pack does not automatically recreate it on restart.

Memory exports the complete personal record, including uploaded image assets.
Selected collection/session deletion removes related observations and refits affected
models. `DELETE /api/personal/data` removes all new personal-engine and image data;
the earlier reading workspace remains separate. Jobs must finish or be cancelled
before deletion. The UI contains no real preference labels until someone chooses.

See [implementation and learning limits](../docs/prototype/PERSONAL-INTELLIGENCE.md).

## Signal Lab

The Lab view screens 48 prepared editorial briefs with real Jev and six concurrent
workers. It uses no LLM generation. Results and actual completion timestamps persist
in `.data/burst.json`; replay makes no API calls. A 10/20/30-minute selector uses only
briefs above the stated relevance and novelty cutoffs. Saving a session preserves
workspace context; off-profile Jev decisions are not reused.

A screening click can make up to 48 logical Jev calls (the SDK can retry eligible
transport failures once). Stop run aborts in-flight requests and preserves completed
results. Reported usage may omit failed/cancelled calls. Screening and the reading
engine cannot run together. See [Signal Lab](../docs/prototype/SIGNAL-LAB.md).

## Reading-engine inference budget

A click processes at most 8 items, one at a time. Each source normally uses two
logical LLM steps (forced source-tool read, then separately validated JSON). If a
response fails JSON parsing or schema validation, one bounded synthesis repair is allowed,
for at most three model calls. Fabricated evidence is rejected without a repair.
Each source then uses one logical Jev call with three questions. Providers may
retry once for eligible transport failures, so HTTP attempts can
exceed logical calls. LLM extraction has a 90-second total deadline; Jev has a
20-second total deadline. The LLM deadline includes any format repair. An item failure stops the batch to avoid repeating an
unavailable provider. A partial run keeps successful results.

Saved LLM notes are reused if the source and extraction-model identity are unchanged.
Sources are immutable in this version. Personalization happens in Jev's request
context and in the separate local ranker; weights of Jev are not updated.

There is no autonomous background inference. Reading the queue and giving feedback
make no paid model calls. Updating a goal/profile makes old Jev decisions stale;
click **Run engine** when you want fresh model judgments.
Use **Analyze this source** inside a reading brief to process exactly one item;
the queue's batch button shows how many sources it will process.

## Data and feedback

Starter items contain authored editorial briefs. Their quote evidence quotes those
briefs, not the linked article. User-pasted and fetched sources retain their own
provenance labels. HTML and plain text are supported; paste excerpts for PDFs,
video transcripts, books, or pages behind a login.

Feedback has two views: the current verdict per item and an append-only history of
sets, replacements, undo operations, and resets. JSONL export includes
`isActiveVerdict`; do not train on canceled or superseded labels by accident.
Events retain the goal, profile version, and feature snapshot at observation time.
They are preference evidence, not measured retention or ground-truth learning gain.

Reset restores the starter profile and removes active feedback while retaining
sources, analyses, and the audit trail. It does not delete personal data. To remove
all locally stored personal data, stop the server and delete the `.data/` directory.

## Tests

`npm test` runs ranking, real SQLite persistence, Jev SDK contract, extraction
boundary, and source-grounding tests. Jev unit tests use a mock transport through
the real SDK and do not consume credits. Live integration verification requires
valid keys and is recorded separately in `docs/prototype/VERIFICATION.md`.
