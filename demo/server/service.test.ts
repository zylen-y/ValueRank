import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore, type Store } from './store.ts';
import { addItem, editProfile, exportFeedback, giveFeedback, undoFeedback } from './service.ts';
import { applyFeedback, rankItems } from '../src/domain/ranking.ts';
import type { ContentItem } from '../src/domain/types.ts';

let store: Store;
beforeEach(() => { store = createStore(':memory:'); });
afterEach(() => { store.close(); });

function fixture(id = 'fixture'): ContentItem {
  return {
    id, title: 'Inspecting bounded retries', url: `https://example.com/${id}`, publisher: 'Test fixture', kind: 'article',
    text: 'This is a unique test source about bounded retries and reliable tool execution.',
    addedAt: '2026-09-26T00:00:00Z', provenance: 'user-paste', analysis: {
      summary: 'Test fixture', concepts: ['bounded retries', 'typed tool contracts'], topics: ['agents'],
      evidence: [], readingMinutes: 1, source: 'editorial', model: 'test',
    }, decision: null, feedback: null, status: 'ready', error: null,
  };
}

describe('SQLite persistence', () => {
  it('isolates returned snapshots from durable state', () => {
    const snapshot = store.get();
    const originalGoal = snapshot.profile.goal;
    snapshot.profile.goal = 'not persisted';
    snapshot.items.length = 0;
    expect(store.get().profile.goal).toBe(originalGoal);
    expect(store.get().items).toHaveLength(9);
  });

  it('rolls a whole update back if any part throws', () => {
    const before = store.get();
    expect(() => store.update(state => {
      state.profile.goal = 'should roll back';
      state.items.push(fixture());
      throw new Error('abort transaction');
    })).toThrow('abort transaction');
    expect(store.get()).toEqual(before);
    expect(addItem(store, fixture()).items).toHaveLength(10);
  });
});

