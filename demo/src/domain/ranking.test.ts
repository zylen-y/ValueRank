import { describe, expect, it } from 'vitest';
import { applyFeedback, rankItems } from './ranking';
import { defaultProfile, seedItems } from './seeds';
import type { ContentItem, Profile, Topic } from './types';

const profile = (patch: Partial<Profile> = {}): Profile => ({
  goal: '', knownConcepts: [], interests: { agents: 0.5, ranking: 0.5, rl: 0.5, web: 0.5, language: 0.5, design: 0.5 },
  feedbackCount: 0, version: 1, ...patch,
});

function item(id: string, topic: Topic = 'agents'): ContentItem {
  return {
    id, title: id, url: 'https://example.com/article', publisher: 'Test fixture', kind: 'article',
    text: 'A fixture for deterministic ranking.', addedAt: '2026-09-26T00:00:00.000Z', provenance: 'user-paste',
    analysis: { summary: 'Fixture', concepts: ['bounded retries', 'typed tool contracts'], topics: [topic], evidence: [], readingMinutes: 3, source: 'editorial', model: 'test' },
    decision: null, feedback: null, status: 'ready', error: null,
  };
}

describe('personal ranking', () => {
  it('uses useful feedback to change topic preference and relative rank without inventing mastery', () => {
    const p = profile();
    const language = item('language item', 'language');
    const web = item('web item', 'web');
    expect(rankItems([web, language], p)[0].id).toBe(web.id);
    const after = applyFeedback(p, language, 'useful');
    expect(after.interests.language).toBeGreaterThan(p.interests.language);
    expect(after.knownConcepts).toEqual([]);
    expect(rankItems([web, language], after)[0].id).toBe(language.id);
    expect(p.interests.language).toBe(0.5);
    expect(after.version).toBe(2);
  });

  it('not_useful lowers preference without changing knowledge', () => {
    const p = profile({ knownConcepts: ['already known'] });
    const candidate = item('article');
    const after = applyFeedback(p, candidate, 'not_useful');
    expect(after.interests.agents).toBeLessThan(p.interests.agents);
    expect(after.knownConcepts).toEqual(p.knownConcepts);
    expect(rankItems([candidate], after)[0].score).toBeLessThan(rankItems([candidate], p)[0].score);
  });

  it('responds to a goal change even without APIs', () => {
    const web = item('React server components', 'web');
    const language = item('English retrieval practice', 'language');
    expect(rankItems([language, web], profile({ goal: 'Learn React and Next.js web development' }))[0].id).toBe(web.id);
    expect(rankItems([web, language], profile({ goal: 'Improve English vocabulary and language learning' }))[0].id).toBe(language.id);
  });

  it('deduplicates topic tags so one event cannot multiply an interest update', () => {
    const candidate = item('article');
    candidate.analysis!.topics = ['agents', 'agents', 'agents'];
    const after = applyFeedback(profile(), candidate, 'useful');
    expect(after.interests.agents).toBeCloseTo(0.61);
    expect(after.feedbackCount).toBe(1);
  });

  it('records only specific self-reported known concepts and compresses their contribution', () => {
    const candidate = item('article');
    candidate.analysis!.concepts = ['Agents', 'React', 'bounded retries', ' BOUNDED   RETRIES ', 'typed tool contracts'];
    const p = profile();
    const after = applyFeedback(p, candidate, 'known');
    expect(after.knownConcepts).toEqual(['bounded retries', 'typed tool contracts']);
    expect(after.interests).toEqual(p.interests);
    const beforeRank = rankItems([candidate], p)[0];
    const afterRank = rankItems([{ ...candidate, feedback: 'known' }], after)[0];
    expect(afterRank.knownConcepts).toEqual(['bounded retries', 'typed tool contracts']);
    expect(afterRank.newConcepts).toEqual(['Agents', 'React']);
    expect(afterRank.breakdown.knowledgeOverlap).toBe(0.5);
    expect(afterRank.score).toBeLessThan(beforeRank.score);
  });

  it('matches knowledge case-insensitively without duplicating stored concepts', () => {
    const candidate = item('article');
    const p = profile({ knownConcepts: [' Bounded   Retries '] });
    const after = applyFeedback(p, candidate, 'known');
    expect(after.knownConcepts).toHaveLength(2);
    expect(rankItems([candidate], after)[0].newConcepts).toEqual([]);
    expect(rankItems([candidate], after)[0].breakdown.knowledgeOverlap).toBe(1);
  });

  it('keeps finite utility scores bounded across feedback and malformed numeric inputs', () => {
    const candidate = item('article');
    candidate.analysis!.readingMinutes = Number.NaN;
    let p = profile({ interests: { agents: Number.NaN, ranking: 5, rl: -2, web: Infinity, language: 0, design: 1 } });
    for (let index = 0; index < 100; index++) {
      p = applyFeedback(p, candidate, index % 3 === 0 ? 'useful' : index % 3 === 1 ? 'known' : 'not_useful');
      const result = rankItems([candidate], p)[0];
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
      expect(Number.isFinite(result.baselineScore)).toBe(true);
      for (const value of Object.values(result.breakdown)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('preserves input order on a tie and does not mutate inputs', () => {
    const first = item('first');
    const second = item('second');
    const input = [first, second];
    const snapshot = JSON.stringify(input);
    expect(rankItems(input, profile()).map(row => [row.id, row.rank])).toEqual([['first', 1], ['second', 2]]);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('handles missing analysis without asserting all content is novel', () => {
    const candidate = { ...item('unprocessed'), analysis: null };
    const result = rankItems([candidate], profile())[0];
    expect(result.scoreSource).toBe('local-baseline');
    expect(result.breakdown.novelty).toBe(0.5);
    expect(result.newConcepts).toEqual([]);
    expect(result.reason).toContain('unknown');
    expect(rankItems([], profile())).toEqual([]);
  });

  it('uses actual current Jev forecasts while retaining a distinct utility score', () => {
    const candidate = item('article');
    candidate.decision = { source: 'jev', relevance: 0.9, novelty: 0.8, actionability: 0.7, model: 'test-jev', profileVersion: 1, createdAt: '2026-09-26T00:00:00Z' };
    const ranked = rankItems([candidate], profile())[0];
    expect(ranked.scoreSource).toBe('jev-personalized');
    expect(ranked.breakdown.relevance).toBeCloseTo(0.65 * 0.9 + 0.35 * 0.4);
    expect(ranked.breakdown.actionability).toBe(0.7);
    expect(ranked.score).not.toBe(candidate.decision.relevance * 100);
  });

  it('never presents old Jev forecasts as current after profile changes', () => {
    const candidate = item('React server components', 'web');
    candidate.decision = { source: 'jev', relevance: 0, novelty: 0, actionability: 0, model: 'test-jev', profileVersion: 1, createdAt: '2026-09-26T00:00:00Z' };
    const p = profile({ goal: 'Learn React', version: 2 });
    const withStale = rankItems([candidate], p)[0];
    const without = rankItems([{ ...candidate, decision: null }], p)[0];
    expect(withStale.scoreSource).toBe('stale-jev');
    expect(withStale.score).toBe(without.score);
    expect(withStale.reason).toContain('older profile');
  });

  it('rejects invalid forecast ranges instead of concealing them as Jev data', () => {
    const candidate = item('article');
    candidate.decision = { source: 'jev', relevance: 120, novelty: Number.NaN, actionability: 0.5, model: 'test-jev', profileVersion: 1, createdAt: '2026-09-26T00:00:00Z' };
    const result = rankItems([candidate], profile())[0];
    expect(result.scoreSource).toBe('local-baseline');
    expect(result.reason).toContain('Invalid model forecasts');
  });
});

describe('editorial seed integrity', () => {
  it('never fabricates model decisions or misattributes editorial excerpts', () => {
    expect(seedItems).toHaveLength(9);
    expect(new Set(seedItems.map(row => row.id)).size).toBe(seedItems.length);
    for (const candidate of seedItems) {
      expect(candidate.decision).toBeNull();
      expect(candidate.provenance).toBe('editorial-brief');
      expect(candidate.analysis!.source).toBe('editorial');
      expect(candidate.publisher).toContain('editorial brief');
      expect(new URL(candidate.url).protocol).toBe('https:');
      expect(candidate.text.split(/\s+/).length).toBeGreaterThanOrEqual(60);
      for (const evidence of candidate.analysis!.evidence) expect(candidate.text).toContain(evidence.quote);
    }
  });

  it('starts with visible knowledge compression and supports different learning goals', () => {
    const initial = rankItems(seedItems, defaultProfile);
    expect(initial.find(row => row.id === 'react-state')!.breakdown.knowledgeOverlap).toBe(1);
    const language = rankItems(seedItems, { ...defaultProfile, goal: 'English vocabulary and retrieval practice for language learning' });
    expect(language[0].id).toBe('retrieval-practice');
    const web = rankItems(seedItems, { ...defaultProfile, knownConcepts: [], goal: 'Build a React and Next.js web app with server components' });
    expect(['next-boundaries', 'react-state']).toContain(web[0].id);
  });
});
