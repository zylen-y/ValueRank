/** Choose at most five readings that fit a real minute budget. Scores are utility, not probabilities. */
export function selectSession<T extends { id: string; score: number | null; readingMinutes: number; status: string; decision: { relevance: number; novelty: number } | null }>(items: T[], minutes: number): T[] {
  const budget = Math.max(0, Math.min(60, Math.floor(minutes)));
  // A spare minute is better than filling the plan with off-goal or familiar content.
  const candidates = items.filter(item => item.status === 'completed' && item.decision && item.decision.relevance >= .45 && item.decision.novelty >= .4 && item.score !== null && item.score > 0 && Number.isFinite(item.readingMinutes) && item.readingMinutes > 0);
  const plans: { value: number; items: T[] }[][] = Array.from({ length: 6 }, () => Array.from({ length: budget + 1 }, () => ({ value: 0, items: [] })));
  for (const item of candidates) {
    const cost = Math.ceil(item.readingMinutes);
    for (let count = 5; count >= 1; count--) for (let time = budget; time >= cost; time--) {
      const previous = plans[count - 1][time - cost];
      const value = previous.value + item.score!;
      if (value > plans[count][time].value) plans[count][time] = { value, items: [...previous.items, item] };
    }
  }
  return plans.flat().reduce((best, plan) => plan.value > best.value ? plan : best).items.toSorted((a, b) => b.score! - a.score! || a.id.localeCompare(b.id));
}
