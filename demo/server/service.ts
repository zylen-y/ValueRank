import { randomUUID } from 'node:crypto';
import type { ContentItem, FeedbackKind, Profile } from '../src/domain/types.ts';
import type { Store } from './store.ts';
import { rebuildProfile, normalizeConcept } from './store.ts';

export function giveFeedback(store: Store, itemId: string, kind: FeedbackKind) {
  return store.update(state => {
    const item = state.items.find(i => i.id === itemId);
    if (!item) throw new Error('Content item not found.');
    if (item.feedback === kind) return; // Double-clicks are idempotent.
    state.feedback = state.feedback.filter(event => event.itemId !== itemId);
    item.feedback = kind;
    state.feedback.push({ id: randomUUID(), itemId, kind, createdAt: new Date().toISOString(), goal: state.profile.goal, profileVersion: state.profile.version, profileSnapshot: { goal: state.profile.goal, knownConcepts: [...state.profile.knownConcepts], interests: { ...state.profile.interests } }, concepts: [...(item.analysis?.concepts ?? [])], topics: [...(item.analysis?.topics ?? [])] });
    state.feedbackHistory.push({ id: randomUUID(), operation: 'set', at: new Date().toISOString(), itemId, event: structuredClone(state.feedback.at(-1)!) });
    if (kind === 'known') state.knowledgeExclusions = state.knowledgeExclusions.filter(key => !(item.analysis?.concepts ?? []).map(normalizeConcept).includes(key));
    rebuildProfile(state);
  });
}
export function undoFeedback(store: Store, itemId: string) {
  return store.update(state => {
    const item = state.items.find(i => i.id === itemId);
    if (!item) throw new Error('Content item not found.');
    if (!item.feedback) return;
    state.feedbackHistory.push({ id: randomUUID(), operation: 'undo', at: new Date().toISOString(), itemId, event: structuredClone(state.feedback.find(e => e.itemId === itemId) ?? null) });
    item.feedback = null;
    state.feedback = state.feedback.filter(event => event.itemId !== itemId);
    rebuildProfile(state);
  });
}
export function editProfile(store: Store, update: Partial<Pick<Profile, 'goal' | 'knownConcepts' | 'interests'>>) {
  return store.update(state => {
    // Keep raw feedback immutable; explicit knowledge edits override replay.
    if (update.knownConcepts) {
      const allowed = new Set(update.knownConcepts.map(normalizeConcept));
      const removed = state.profile.knownConcepts.map(normalizeConcept).filter(key => !allowed.has(key));
      state.knowledgeExclusions = [...new Set([...state.knowledgeExclusions, ...removed])].filter(key => !allowed.has(key));
    }
    state.baseProfile = { ...state.baseProfile, ...update };
    rebuildProfile(state);
  });
}
export function addItem(store: Store, item: ContentItem) {
  return store.update(state => {
    if (state.items.some(existing => existing.id === item.id)) throw new Error('Content ID already exists.');
    if (state.items.length >= 100) throw new Error('This local prototype supports up to 100 items.');
    if (state.items.some(i => item.url ? i.url === item.url : i.text === item.text)) throw new Error('This source is already in your queue.');
    state.items.push(item);
  });
}
export function exportFeedback(store: Store) {
  const state = store.get();
  const active = new Set(state.feedback.map(event => event.id));
  return state.feedbackHistory.map(entry => {
    const item = state.items.find(i => i.id === entry.itemId);
    return JSON.stringify({ schemaVersion: 1, ...entry, isActiveVerdict: entry.operation === 'set' && !!entry.event && active.has(entry.event.id), source: item ? { id: item.id, title: item.title, url: item.url, provenance: item.provenance } : null, labelMeaning: entry.event?.kind === 'known' ? 'Explicit self-report of prior knowledge' : 'Explicit contextual usefulness preference', caution: 'Append-only observations and retractions. Not measured learning gains. Filter isActiveVerdict before preparing a current-label dataset.' });
  }).join('\n');
}
