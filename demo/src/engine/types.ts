export const AXES = [
  'ML Systems',
  'Chips & Compute',
  'Energy',
  'Policy & Regulation',
  'Markets & Finance',
  'Biotech',
  'Security',
  'Product & Design',
] as const

export type Vec8 = number[] // length 8, one entry per axis

export interface Article {
  id: string
  title: string
  source: string
  minutes: number
  /** hidden per-axis knowledge gain (0..1) */
  gain: Vec8
  /** difficulty 0..1 — how much prior knowledge is needed to absorb it */
  difficulty: number
  /** simulated engagement/virality score 0..1 */
  engagement: number
  /** topic tags used by the LLM re-ranker baseline */
  tags: string[]
  clickbait?: boolean
}

export interface Goal {
  id: string
  label: string
  text: string
  /** declared basis weights u (unnormalized, 0..1) */
  weights: Vec8
  /** keywords the LLM re-ranker matches on */
  keywords: string[]
}

export interface ShiftAudit {
  /** cumulative on-goal magnitude ‖ΔP∥‖ */
  onGoal: number
  /** cumulative off-goal magnitude ‖ΔP⊥‖ */
  offGoal: number
}
