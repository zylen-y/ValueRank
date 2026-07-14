# ValueRank

**Rank information by what it does to you, not what you click.**

ValueRank scores content by the predicted, goal-projected change it causes in the
user's own knowledge state — `V(x | P, u) = ⟨f(P,x) − P, û⟩` — where the goal
direction `u` is explicitly declared by the user, not inferred from engagement.

- **[`demo/`](demo/)** — interactive prototype (Vite + React). Three-feed bake-off
  (engagement vs. LLM re-ranker vs. ValueRank), live goal steering with editable
  basis sliders, session simulator, and a live ΔP∥/ΔP⊥ shift audit.
  See [demo/README.md](demo/README.md) for the run instructions and pitch walkthrough.
- **[`docs/`](docs/)** — design spec for the demo.

## Quick start

```bash
cd demo
npm install
npm run dev
```
