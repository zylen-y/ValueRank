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
| `VALUERANK_LLM_MODEL` | Optional Gateway model; default `xiaomi/mimo-v2.6-flash` |
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

MiMo was verified through this account's Gateway free-tier access. OpenAI GPT-6 Luna
returned HTTP 403 because that model required purchased credits on this account.
Choose an account-eligible model or enable paid access before changing the setting.
See the [Gateway eligibility filter](https://vercel.com/ai-gateway/models?freeTier=true).

The harness separates source-tool selection from JSON synthesis. MiMo's route uses
JSON mode, with the complete schema supplied in the trusted prompt and validated
locally; valid JSON alone is never enough. Reasoning is disabled for this routine
MiMo extraction. See [MiMo JSON mode](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/text-generation/structured-output)
and [Gateway reasoning controls](https://vercel.com/docs/ai-gateway/models-and-providers/reasoning).

`npm run dev` launches the API at `127.0.0.1:8787` and UI at `127.0.0.1:5188`.
`npm run build && npm start` serves the compiled app and API together at port 8787.
The personal database is `.data/valuerank.sqlite`. A custom path is available via
`VALUERANK_DB_PATH`, useful for isolated tests. `API_PORT` changes the API port;
update the Vite proxy too if changing it in development.

## Inference budget

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
