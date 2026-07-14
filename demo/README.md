# ValueRank — Interactive Demo

> **Rank information by what it does to you, not what you click.**

A simulated but mathematically real prototype of ValueRank: items are scored by
`V(x | P, u) = ⟨f(P,x) − P, û⟩` — the predicted change an article causes in *your*
knowledge state, projected onto a goal direction *you* declared. All projection math,
diminishing returns, and the ΔP∥/ΔP⊥ shift audit are computed live in the browser.
Data (articles, gain vectors, engagement scores) is hand-curated simulation data.

## Run

```bash
npm install
npm run dev
```

Tests (engine math): `npx vitest run`

## 3-minute pitch walkthrough

1. **The problem, visible at a glance.** Left feed = today's internet, ranked by
   engagement: pure clickbait on top. Middle feed = the obvious "fix" (an LLM
   re-ranker conditioned on your goal): still surfaces viral content *about* your
   topic — relevance isn't value.

2. **Declare a goal.** Type anything ("understand climate tech economics") or click a
   preset. The goal is encoded onto 8 human-auditable knowledge axes — and the weights
   are **editable sliders**, not a black box.

3. **The ValueRank column.** Each card shows its live V score and a ΔP sparkline: the
   predicted per-axis change in *you*. Deep explainers beat clickbait because clickbait
   doesn't change you.

4. **Auto-run ×10.** Watch the radar chart (your state) grow toward the dashed goal
   outline, and the cumulative-progress chart diverge from the engagement-feed
   counterfactual (same person, same 10 reads, today's ranking). The feed re-ranks
   after every read — diminishing returns are modeled, so it never recommends what you
   already know.

5. **Steer live.** Drag any slider or switch presets: the ranking re-orients instantly,
   **no retraining** — value is a projection, so changing the goal is just rotating a
   vector.

6. **The safety story (right panel).** Because value is a projection, every induced
   change in the user decomposes exactly into on-goal (ΔP∥) and off-goal (ΔP⊥) drift.
   The engagement counterfactual trips the audit warning; ValueRank doesn't. Influence
   becomes *measurable*, not assumed away.

## What's simulated vs. real

- **Real:** transition model shape, projection math, ranking, diminishing returns,
  readiness attenuation, shift-audit decomposition, steerability.
- **Simulated:** the article corpus and its hidden gain vectors, the engagement scores,
  and the NL→basis goal encoder (keyword lexicon standing in for a learned encoder).

Based on the ValueRank research proposal (v4, July 2026).
