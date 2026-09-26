# ValueRank application

React + Vite + TypeScript frontend, a local Node HTTP API, SQLite, Vercel AI SDK,
and the official TypeSafe Jev SDK. Node 24 or newer is required for built-in SQLite.

## Configuration

Copy `.env.example` to `.env.local` and set:

| Variable | Purpose |
|---|---|
| `AI_GATEWAY_API_KEY` | Server-side Vercel AI Gateway authentication |
| `TYPESAFE_API_KEY` | Server-side TypeSafe API authentication |
| `VALUERANK_LLM_MODEL` | Optional Gateway model; default `openai/gpt-6-luna` |
| `VALUERANK_JEV_MODEL` | Optional Jev model; default pinned `jev-1.13.0` |

Gateway keys: https://vercel.com/docs/ai-gateway/authentication
TypeSafe setup: https://docs.typesafe.ai/getting-started/quickstart

The current Gateway model ID was checked against the live model catalog during
implementation. Availability can change. Configuration errors are visible in the
pipeline; the app never substitutes a model response with a simulated one.

`npm run dev` launches the API at `127.0.0.1:8787` and UI at `127.0.0.1:5188`.
`npm run build && npm start` serves the compiled app and API together at port 8787.
The personal database is `.data/valuerank.sqlite`. A custom path is available via
`VALUERANK_DB_PATH`, useful for isolated tests. `API_PORT` changes the API port;
update the Vite proxy too if changing it in development.

## Inference budget

A click processes at most 8 items, one at a time. Each source needs at most two
logical LLM steps (forced source-tool read, then structured output), and one logical
Jev call with three questions. The providers may retry once, so HTTP attempts can
exceed logical calls. LLM extraction has a 90-second total deadline; Jev has a
20-second total deadline. An item failure stops the batch to avoid repeating an
unavailable provider. A partial run keeps successful results.

Saved LLM notes are reused if the source and extraction-model identity are unchanged.
Sources are immutable in this version. Personalization happens in Jev's request
context and in the separate local ranker; weights of Jev are not updated.

There is no autonomous background inference. Reading the queue and giving feedback
make no paid model calls. Updating a goal/profile makes old Jev decisions stale;
click **Run engine** when you want fresh model judgments.

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
