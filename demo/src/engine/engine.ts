import type { Article, Goal, ShiftAudit, Vec8 } from './types'

export const dot = (a: Vec8, b: Vec8) => a.reduce((s, v, i) => s + v * b[i], 0)
export const norm = (a: Vec8) => Math.sqrt(dot(a, a))
export const sub = (a: Vec8, b: Vec8) => a.map((v, i) => v - b[i])
export const scale = (a: Vec8, k: number) => a.map((v) => v * k)

/** normalized goal direction û */
export function unit(u: Vec8): Vec8 {
  const n = norm(u)
  return n === 0 ? u.map(() => 0) : scale(u, 1 / n)
}

/**
 * Readiness attenuation: an article of difficulty d is fully absorbed when the
 * user's relevant knowledge is near d, and attenuated when far below it.
 */
export function readiness(P: Vec8, gain: Vec8, difficulty: number): number {
  const g = norm(gain)
  if (g === 0) return 0
  // knowledge relevant to this article = projection of P onto the gain direction
  const rel = dot(P, gain) / g
  const gap = difficulty - rel
  return gap <= 0 ? 1 : Math.max(0.15, 1 - gap * 1.6)
}

/** Transition model f(P, x): diminishing returns + readiness attenuation. */
export function transition(P: Vec8, x: Article): Vec8 {
  const r = readiness(P, x.gain, x.difficulty)
  return P.map((p, i) => Math.min(1, p + x.gain[i] * (1 - p) * r))
}

/** Goal-projected value V(x | P, u) = ⟨f(P,x) − P, û⟩ */
export function value(P: Vec8, x: Article, u: Vec8): number {
  return dot(sub(transition(P, x), P), unit(u))
}

/** Decompose a realized state change into on-goal (∥) and off-goal (⊥) parts. */
export function decompose(dP: Vec8, u: Vec8): { par: number; perp: number } {
  const uh = unit(u)
  const par = dot(dP, uh)
  const parVec = scale(uh, par)
  const perp = norm(sub(dP, parVec))
  return { par, perp }
}

export const accumulateAudit = (a: ShiftAudit, dP: Vec8, u: Vec8): ShiftAudit => {
  const { par, perp } = decompose(dP, u)
  return { onGoal: a.onGoal + Math.max(0, par), offGoal: a.offGoal + perp }
}

// ---------- Rankers ----------

export function rankByEngagement(items: Article[]): Article[] {
  return [...items].sort((a, b) => b.engagement - a.engagement)
}

/** Baseline: goal-conditioned LLM re-ranker — topic relevance, blind to user state. */
export function rankByLLM(items: Article[], goal: Goal): Article[] {
  const score = (x: Article) => {
    const hits = x.tags.filter((t) => goal.keywords.includes(t)).length
    return hits * 10 + x.engagement // relevance first, virality tie-break
  }
  return [...items].sort((a, b) => score(b) - score(a))
}

/** ValueRank: rank by predicted goal-projected state change. */
export function rankByValue(items: Article[], P: Vec8, u: Vec8): Article[] {
  return [...items].sort((a, b) => value(P, b, u) - value(P, a, u))
}

/** Goal progress: current position along û, 0..1-ish. */
export const goalProgress = (P: Vec8, u: Vec8) => dot(P, unit(u)) / (norm(unit(u)) || 1)