describe('feedback replay', () => {
  it('applies duplicate feedback exactly once, including event identity and profile version', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const first = giveFeedback(store, candidate.id, 'useful');
    const second = giveFeedback(store, candidate.id, 'useful');
    expect(second).toEqual(first);
    expect(second.feedback).toHaveLength(1);
    expect(second.profile.feedbackCount).toBe(1);
    expect(second.profile.version).toBe(first.profile.version);
  });

  it('replacement removes the prior preference update instead of compounding both labels', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const baseline = store.get().profile;
    giveFeedback(store, candidate.id, 'useful');
    const replaced = giveFeedback(store, candidate.id, 'not_useful');
    expect(replaced.profile.interests).toEqual(applyFeedback(baseline, candidate, 'not_useful').interests);
    expect(replaced.profile.knownConcepts).toEqual(baseline.knownConcepts);
    expect(replaced.feedback.map(event => event.kind)).toEqual(['not_useful']);
    expect(replaced.profile.feedbackCount).toBe(1);
    expect(replaced.items.find(item => item.id === candidate.id)!.feedback).toBe('not_useful');
  });

  it('replacement of known with useful removes learned knowledge but preserves baseline knowledge', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const baseline = store.get().profile;
    expect(giveFeedback(store, candidate.id, 'known').profile.knownConcepts).toContain('bounded retries');
    const replaced = giveFeedback(store, candidate.id, 'useful');
    expect(replaced.profile.knownConcepts).toEqual(baseline.knownConcepts);
    expect(replaced.profile.interests.agents).toBeGreaterThan(baseline.interests.agents);
  });

  it('undo restores baseline preferences and knowledge and is idempotent', () => {
    const first = fixture('first');
    const second = fixture('second');
    addItem(store, first);
    addItem(store, second);
    const baseline = store.get().profile;
    giveFeedback(store, first.id, 'useful');
    giveFeedback(store, second.id, 'known');
    undoFeedback(store, first.id);
    const undone = undoFeedback(store, second.id);
    expect(undone.profile.interests).toEqual(baseline.interests);
    expect(undone.profile.knownConcepts).toEqual(baseline.knownConcepts);
    expect(undone.profile.feedbackCount).toBe(0);
    expect(undone.feedback).toEqual([]);
    expect(undone.items.filter(item => item.feedback !== null)).toEqual([]);
    expect(undoFeedback(store, second.id)).toEqual(undone);
  });

  it('undoing one known item retains concepts still supported by a second explicit verdict', () => {
    const first = fixture('first');
    const second = fixture('second');
    addItem(store, first);
    addItem(store, second);
    giveFeedback(store, first.id, 'known');
    giveFeedback(store, second.id, 'known');
    const after = undoFeedback(store, first.id);
    expect(after.profile.knownConcepts).toContain('bounded retries');
    expect(after.profile.knownConcepts.filter(concept => concept === 'bounded retries')).toHaveLength(1);
    expect(after.profile.feedbackCount).toBe(1);
  });

  it('manual knowledge removals survive later replay and unrelated goal changes', () => {
    const first = fixture('first');
    const second = fixture('second');
    addItem(store, first);
    addItem(store, second);
    giveFeedback(store, first.id, 'known');
    const edited = editProfile(store, { knownConcepts: ['typed tool contracts'] });
    expect(edited.profile.knownConcepts).toEqual(['typed tool contracts']);
    giveFeedback(store, second.id, 'useful');
    const replayed = editProfile(store, { goal: 'Improve English retrieval practice' });
    expect(replayed.profile.knownConcepts).toEqual(['typed tool contracts']);
    expect(replayed.profile.goal).toBe('Improve English retrieval practice');
  });

  it('clearing all known concepts is authoritative', () => {
    const candidate = fixture();
    addItem(store, candidate);
    giveFeedback(store, candidate.id, 'known');
    expect(editProfile(store, { knownConcepts: [] }).profile.knownConcepts).toEqual([]);
    expect(editProfile(store, { goal: 'Build an agent harness' }).profile.knownConcepts).toEqual([]);
  });

  it('later analysis cannot rewrite the features or context of a previous feedback event', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const baseline = store.get().profile;
    const first = giveFeedback(store, candidate.id, 'useful');
    const event = structuredClone(first.feedback[0]);
    store.update(state => {
      const stored = state.items.find(item => item.id === candidate.id)!;
      stored.analysis!.concepts = ['a newly extracted concept'];
      stored.analysis!.topics = ['language'];
    });
    const replayed = editProfile(store, { goal: 'A different future goal' });
    expect(replayed.feedback[0]).toEqual(event);
    expect(replayed.profile.interests).toEqual(applyFeedback(baseline, candidate, 'useful').interests);
    const exported = exportFeedback(store).split('\n').map(line => JSON.parse(line));
    expect(exported[0].event.goal).toBe(baseline.goal);
    expect(exported[0].event.profileVersion).toBe(baseline.version);
    expect(exported[0].event.concepts).toEqual(['bounded retries', 'typed tool contracts']);
    expect(exported[0].event.topics).toEqual(['agents']);
    expect(exported[0].isActiveVerdict).toBe(true);
    expect(exported[0].source).toMatchObject({ id: candidate.id, url: candidate.url, provenance: 'user-paste' });
    expect(exported[0].labelMeaning).toContain('preference');
    expect(exported[0].caution).toContain('Not measured learning gains');
  });

  it('feedback invalidates old Jev forecasts through monotonically increasing profile versions', () => {
    const candidate = fixture();
    candidate.decision = { relevance: 0.9, novelty: 0.7, actionability: 0.8, source: 'jev', model: 'test', profileVersion: store.get().profile.version, createdAt: '2026-09-26T00:00:00Z' };
    addItem(store, candidate);
    const before = store.get();
    expect(rankItems([candidate], before.profile)[0].scoreSource).toBe('jev-personalized');
    const rated = giveFeedback(store, candidate.id, 'useful');
    expect(rated.profile.version).toBe(before.profile.version + 1);
    expect(rankItems(rated.items, rated.profile).find(item => item.id === candidate.id)!.scoreSource).toBe('stale-jev');
    const undone = undoFeedback(store, candidate.id);
    expect(undone.profile.version).toBe(rated.profile.version + 1);
    expect(rankItems(undone.items, undone.profile).find(item => item.id === candidate.id)!.scoreSource).toBe('stale-jev');
  });

  it('rejects feedback for unknown items without persisting partial state', () => {
    const before = store.get();
    expect(() => giveFeedback(store, 'missing', 'known')).toThrow('not found');
    expect(() => undoFeedback(store, 'missing')).toThrow('not found');
    expect(store.get()).toEqual(before);
  });
});

