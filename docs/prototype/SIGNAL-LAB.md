# Signal Lab: turn a backlog into a session

The original workspace showed ranked cards without a compelling before-and-after.
Signal Lab starts with a concrete constraint: a language-learning founder has twenty
minutes and 48 possible readings. Jev screens the candidates; a budgeted selector
returns a small plan that fits. Feedback from saved readings enters the existing
knowledge and preference loop.

## The working demonstration

1. Open Signal Lab. Choose a direction, known concepts, and a 10/20/30-minute budget.
2. Find my signal performs **48 actual Jev requests with six concurrent workers**.
   There is no LLM generation during this screening phase.
3. Tiles transition on real queued/running/completed events. The processor glow,
   moving connections, count, throughput, tokens, and ranking transitions follow
   the current run. Inspect any tile for source text and actual probabilities.
4. A knapsack selector chooses at most five candidates within the time budget.
   Relevance below 45% or novelty below 40% excludes a brief; unused time is better
   than irrelevant filler. The score is heuristic utility, not a calibrated outcome.
5. Save the session to the persistent reading queue. A different workspace profile
   intentionally does not inherit the Lab's Jev decisions; the confirmation explains
   that fresh evaluation is needed. The existing workspace profile is preserved.
6. Replay this run animates the saved completion timestamps over nine seconds,
   prominently marked as a recorded run. It makes no model requests. The timer
   stops after playback. Live inference is never slowed down for the animation.

## Observed live result — 26 September 2026

| Measurement | Actual observation |
|---|---|
| Provider / model | OpenRouter / `typesafe/jev-1.13-20260917` |
| Corpus | 48 original, source-linked editorial briefs |
| Concurrency | 6 HTTP requests; not a native batch API |
| Wall-clock duration | **2,197 ms** |
| Completed / errors | 48 / 0 |
| Typed forecasts | 144: relevance, novelty, actionability per brief |
| Reported tokens | 50,322 |
| Observed throughput | 21.85 briefs/second |
| Forecast buckets | 12 candidates; 36 outside the selected goal; 0 classified familiar |
| Selected session | 4 readings / 20 editorial-estimated minutes |

This is one measured run on short prepared briefs, not 48 full articles fetched
and summarized in two seconds. It is not a general latency, accuracy, or calibration
benchmark. The corpus contains original editorial interpretations with primary-source
links. It does not claim to be publisher-authored text. See [sources](BURST-SOURCES.md)
and [sanitized live measurements](signal-live-verification.json).

## Verification

- 216 automated tests pass; lint and production build pass.
- The actual browser started the real run; all 48 validated responses appeared.
- Budgets produced 2 readings / 10 minutes, 4 / 20, and 5 / 26 within a 30-minute budget.
- Save added three briefs and skipped one existing source. No off-profile decision
  was copied to the queue. The profile itself was preserved.
- Completed results survived API restarts; replay finished and stopped its timer.
- The 390px mobile viewport had a 390px document width, no overflow or NaN values.
- Reduced-motion styles suppress motion; ranking movement also checks the preference.
- Provider failures stop dispatch where appropriate; cancellation, six-worker limits,
  checkpoint recovery, and budgeting have targeted automated coverage.

## Design direction

The interface uses Geist typography, a neutral high-contrast shell, fine borders,
restrained elevation, and one lilac/blue decision visualization. Motion explains
processing and changes in priority rather than concealing waiting.

References: [Geist](https://vercel.com/geist),
[colors](https://vercel.com/geist/colors),
[materials](https://vercel.com/geist/materials),
[typography](https://vercel.com/geist/typography),
[Apple motion](https://developer.apple.com/design/human-interface-guidelines/motion).
The implementation is inspired by these systems; it is not an official Vercel or
Apple component package.

## What would make this indispensable

The durable product is a daily learning decision, not an endless recommendation feed:

- **Capture without effort.** A unified inbox for subscriptions, saved links, papers,
  and transcripts. Keep stable source provenance and process content once.
- **Commit to a feasible session.** Rank for a current project and a real time budget;
  expose what was excluded and why. Keep diversity and prerequisites explicit.
- **Measure what survives.** A recall prompt, a short implementation task, or an actual
  language-learning response gives a stronger signal than clicks or dwell time.
- **Make tomorrow better.** Store observations separately from inferred knowledge,
  let people correct both, and evaluate whether the next session repeats less while
  increasing useful recall or project progress.
- **Build trust before fine-tuning.** Keep forecasts, exposures, corrections, and outcomes
  auditable. Evaluate ranking quality and calibration on held-out observations before
  spending on personalized training.

Automatic subscription ingestion, mastery measurement, and fine-tuning are product
next steps, not features claimed by this prototype. Signal Lab demonstrates the
fast screening and session-selection layer that such a product would need.
