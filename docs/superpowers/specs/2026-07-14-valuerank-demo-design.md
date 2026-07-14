# ValueRank VC Demo — Design Spec (2026-07-14)

## Goal
Polished, fully client-side simulated demo of ValueRank (goal-projected user-state-change ranking) for VC presentations. Real projection math over simulated data; zero network calls; `npm i && npm run dev`.

## Stack
Vite + React + TypeScript, Tailwind CSS v4, Recharts (radar + line charts), framer-motion (re-rank animations).

## Domain
Tech/news reading. 8-axis knowledge basis: ML Systems, Chips & Compute, Energy, Policy & Regulation, Markets & Finance, Biotech, Security, Product & Design.

## Core engine (src/engine/)
- Profile state `P ∈ R^8` (0..1 per axis).
- Each article has hidden gain vector `g ∈ R^8`, difficulty `d`, engagement score `e`.
- Transition: `f(P, x) = P + g ⊙ (1 − P) ⊙ readiness(P, d)` — diminishing returns + readiness attenuation.
- Value: `V(x|P,u) = ⟨f(P,x) − P, u⟩` with `u` normalized goal weights.
- Shift audit: decompose realized ΔP into ΔP∥ (projection onto u) and ΔP⊥; running ‖ΔP⊥‖ with threshold.
- Rankers: engagement (by e), LLM re-ranker (keyword/topic relevance to goal, ignores state), ValueRank (by V, re-ranked after every read).

## UI zones
1. **Goal bar (top):** NL goal input + preset goals; "encoding" shimmer → editable per-axis weight sliders; edits re-rank instantly.
2. **Feed bake-off (center):** three columns (Engagement / LLM Re-ranker / ValueRank) over same ~40-article corpus; ValueRank cards show V score + ΔP sparkline.
3. **Session simulator (left):** radar chart of P with goal overlay; "Read" per article and "Auto-run ×10"; cumulative goal-progress line: ValueRank vs engagement counterfactual.
4. **Shift audit (right):** live ΔP∥/ΔP⊥ meters, running off-goal drift, mode toggle (ValueRank vs engagement policy) showing drift spike.

## Data
Hand-curated `src/data/articles.ts` (~40 realistic articles: title, source, per-axis gains, engagement score, topic tags) + 4 preset goals with basis weights.

## Testing
Vitest unit tests for engine math (projection, diminishing returns, ΔP decomposition, ranker ordering). UI verified by running the app.
