import { describe, expect, it } from 'vitest';
import { selectSession } from './session';
const item = (id: string, score: number, readingMinutes: number, status = 'completed') => ({ id, score, readingMinutes, status, decision: { relevance: .8, novelty: .9 } });
describe('a reading session with a bounded time budget', () => {
  it('finds a better combination than just taking the highest score first', () => {
    expect(selectSession([item('a', 95, 10), item('b', 65, 5), item('c', 60, 5)], 10).map(i => i.id)).toEqual(['b', 'c']);
  });
  it('excludes unfinished sources, never duplicates, and caps the plan at five', () => {
    const choices = Array.from({length: 20}, (_, i) => item(String(i), 90 - i, 3));
    const result = selectSession([...choices, item('pending', 100, 1, 'running')], 30);
    expect(result).toHaveLength(5); expect(new Set(result.map(i => i.id)).size).toBe(5);
    expect(result.some(i => i.id === 'pending')).toBe(false);
    expect(result.reduce((n, i) => n + i.readingMinutes, 0)).toBeLessThanOrEqual(30);
  });
  it('returns no recommendation if nothing fits and rounds fractional costs upward', () => {
    expect(selectSession([item('a', 99, 11)], 10)).toEqual([]);
    expect(selectSession([item('a', 70, 5.4), item('b', 70, 5.4)], 11)).toHaveLength(1);
  });
  it('leaves spare time instead of filling the plan with unrelated or familiar items', () => {
    const unrelated = { ...item('noise', 99, 3), decision: { relevance: .14, novelty: .99 } };
    const familiar = { ...item('known', 99, 3), decision: { relevance: .95, novelty: .2 } };
    expect(selectSession([item('useful', 80, 6), unrelated, familiar], 20).map(i => i.id)).toEqual(['useful']);
  });
});