describe('source queue and export', () => {
  it('rejects a duplicate URL even with a different id and body', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const duplicate = { ...candidate, id: 'different-id', text: 'A changed body' };
    expect(() => addItem(store, duplicate)).toThrow('already in your queue');
    expect(store.get().items.filter(item => item.url === candidate.url)).toHaveLength(1);
  });

  it('deduplicates pasted sources by body while allowing different paste content', () => {
    const candidate = { ...fixture(), url: '' };
    addItem(store, candidate);
    expect(() => addItem(store, { ...candidate, id: 'duplicate' })).toThrow('already in your queue');
    addItem(store, { ...candidate, id: 'different', text: 'Different pasted source content' });
    expect(store.get().items).toHaveLength(11);
  });

  it('returns valid newline-delimited records and an empty export for an empty log', () => {
    expect(exportFeedback(store)).toBe('');
    const first = fixture('first');
    const second = fixture('second');
    addItem(store, first);
    addItem(store, second);
    giveFeedback(store, first.id, 'known');
    giveFeedback(store, second.id, 'not_useful');
    const records = exportFeedback(store).split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0].schemaVersion).toBe(1);
    expect(records[0].labelMeaning).toBe('Explicit self-report of prior knowledge');
    expect(records[1].labelMeaning).toBe('Explicit contextual usefulness preference');
  });

  it('retains original verdicts and explicit retractions after replacement and undo', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const first = giveFeedback(store, candidate.id, 'useful');
    const original = structuredClone(first.feedback[0]);
    const replaced = giveFeedback(store, candidate.id, 'not_useful');
    const replacement = structuredClone(replaced.feedback[0]);
    let records = exportFeedback(store).split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ operation: 'set', event: original, isActiveVerdict: false });
    expect(records[1]).toMatchObject({ operation: 'set', event: replacement, isActiveVerdict: true });
    undoFeedback(store, candidate.id);
    records = exportFeedback(store).split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(3);
    expect(records.map(record => record.operation)).toEqual(['set', 'set', 'undo']);
    expect(records.every(record => !record.isActiveVerdict)).toBe(true);
    expect(records[0].event).toEqual(original);
    expect(records[2].event).toEqual(replacement);
    expect(records[2].itemId).toBe(candidate.id);
    expect(store.get().feedback).toEqual([]);
  });

  it('preserves original knowledge snapshots when manual edits override their replay', () => {
    const candidate = fixture();
    addItem(store, candidate);
    const rated = giveFeedback(store, candidate.id, 'known');
    const originalEvent = structuredClone(rated.feedback[0]);
    const originalHistory = structuredClone(rated.feedbackHistory);
    const edited = editProfile(store, { knownConcepts: ['typed tool contracts'] });
    expect(edited.profile.knownConcepts).toEqual(['typed tool contracts']);
    expect(edited.feedback[0]).toEqual(originalEvent);
    expect(edited.feedbackHistory).toEqual(originalHistory);
    expect(edited.knowledgeExclusions).toContain('bounded retries');
    const record = JSON.parse(exportFeedback(store));
    expect(record.event.concepts).toEqual(['bounded retries', 'typed tool contracts']);
    expect(record.isActiveVerdict).toBe(true);
  });

  it('normalizes explicit knowledge overrides consistently with ranker matching', () => {
    const candidate = fixture();
    candidate.analysis!.concepts = ['Ｂｏｕｎｄｅｄ   Ｒｅｔｒｉｅｓ', 'typed tool contracts'];
    addItem(store, candidate);
    giveFeedback(store, candidate.id, 'known');
    const kept = editProfile(store, { knownConcepts: ['bounded retries'] });
    expect(kept.profile.knownConcepts).toEqual(['bounded retries']);
    const removed = editProfile(store, { knownConcepts: [] });
    expect(removed.profile.knownConcepts).toEqual([]);
    expect(removed.knowledgeExclusions).toContain('bounded retries');
    expect(editProfile(store, { goal: 'Changed goal' }).profile.knownConcepts).toEqual([]);
  });
});
