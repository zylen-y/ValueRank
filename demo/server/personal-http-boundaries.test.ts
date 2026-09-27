import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import type { PersonalSearchSession } from '../src/domain/personal.ts';
import { createPersonalHttp } from './personal-http.ts';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('exposes unsaved search failures through polling, project summaries and export, then clears them on deletion', async () => {
  // Every store is a separate in-memory SQLite database; no user data or model calls.
  for (const key of ['PERSONAL', 'RESEARCH', 'CATALOG', 'MEDIA']) vi.stubEnv(`VALUERANK_${key}_DB_PATH`, ':memory:');
  vi.stubEnv('VALUERANK_SKIP_SEEDS', '1'); vi.stubEnv('VALUERANK_SKIP_CATALOG_SEEDS', '1');
  const fetch = vi.fn(() => { throw new Error('Network forbidden in storage-boundary test.'); });
  vi.stubGlobal('fetch', fetch);
  let payload: unknown;
  const api = createPersonalHttp({ profile: () => ({ goal: 'Synthetic test only', knownConcepts: [], interests: { agents: .5, ranking: .5, rl: .5, web: .5, language: .5, design: .5 }, feedbackCount: 0, version: 1 }), legacyBusy: () => false, body: async () => ({}), json: (_response, _status, value) => { payload = value; } });
  const call = async (path: string, method = 'GET') => {
    payload = undefined;
    const response = { writeHead: vi.fn(), end: (value: string) => { payload = JSON.parse(value); } } as unknown as ServerResponse;
    expect(await api.handle({ method } as IncomingMessage, response, path)).toBe(true);
    return payload;
  };
  try {
    const project = api.research.create({ title: 'Synthetic storage boundary', goal: 'Exercise failure recovery without model calls', constraints: '' });
    for (const id of ['one', 'two']) {
      const session: PersonalSearchSession = { id, query: 'Synthetic local research', status: 'ranking', createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z', context: { id, version: 1, query: 'Synthetic local research', goal: 'Exercise failure recovery', answers: {}, scopeId: project.id }, questions: [], answers: {}, sources: [], units: [], events: [], answer: '', round: 1, answerReview: { version: 'search-synthesis-support-v1', threshold: .8, status: 'checking', draft: 'Unaccepted synthetic draft', checks: [{ id: 'pending', claim: 'Synthetic pending claim', unitIds: [], status: 'pending' }] } };
      api.personal.saveSession(session); api.research.link(project.id, id);
    }
    vi.spyOn(api.personal, 'saveSession').mockImplementation(() => { throw new Error('Synthetic disk failure'); });
    expect(() => api.search.recoverInterrupted()).not.toThrow();
    expect(api.isRunning()).toBe(false);
    expect(api.personal.getSession('one')?.status).toBe('ranking'); // Durable data is unchanged.
    expect(await call('/api/personal/sessions/one')).toMatchObject({ session: { status: 'failed', error: expect.stringContaining('only until the server restarts'), answer: '', answerReview: { status: 'needs-review', checks: [{ status: 'unavailable' }] } } });
    expect(await call('/api/personal/sessions')).toMatchObject({ sessions: [{ status: 'failed' }, { status: 'failed' }] });
    expect(await call('/api/personal')).toMatchObject({ recentSessions: [{ status: 'failed' }, { status: 'failed' }] });
    expect(await call(`/api/personal/projects/${project.id}`)).toMatchObject({ sessions: [{ status: 'failed' }, { status: 'failed' }] });
    expect(await call('/api/personal/export')).toMatchObject({ sessions: [{ status: 'failed', error: expect.stringContaining('could not be saved locally') }, { status: 'failed' }] });
    await call('/api/personal/sessions/one', 'DELETE');
    expect(api.search.getSession('one')).toBeUndefined(); expect(api.search.getSession('two')?.status).toBe('failed');
    await expect(call('/api/personal/sessions/one')).rejects.toThrow('not found');
    await call('/api/personal/data', 'DELETE');
    expect(api.search.getSession('two')).toBeUndefined(); expect(api.search.listSessions()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    api.personal.store.close(); api.research.store.close(); api.catalog.store.close(); api.media.close();
  }
});
