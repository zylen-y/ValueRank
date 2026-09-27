import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PersonalComparisonRecord, PersonalSnapshot } from '../domain/personal';
import PersonalMemory from './PersonalMemory';

const date = '2026-09-27T00:00:00.000Z';
const record: PersonalComparisonRecord = {
  id: 'choice-1', exposureId: 'exposure-1', choice: 'b', createdAt: date, undone: false,
  details: {
    a: { id: 'item-a', version: 1, title: 'Vector-only memory' },
    b: { id: 'item-b', version: 3, title: 'Explicit memory records' },
    domain: 'content', mode: 'learn', context: { id: 'context-1', version: 2, goal: 'Ship in two days', query: 'Agent memory', answers: {} },
    dataset: { id: 'dataset-1', version: 4, title: 'Agent research', available: true },
    session: { id: 'session-1', query: 'Agent memory' },
  },
};
const snapshot = (comparisons: PersonalComparisonRecord[]): PersonalSnapshot => ({ datasets: [], facts: [], models: [], comparisons, evaluations: [], evaluationHistory: [], observationCount: 0, trainingCount: 1, testCount: 0, recentSessions: [] });
const render = (comparisons: PersonalComparisonRecord[]) => renderToStaticMarkup(<PersonalMemory snapshot={snapshot(comparisons)} refresh={async () => {}} />);

describe('meaningful comparison ledger', () => {
  it('names the winner, both shown revisions, scope, training mode, and available destinations', () => {
    const html = render([record]);
    expect(html).toContain('Preferred “Explicit memory records” over “Vector-only memory”');
    expect(html).toContain('General preferences');
    expect(html).toContain('Learning comparison');
    expect(html).toContain('Used for training');
    expect(html).toContain('B: Explicit memory records · version 3');
    expect(html).toContain('Context v2');
    expect(html).toContain('href="#search/session-1"');
    expect(html).toContain('href="#arena/dataset-1"');
  });
  it('does not describe a held-out answer as training or link an unavailable project/collection', () => {
    const html = render([{ ...record, details: { ...record.details!, mode: 'test', context: { ...record.details!.context, scopeId: 'deleted-project' }, dataset: { ...record.details!.dataset, available: false }, session: undefined } }]);
    expect(html).toContain('Blind test');
    expect(html).toContain('Not used for training');
    expect(html).toContain('Unavailable project');
    expect(html).toContain('Scope: deleted-project');
    expect(html).not.toContain('href="#projects/deleted-project"');
    expect(html).not.toContain('href="#arena/dataset-1"');
    expect(html).not.toContain('href="#search/session-1"');
  });
  it('preserves newest-first snapshot order and hides undone choices', () => {
    const html = render([{ ...record, id: 'new', reason: 'Newest reason' }, { ...record, id: 'old', reason: 'Older reason' }, { ...record, id: 'undone', reason: 'Hidden undone reason', undone: true }]);
    expect(html.indexOf('Newest reason')).toBeLessThan(html.indexOf('Older reason'));
    expect(html).not.toContain('Hidden undone reason');
    expect(html).toContain('2 shown');
  });
});
