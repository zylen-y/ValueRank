import { useCallback, useEffect, useState } from 'react';
import type { PersonalSnapshot } from '../domain/personal';
import PersonalSearch from './PersonalSearch';
import PersonalArena from './PersonalArena';
import PersonalMemory from './PersonalMemory';
import { PersonalError } from './PersonalShared';
import { personalRequest } from './personal-utils';
import './personal.css';

export type PersonalView = 'search' | 'arena' | 'memory';
export default function PersonalWorkspace({ view }: { view: PersonalView }) {
  const [snapshot, setSnapshot] = useState<PersonalSnapshot | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { const data = await personalRequest<PersonalSnapshot>(''); setSnapshot(data); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your personal workspace.'); }
  }, []);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 6000); return () => window.clearInterval(timer); }, [refresh]);
  return <div className="p-workspace"><PersonalError error={error} dismiss={() => setError('')} />{snapshot ? view === 'search' ? <PersonalSearch snapshot={snapshot} refresh={refresh} /> : view === 'arena' ? <PersonalArena snapshot={snapshot} refresh={refresh} /> : <PersonalMemory snapshot={snapshot} refresh={refresh} /> : <div className="p-empty"><span className="vr-spinner" /><p>Opening your personal workspace…</p>{error && <button className="vr-button vr-button-secondary" onClick={() => void refresh()}>Try again</button>}</div>}</div>;
}
