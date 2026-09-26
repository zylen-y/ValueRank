import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ContentItem, FeedbackEvent, Profile, Run } from '../src/domain/types.ts';
import { defaultProfile, seedItems } from '../src/domain/seeds.ts';
import { applyFeedback } from '../src/domain/ranking.ts';
import { demoRoot } from './config.ts';

export interface HistoryEntry { id: string; operation: 'set' | 'undo' | 'reset'; at: string; itemId?: string; event: FeedbackEvent | null }
export interface SavedState { feedbackHistory: HistoryEntry[]; knowledgeExclusions: string[]; profile: Profile; items: ContentItem[]; feedback: FeedbackEvent[]; run: Run | null; baseProfile: Profile }
export function createStore(path = resolve(demoRoot, '.data/valuerank.sqlite')) {
  if (path !== ':memory:') mkdirSync(resolve(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)');
  const get = () => JSON.parse((db.prepare('SELECT payload FROM workspace WHERE id=1').get() as { payload: string }).payload) as SavedState;
  const save = (state: SavedState) => db.prepare('INSERT INTO workspace(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(JSON.stringify(state));
  if (!db.prepare('SELECT id FROM workspace WHERE id=1').get()) {
    save({ feedbackHistory: [], knowledgeExclusions: [], profile: structuredClone(defaultProfile), baseProfile: structuredClone(defaultProfile), items: structuredClone(seedItems), feedback: [], run: null });
  }
  const saved = get();
  if (!saved.feedbackHistory || !saved.knowledgeExclusions) { saved.feedbackHistory ??= []; saved.knowledgeExclusions ??= []; save(saved); }
  const update = (fn: (state: SavedState) => void) => {
    db.exec('BEGIN IMMEDIATE');
    try { const state = get(); fn(state); save(state); db.exec('COMMIT'); return state; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  return { get, update, close: () => db.close() };
}
export type Store = ReturnType<typeof createStore>;

// Replay current verdicts once from an explicit baseline. Changing or undoing
// feedback never compounds an old update or silently leaves learned state behind.
export function rebuildProfile(state: SavedState) {
  const nextVersion = state.profile.version + 1;
  let profile = { ...structuredClone(state.baseProfile), feedbackCount: 0 };
  for (const event of state.feedback) {
    const item = state.items.find(candidate => candidate.id === event.itemId);
    if (item) {
      const snapshot: ContentItem = { ...item, title: '', text: '', analysis: { summary: '', concepts: event.kind === 'known' ? event.concepts.filter(c => !state.knowledgeExclusions.includes(normalizeConcept(c))) : event.concepts, topics: event.topics, evidence: [], readingMinutes: 1, source: 'editorial', model: 'feedback-snapshot' } };
      profile = applyFeedback(profile, snapshot, event.kind);
    }
  }
  state.profile = { ...profile, version: nextVersion, feedbackCount: state.feedback.length };
}

export const normalizeConcept = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
