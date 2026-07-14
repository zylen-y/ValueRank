import { describe, expect, it } from 'vitest'
import {
  accumulateAudit,
  decompose,
  rankByEngagement,
  rankByLLM,
  rankByValue,
  transition,
  value,
} from './engine'
import type { Article, Goal, Vec8 } from './types'

const zeros: Vec8 = Array(8).fill(0)
const art = (over: Partial<Article>): Article => ({
  id: 'a',
  title: 't',
  source: 's',
  minutes: 5,
  gain: zeros,
  difficulty: 0,
  engagement: 0.5,
  tags: [],
  ...over,
})

describe('transition', () => {
  it('applies diminishing returns as an axis fills', () => {
    const x = art({ gain: [0.4, 0, 0, 0, 0, 0, 0, 0] })
    const low = transition([0, ...zeros.slice(1)], x)[0]
    const high = transition([0.8, ...zeros.slice(1)], x)[0] - 0.8
    expect(low).toBeCloseTo(0.4)
    expect(high).toBeLessThan(low)
    expect(high).toBeCloseTo(0.4 * 0.2)
  })

  it('attenuates gain when the article is far above the user readiness', () => {
    const hard = art({ gain: [0.4, 0, 0, 0, 0, 0, 0, 0], difficulty: 0.9 })
    const gained = transition(zeros, hard)[0]
    expect(gained).toBeLessThan(0.4)
    expect(gained).toBeGreaterThan(0)
  })

  it('never exceeds 1', () => {
    const x = art({ gain: Array(8).fill(0.9) })
    for (const v of transition(Array(8).fill(0.95), x)) expect(v).toBeLessThanOrEqual(1)
  })
})

describe('value & decompose', () => {
  const u: Vec8 = [1, 0, 0, 0, 0, 0, 0, 0]

  it('scores on-goal gain higher than off-goal gain', () => {
    const on = art({ gain: [0.3, 0, 0, 0, 0, 0, 0, 0] })
    const off = art({ gain: [0, 0.3, 0, 0, 0, 0, 0, 0] })
    expect(value(zeros, on, u)).toBeGreaterThan(value(zeros, off, u))
    expect(value(zeros, off, u)).toBeCloseTo(0)
  })

  it('decomposes ΔP exactly into parallel and perpendicular parts', () => {
    const dP: Vec8 = [0.3, 0.4, 0, 0, 0, 0, 0, 0]
    const { par, perp } = decompose(dP, u)
    expect(par).toBeCloseTo(0.3)
    expect(perp).toBeCloseTo(0.4)
    expect(Math.hypot(par, perp)).toBeCloseTo(0.5)
  })

  it('accumulates audit magnitudes', () => {
    const a = accumulateAudit({ onGoal: 0, offGoal: 0 }, [0.1, 0.2, 0, 0, 0, 0, 0, 0], u)
    expect(a.onGoal).toBeCloseTo(0.1)
    expect(a.offGoal).toBeCloseTo(0.2)
  })
})

describe('rankers', () => {
  const goal: Goal = {
    id: 'g',
    label: 'g',
    text: '',
    weights: [1, 0, 0, 0, 0, 0, 0, 0],
    keywords: ['ml'],
  }
  const clickbait = art({ id: 'cb', engagement: 0.99, tags: ['ml'], gain: [0.02, 0, 0, 0, 0, 0, 0, 0] })
  const explainer = art({ id: 'ex', engagement: 0.3, tags: [], gain: [0.4, 0.05, 0, 0, 0, 0, 0, 0] })

  it('engagement surfaces clickbait; ValueRank surfaces the explainer', () => {
    expect(rankByEngagement([explainer, clickbait])[0].id).toBe('cb')
    expect(rankByValue([clickbait, explainer], zeros, goal.weights)[0].id).toBe('ex')
  })

  it('LLM re-ranker prefers topical tags regardless of state change', () => {
    expect(rankByLLM([explainer, clickbait], goal)[0].id).toBe('cb')
  })

  it('ValueRank re-orders after state changes (diminishing returns)', () => {
    const a1 = art({ id: 'a1', gain: [0.5, 0, 0, 0, 0, 0, 0, 0] })
    const a2 = art({ id: 'a2', gain: [0.3, 0.3, 0, 0, 0, 0, 0, 0] })
    const u2: Vec8 = [1, 1, 0, 0, 0, 0, 0, 0]
    expect(rankByValue([a1, a2], zeros, u2)[0].id).toBe('a2')
    // after axis 0 saturates, a1 loses value
    const P: Vec8 = [0.95, 0, 0, 0, 0, 0, 0, 0]
    expect(rankByValue([a1, a2], P, u2)[0].id).toBe('a2')
    expect(value(P, a1, u2)).toBeLessThan(value(zeros, a1, u2))
  })
})
