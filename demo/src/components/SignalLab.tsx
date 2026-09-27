import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { AppState } from '../domain/types';
import type { BurstJob, BurstItem } from '../domain/burst';
import { BURST_CORPUS } from '../domain/burst-corpus';
import { selectSession } from '../domain/session';
import './signal-lab.css';

const DIRECTIONS = [
  { name: 'Language-learning founder', goal: 'Build a language-learning agent that chooses the next useful practice activity, remembers learner knowledge, and measures learning progress.' },
  { name: 'Build an agent harness', goal: 'Build a reliable AI agent harness with bounded tools, persistent memory, evaluation, and safe execution.' },
  { name: 'Ship a beautiful product', goal: 'Ship an accessible, polished React and Next.js web product with excellent interaction design and performance.' },
];
const FAMILIAR = ['React state', 'React effects', 'Spaced repetition', 'Server Components'];
const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);
async function api<T>(path: string, body?: object): Promise<T> {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const data = await r.json(); if (!r.ok) throw new Error(data.error || 'Could not reach the decision engine.'); return data;
}
function Arrow() { return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" /></svg>; }
function bucket(item: BurstItem) {
  if (!item.decision || item.status !== 'completed') return item.status;
  return item.decision.relevance < .45 ? 'parked' : item.decision.novelty < .4 ? 'familiar' : 'signal';
}
function Probabilities({ item }: { item: BurstItem }) {
  return <div className="sl-probabilities">{(['relevance', 'novelty', 'actionability'] as const).map(key => <div key={key}><span>{key === 'novelty' ? 'New to you' : key === 'relevance' ? 'Fits your goal' : 'Actionable'}</span><div><i style={{ width: `${(item.decision?.[key] ?? 0) * 100}%` }} /></div><b>{item.decision ? `${Math.round(item.decision[key] * 100)}%` : '—'}</b></div>)}</div>;
}
function BriefDialog({ item, onClose }: { item: BurstItem; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={ref} className="sl-dialog" aria-labelledby="sl-brief-title" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><header><span>SOURCE INSPECTOR</span><button onClick={onClose} aria-label="Close source inspector">×</button></header><p className="sl-kicker">{item.publisher} · Prepared editorial brief</p><h2 id="sl-brief-title">{item.title}</h2><p className="sl-dialog-copy">{item.text}</p><a href={item.url} target="_blank" rel="noreferrer">Read the primary source <Arrow /></a><div className="sl-dialog-decision"><h3>{item.decision ? 'The actual Jev response' : 'Waiting for a decision'}</h3><Probabilities item={item} /><p>Forecasts about three defined questions, not a guarantee of learning. The utility score combines these forecasts with your recorded context.</p>{item.decision && <code>{item.decision.model} · {item.durationMs} ms · {fmt(item.tokens)} tokens</code>}{item.error && <p role="alert">{item.error}</p>}</div></dialog>;
}
function useRankMotion(ids: string[]) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<string, DOMRect>());
  const key = ids.join('|');
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.querySelectorAll<HTMLElement>('[data-source-id]').forEach(element => {
      const id = element.dataset.sourceId!; const rect = element.getBoundingClientRect(); const old = previous.current.get(id);
      next.set(id, rect);
      if (!reduced && old && Math.abs(old.top - rect.top) > 2) element.animate([{ transform: `translateY(${old.top - rect.top}px)`, opacity: .7 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 550, easing: 'cubic-bezier(.22,1,.36,1)' });
    });
    previous.current = next;
  }, [key]);
  return ref;
}

