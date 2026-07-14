import type { Goal } from '../engine/types'

// axes: [ML Systems, Chips & Compute, Energy, Policy, Markets, Biotech, Security, Product]
export const GOALS: Goal[] = [
  {
    id: 'ai-infra',
    label: 'AI Infrastructure',
    text: 'Become fluent in AI infrastructure — models, chips, and the energy that powers them',
    weights: [0.95, 0.85, 0.55, 0.1, 0.25, 0, 0.15, 0.1],
    keywords: ['ai', 'ml', 'chips', 'datacenter', 'energy'],
  },
  {
    id: 'climate',
    label: 'Climate Tech Economics',
    text: 'Understand the economics of climate and energy technology',
    weights: [0.1, 0.2, 0.95, 0.6, 0.8, 0.1, 0, 0.1],
    keywords: ['energy', 'climate', 'markets', 'policy'],
  },
  {
    id: 'security',
    label: 'AI Security Leader',
    text: 'Get ready to lead security for an AI-native company',
    weights: [0.6, 0.15, 0, 0.5, 0.1, 0, 0.95, 0.2],
    keywords: ['security', 'ai', 'policy'],
  },
  {
    id: 'bio',
    label: 'Bio × AI Investor',
    text: 'Evaluate biotech startups that use AI at their core',
    weights: [0.6, 0.1, 0, 0.3, 0.7, 0.95, 0, 0.15],
    keywords: ['biotech', 'ai', 'markets'],
  },
]

/**
 * Toy NL→u encoder: keyword → axis-weight contributions.
 * In the real system this is a learned encoder onto a declared, auditable basis.
 */
const LEXICON: Array<[RegExp, number[], string[]]> = [
  [/\b(ai|ml|model|llm|machine learning|inference|training)\b/i, [0.9, 0.3, 0, 0, 0, 0, 0, 0], ['ai', 'ml']],
  [/\b(chip|gpu|semiconductor|compute|hardware|fab)\b/i, [0.2, 0.95, 0.1, 0, 0, 0, 0, 0], ['chips']],
  [/\b(energy|power|grid|climate|nuclear|solar|datacenter)\b/i, [0, 0.15, 0.95, 0.15, 0, 0, 0, 0], ['energy', 'climate', 'datacenter']],
  [/\b(policy|regulation|law|government|compliance)\b/i, [0, 0, 0, 0.95, 0.1, 0, 0.1, 0], ['policy']],
  [/\b(market|finance|invest|econom|valuation|ipo)\b/i, [0, 0, 0, 0.15, 0.95, 0, 0, 0], ['markets']],
  [/\b(bio|drug|pharma|protein|genom|health)\b/i, [0.15, 0, 0, 0.1, 0, 0.95, 0, 0], ['biotech']],
  [/\b(security|cyber|threat|vulnerab|attack)\b/i, [0.1, 0, 0, 0.1, 0, 0, 0.95, 0], ['security']],
  [/\b(product|design|ux|user|founder|startup)\b/i, [0, 0, 0, 0, 0.2, 0, 0, 0.95], ['product']],
]

export function encodeGoal(text: string): Goal {
  const weights = Array(8).fill(0)
  const keywords = new Set<string>()
  for (const [re, w, kw] of LEXICON) {
    if (re.test(text)) {
      w.forEach((v, i) => (weights[i] = Math.max(weights[i], v)))
      kw.forEach((k) => keywords.add(k))
    }
  }
  if (weights.every((w) => w === 0)) weights[0] = 0.5 // fallback
  return { id: 'custom', label: 'Custom goal', text, weights, keywords: [...keywords] }
}
