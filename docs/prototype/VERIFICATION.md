# Prototype verification — 26 September 2026

## What was checked

| Boundary | Evidence |
|---|---|
| TypeScript and production frontend | `npm run build` passes |
| Static checks | `npm run lint` passes |
| Automated behavior | 157 tests across 7 files pass |
| Dependency audit | 0 known vulnerabilities after compatible patches |
| Browser / API / database | Live UI loaded from port 5188 and received persisted state from port 8787 |
| Real URL extraction | Requested Vercel Jev article imported: 9,130 characters, correct title, `url-extraction` provenance |
| Knowledge feedback | Jev editorial item moved from rank 1 to rank 9 after Already know; undo restored its prior order |
| Goal steering | Web-product goal promoted the Next.js server-boundary reading |
| Reader | Source link, exact quote, concept novelty, and score breakdown inspected in browser |
| Familiar-content compression | All-known React concepts collapse the card to a short review note |
| Input errors | Private/custom-port URL rejected; error displayed inside Add Content dialog |
| Mobile | 390 × 844 viewport, document width 390; no horizontal overflow |
| Browser runtime | No browser errors reported during inspected interactions |
| Secret boundaries | `.env.local`, `.data/`, and `.e2e/` ignored by Git; API exposes key-presence booleans only |

## Automated test scope

- Ranking, goals, known concepts, preferences, score bounds, ties, stale Jev forecasts.
- Real in-memory SQLite transactions, idempotence, replacement/undo, immutable history,
  knowledge overrides, export, and source deduplication.
- Actual TypeSafe SDK serialization with a mocked transport for both direct and
  OpenRouter routes: auth, retries, response schema, model pins/snapshots,
  cancellation, deadlines, and bounded context.
- Provider-specific key/model selection; no TypeSafe key sent to OpenRouter.
- Private/reserved IP and URL boundary cases, exact-source quotation and schema checks.
- Pipeline serialization, eight-item limit, cache reuse, traces, sanitized errors,
  partial failures, and mid-run profile changes.

## Live inference status

**Pending saved API credentials.** The user is preparing `AI_GATEWAY_API_KEY` and
`OPENROUTER_API_KEY`; OpenRouter provides real Jev without a separate TypeSafe key.
No successful real LLM or Jev inference is claimed by this
verification record. SDK and pipeline tests use explicit mocked transports.
The UI labels this state as local ranking and disables Run engine until both keys
are present. Live inference is the remaining acceptance check.

The local database contains demo browser-verification events and the imported
Vercel article. It is not committed. No personal profile or API key was uploaded.