export default function SignalLab({ state, onSaved }: { state: AppState; onSaved: () => Promise<void> }) {
  const [job, setJob] = useState<BurstJob | null>(null);
  const [goal, setGoal] = useState(DIRECTIONS[0].goal);
  const [known, setKnown] = useState<string[]>(FAMILIAR);
  const [budget, setBudget] = useState(20);
  const [pending, setPending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [inspected, setInspected] = useState<string | null>(null);
  const [replay, setReplay] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const epoch = useRef(0);
  const engineRef = useRef<HTMLElement>(null);
  useEffect(() => {
    let active = true;
    void api<{job: BurstJob | null}>('/api/burst').then(data => {
      if (!active) return; setJob(data.job);
      if (data.job) { setGoal(data.job.profile.goal); setKnown(data.job.profile.knownConcepts); }
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, []);
  const realRunning = job?.status === 'running';
  useEffect(() => {
    let active = true, fetching = false;
    const timer = window.setInterval(() => {
      if (fetching) return; fetching = true; const expected = epoch.current;
      void api<{job: BurstJob | null}>('/api/burst').then(data => {
        if (active && expected === epoch.current) { setJob(data.job); setError(''); }
      }).catch(() => { if (active) setError('Connection interrupted. The server may still be processing; reconnecting…'); }).finally(() => { fetching = false; });
    }, realRunning ? 300 : 6000);
    return () => { active = false; window.clearInterval(timer); };
  }, [realRunning]);
  useEffect(() => {
    if (replay === null && !realRunning) return;
    const timer = window.setInterval(() => { setTick(t => t + 1); if (replay !== null && Date.now() - replay >= 9000) setReplay(null); }, 100);
    return () => window.clearInterval(timer);
  }, [replay, realRunning]);
  const replayProgress = replay === null ? 1 : Math.min(1, (Date.now() - replay) / 9000);
  void tick;
  const replaying = replay !== null && replayProgress < 1;
  const started = job ? Date.parse(job.startedAt) : 0;
  const actualElapsed = job ? (job.finishedAt ? Date.parse(job.finishedAt) - started : Date.now() - started) : 0;
  const viewItems: BurstItem[] = job ? job.items.map(item => {
    if (!replaying) return item;
    const cursor = replayProgress * Math.max(actualElapsed, 1);
    const finish = item.completedAt ? Date.parse(item.completedAt) - started : actualElapsed;
    const begin = item.startedAt ? Date.parse(item.startedAt) - started : actualElapsed;
    if (finish <= cursor) return item;
    return { ...item, status: begin <= cursor ? 'running' : 'queued', decision: null, score: null, tokens: 0 };
  }) : BURST_CORPUS.map(item => ({ ...item, status: 'queued', readingMinutes: item.analysis!.readingMinutes, topics: item.analysis!.topics, startedAt: null, completedAt: null, score: null, tokens: 0, durationMs: null }) as BurstItem);
  const completed = viewItems.filter(item => item.status === 'completed');
  const activeCount = viewItems.filter(item => item.status === 'running').length;
  const elapsed = replaying ? replayProgress * actualElapsed : actualElapsed;
  const ranking = completed.toSorted((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const shortlist = selectSession(ranking, budget);
  const listRef = useRankMotion(shortlist.map(item => item.id));
  const focusMinutes = shortlist.reduce((total, item) => total + item.readingMinutes, 0);
  const totalMinutes = viewItems.reduce((total, item) => total + item.readingMinutes, 0);
  const parked = completed.filter(item => bucket(item) === 'parked').length;
  const familiar = completed.filter(item => bucket(item) === 'familiar').length;
  const changed = Boolean(job && (goal !== job.profile.goal || JSON.stringify(known) !== JSON.stringify(job.profile.knownConcepts)));
  const visualRunning = realRunning || replaying;
  const selected = viewItems.find(item => item.id === inspected);
  async function run() {
    setPending(true); setError(''); setNotice(''); setReplay(null); epoch.current++;
    engineRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    try { const data = await api<{job: BurstJob}>('/api/burst', { goal, knownConcepts: known }); setJob(data.job); }
    catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start screening.');
      // A dropped HTTP response does not prove the server rejected the run.
      try { const data = await api<{job: BurstJob | null}>('/api/burst'); setJob(data.job); if (data.job?.status === 'running') setError('Reconnected to the running engine.'); } catch { /* Preserve the visible connection error. */ }
    }
    finally { setPending(false); }
  }
  async function cancel() {
    setPending(true); epoch.current++;
    try { const data = await api<{job: BurstJob}>('/api/burst/cancel', {}); setJob(data.job); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not stop screening.'); }
    finally { setPending(false); }
  }
  async function save() {
    setPending(true); setError('');
    try { const result = await api<{added: number; contextMatched: boolean}>('/api/burst/save', { jobId: job!.id, itemIds: shortlist.map(item => item.id) }); await onSaved(); setNotice(result.added ? `${result.added} readings saved. ${result.contextMatched ? 'Your Jev decisions are preserved in the reading queue.' : 'Your workspace has a different goal or knowledge profile. The queue ranks these briefs locally; Run engine there for fresh personalized decisions.'}` : 'These sources are already in your reading queue.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save your session.'); }
    finally { setPending(false); }
  }
  function playReplay() {
    setNotice(''); setReplay(replaying ? null : Date.now()); setTick(t => t + 1);
    engineRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  return <div className="sl-page">
    <section className="sl-hero"><div><div className="sl-eyebrow"><span /> THE SIGNAL LAB <span className="sl-hero-edition">01 / PERSONAL INTELLIGENCE</span></div><h1>Your time is finite.<br /><span>Your feed isn’t.</span></h1><p>48 things you could read. A few that move you forward.<br className="sl-desktop-break" /> Let Jev find the signal for the time you actually have.</p></div><div className="sl-hero-stamp"><span>LESS SCROLLING.</span><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M8 40h18l10-20 12 40 10-20h14" /></svg><span>MORE BUILDING.</span></div></section>
    <section className="sl-controls" aria-label="Screening preferences"><div className="sl-direction"><label htmlFor="sl-direction">01 <span>What are you building?</span></label><select id="sl-direction" value={DIRECTIONS.some(d => d.goal === goal) ? goal : 'custom'} disabled={realRunning || pending} onChange={e => setGoal(e.target.value === 'custom' ? state.profile.goal : e.target.value)}>{DIRECTIONS.map(d => <option key={d.name} value={d.goal}>{d.name}</option>)}<option value="custom">My saved workspace goal</option></select></div><div className="sl-time"><span className="sl-label">02 <span>Time for yourself</span></span><div className="sl-segment" aria-label="Reading time budget">{[10, 20, 30].map(n => <button key={n} aria-pressed={budget === n} onClick={() => setBudget(n)}>{n}<span> min</span></button>)}</div></div><button className="sl-run" onClick={() => void run()} disabled={!loaded || !state.connections.jev || realRunning || pending || replaying}>{pending ? 'Connecting…' : realRunning ? 'Finding your signal…' : job ? 'Screen again' : 'Find my signal'}{realRunning ? <span className="sl-small-spinner" /> : <Arrow />}</button><div className="sl-knowledge"><span>Already in your toolkit</span>{FAMILIAR.map(concept => <button key={concept} disabled={realRunning || pending} aria-pressed={known.includes(concept)} onClick={() => setKnown(prev => prev.includes(concept) ? prev.filter(v => v !== concept) : [...prev, concept])}><span>{known.includes(concept) ? '✓' : '+'}</span>{concept}</button>)}</div></section>
    {error && <div className="sl-message error" role="alert">{error}</div>}{notice && <div className="sl-message" role="status">{notice}</div>}{changed && <div className="sl-message">Your direction or knowledge changed. Screen again to get fresh Jev judgments. The results below still use the previous context.</div>}
    <section ref={engineRef} className={`sl-engine ${visualRunning ? 'is-running' : ''}`} aria-label="Jev decision engine">
      <header className="sl-engine-header"><div><span className="sl-kicker">FROM INFORMATION TO INTENTION</span><h2>A small model. A big filter.</h2></div><div className={`sl-run-status ${visualRunning ? 'running' : ''}`}><i />{replaying ? 'RECORDED RUN · REPLAY' : realRunning ? 'LIVE INFERENCE' : job?.status === 'completed' ? 'LIVE RUN COMPLETE' : job ? job.status.toUpperCase() : 'READY TO SCREEN'}</div></header>
      <div className="sl-machine"><svg className="sl-wires" viewBox="0 0 900 250" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="sl-beam"><stop stopColor="#a1a1aa"/><stop offset=".55" stopColor="#8b5cf6"/><stop offset="1" stopColor="#5bbdff"/></linearGradient></defs>{[40, 82, 124, 166, 208].map((y, i) => <g key={y}><path d={`M200 ${y} C350 ${y},340 125,440 125 S620 ${y},730 ${y}`} /><path className="sl-beam" style={{ animationDelay: `${i * -.6}s` }} d={`M200 ${y} C350 ${y},340 125,440 125 S620 ${y},730 ${y}`} /></g>)}</svg>
        <div className="sl-input"><div className="sl-machine-label"><b>48</b><span>SOURCE BRIEFS</span></div><div className="sl-source-grid">{viewItems.map((item, i) => <button key={item.id} className={`sl-source-cell ${bucket(item)}`} style={{ '--cell': i } as CSSProperties} title={`${item.title} · ${item.status}`} aria-label={`Inspect ${item.title}: ${item.status}`} onClick={() => setInspected(item.id)}><span>{String(i + 1).padStart(2, '0')}</span></button>)}</div><div className="sl-grid-legend"><span><i />Queued</span><span><i />Evaluating</span><span><i />Decided</span></div></div>
        <div className="sl-core-area"><div className="sl-orbit sl-orbit-one" /><div className="sl-orbit sl-orbit-two" /><div className="sl-chip"><div className="sl-chip-glow"/><span className="sl-chip-top">SYSTEM ONE</span><strong>Jev<span>✳</span></strong><span className="sl-chip-bottom">DECISIONS, NOT PARAGRAPHS</span><div className="sl-chip-pins" /></div><div className="sl-core-caption"><i className={visualRunning ? 'active' : ''} />{visualRunning ? `${activeCount} requests in flight` : '6 concurrent workers'}<span>Relevance · Novelty · Actionability</span></div></div>
        <div className="sl-output"><span className="sl-kicker">YOUR ATTENTION, PROTECTED</span><div className="sl-output-count"><strong key={completed.length}>{completed.length}</strong><span>/ 48<br />screened</span></div><div className="sl-output-progress"><i style={{ width: `${completed.length / 48 * 100}%` }} /></div><div className="sl-output-row"><span>Fit your goal + new</span><b>{completed.length - parked - familiar}</b></div><div className="sl-output-row"><span>Outside this goal</span><b>{parked}</b></div><div className="sl-output-row"><span>Likely familiar</span><b>{familiar}</b></div><span className="sl-threshold-note">Model forecast buckets · inspect any tile</span></div>
      </div>
      <div className="sl-metrics"><div><span>{replaying ? 'Original run time' : 'Wall-clock time'}</span><strong>{job ? (Math.max(elapsed, 0) / 1000).toFixed(1) : '—'}<small>{job ? 's' : ''}</small></strong></div><div><span>Typed forecasts returned</span><strong>{fmt(completed.length * 3)}<small>/ 144</small></strong></div><div><span>Observed throughput</span><strong>{completed.length && elapsed > 0 ? (completed.length / (elapsed / 1000)).toFixed(1) : '—'}<small>briefs/s</small></strong></div><div><span>Reported tokens</span><strong>{fmt(completed.reduce((n, item) => n + item.tokens, 0))}</strong></div></div>
      <footer className="sl-engine-footer"><span>{realRunning ? 'Real Jev calls via OpenRouter / TypeSafe. Results appear as requests finish.' : job ? `${job.errors} failed · ${job.cancelled + job.skipped} not completed · ${job.model}` : 'Prepared, source-linked briefs. Screening uses real Jev calls; no LLM generation.'}</span>{realRunning ? <button onClick={() => void cancel()} disabled={pending || job?.cancelRequested}>{job?.cancelRequested ? 'Stopping…' : 'Stop run'}</button> : job?.status === 'completed' ? <button onClick={playReplay}>{replaying ? 'End replay' : '↻ Replay this run'}<span>no API calls</span></button> : null}</footer>
    </section>
    <section className="sl-session"><header><div><span className="sl-kicker">THE PAYOFF</span><h2>{shortlist.length ? `Your ${focusMinutes}-minute head start.` : 'Your next move, not another backlog.'}</h2><p>{shortlist.length ? `${shortlist.length} readings selected within your ${budget}-minute budget. Change the time above to reshape your session instantly.` : 'The strongest combination of readings for your available time will land here.'}</p></div>{shortlist.length > 0 && <button className="sl-save" onClick={() => void save()} disabled={pending || realRunning || replaying || changed}>Save this session <Arrow /></button>}</header>
      <div className="sl-session-layout"><div ref={listRef} className="sl-shortlist" aria-live="polite" aria-relevant="additions">{shortlist.length ? shortlist.map((item, index) => <article className="sl-reading" key={item.id} data-source-id={item.id}><span className="sl-reading-index">{String(index + 1).padStart(2, '0')}</span><div><span className="sl-reading-source">{item.publisher} <span>· {item.readingMinutes} min est.</span></span><button className="sl-reading-title" onClick={() => setInspected(item.id)}>{item.title}<Arrow /></button><p>{item.analysis?.summary}</p><div className="sl-reading-tags"><span>{Math.round((item.decision?.relevance ?? 0) * 100)}% goal fit</span><span>{Math.round((item.decision?.novelty ?? 0) * 100)}% novelty</span></div></div><div className="sl-reading-score"><strong>{Math.round(item.score ?? 0)}</strong><span>UTILITY</span></div></article>) : <div className="sl-empty"><div className="sl-empty-lines"><i/><i/><i/></div><h3>Make room for what matters.</h3><p>Start the engine. Watch 48 candidates become a session you can actually finish.</p></div>}</div><aside className="sl-payoff"><span className="sl-kicker">A SMALLER PILE. A CLEARER PATH.</span><div className="sl-time-comparison"><div><span>The whole pile</span><b>{totalMinutes}<small> min</small></b><i /></div><div><span>Your session</span><b>{shortlist.length ? focusMinutes : '—'}<small> min</small></b><i style={{ width: shortlist.length ? `${Math.max(3, focusMinutes / totalMinutes * 100)}%` : '3%' }} /></div></div><p>Estimated reading scope, not measured time saved. Every brief keeps a link to its primary source.</p><div className="sl-next-loop"><span>THE LOOP THAT COMPOUNDS</span><strong>Read → react → remember.</strong><p>Save your session. Mark what helped or what you already knew. Your next queue uses that knowledge.</p></div></aside></div>
    </section><details className="sl-disclosure"><summary>What exactly is happening here?</summary><p>This demonstration screens 48 original editorial briefs linked to primary sources. They are prepared examples, not 48 freshly downloaded or LLM-summarized pages. Jev evaluates three bounded questions per brief, using six concurrent requests. Screening bypasses the slower generative stage; deeper LLM analysis remains available in your Reading queue.</p><p>Tile colors use declared cutoffs: outside goal if relevance &lt; 45%; otherwise familiar if novelty &lt; 40%; otherwise a candidate. Session selection uses only candidate briefs and maximizes summed heuristic utility within the chosen reading budget, up to five items. Unused minutes are better than irrelevant filler. Reading times are editorial estimates. Each run is billed through your configured Jev provider. A replay animates saved real results and makes no API calls.</p><p>Goal used for the displayed results: {job?.profile.goal ?? goal}</p></details>
    {selected && <BriefDialog item={selected} onClose={() => setInspected(null)} />}
  </div>;
}
