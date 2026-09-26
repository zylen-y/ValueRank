import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { PersonalComparisonPrompt, PersonalComparisonResult, PersonalDataset, PersonalRankedUnit, PersonalSearchSession, PersonalSnapshot, PersonalSource, PersonalUnit, ComparisonChoice } from '../domain/personal';
import PersonalComparison from './PersonalComparison';
import { PersonalIcon as Icon, PersonalError, PersonalDialog } from './PersonalShared';
import { personalRequest, relativeDate, domainLabel, safeExternalUrl } from './personal-utils';

interface SearchDetail { session: PersonalSearchSession; ranking: PersonalRankedUnit[]; dataset?: PersonalDataset }
const ACTIVE = new Set(['interpreting', 'searching', 'grounding', 'ranking']);
const STAGES = [{ id: 'interpreting', label: 'Understand' }, { id: 'searching', label: 'Search' }, { id: 'grounding', label: 'Make sense' }, { id: 'ranking', label: 'Rank for you' }];
const EXAMPLES = ['What should I use for my first AI agent?', '아이폰 듀오', 'How can AI help people actually learn a language?'];
function sessionFromHash() { const [page, id] = window.location.hash.slice(1).split('/'); return page === 'search' && id ? decodeURIComponent(id) : null; }

function SearchProgress({ session, cancel }: { session: PersonalSearchSession; cancel: () => void }) {
  const active = ACTIVE.has(session.status);
  const latest = session.events.at(-1);
  const stage = STAGES.findIndex(item => item.id === session.status);
  return <section className={`p-process ${active ? 'is-live' : ''}`} aria-label="Search processing status">
    <div className="p-process-head"><span className="p-process-mark"><Icon name="spark" size={18} /></span><div><strong>{active ? latest?.message || 'Opening your exploration…' : session.status === 'awaiting-clarification' ? 'A little context changes the search.' : session.status === 'failed' ? 'This exploration needs attention.' : 'Your sources. Your point of view.'}</strong><span>{session.sources.length} sources · {session.units.length} information cards{session.usage?.elapsedMs ? ` · ${(session.usage.elapsedMs / 1000).toFixed(1)}s` : ''}</span></div>{active ? <button onClick={cancel} className="p-subtle-button"><Icon name="stop" size={13} />Stop</button> : <span className="p-status-label">{session.status.replaceAll('-', ' ')}</span>}</div>
    <div className="p-stages">{STAGES.map((item, index) => <div className={`${active && index === stage ? 'current' : ''} ${index < stage || (!active && session.units.length > 0) ? 'done' : ''}`} key={item.id}><span>{index < stage || (!active && session.units.length > 0) ? <Icon name="check" size={11} /> : `0${index + 1}`}</span>{item.label}<i /></div>)}</div>
    {session.events.length > 0 && <details className="p-trace"><summary>View {session.events.length} engine events<Icon name="source" size={12} /></summary><div>{session.events.map(event => <article key={event.id}><time>{new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><p>{event.message}<small>{[event.model, event.durationMs === undefined ? '' : `${(event.durationMs / 1000).toFixed(2)}s`, event.tokens === undefined ? '' : `${event.tokens.toLocaleString()} tokens`].filter(Boolean).join(' · ')}</small></p>{event.total !== undefined && <span>{event.completed ?? 0}/{event.total}</span>}</article>)}</div></details>}
  </section>;
}
function UnitEvidence({ unit, sources, onOpen }: { unit: PersonalUnit; sources: PersonalSource[]; onOpen?: () => void }) {
  return <details className="p-evidence"><summary><Icon name="source" size={14} />{unit.evidence.length} evidence {unit.evidence.length === 1 ? 'passage' : 'passages'}<span>Inspect sources</span></summary><div>{unit.evidence.map((evidence, index) => { const source = sources.find(item => item.id === evidence.sourceId && item.version === evidence.sourceVersion); return <article key={`${evidence.sourceId}-${index}`}><blockquote>“{evidence.quote}”</blockquote>{source && <a href={safeExternalUrl(source.url)} target="_blank" rel="noreferrer" onClick={onOpen}>{source.title}<Icon name="external" size={12} /></a>}<small>{source?.provenance.replaceAll('-', ' ')}{source?.publishedAt ? ` · Published ${relativeDate(source.publishedAt)}` : ''}{source ? ` · Retrieved ${relativeDate(source.retrievedAt)}` : ''}</small></article>; })}{unit.limitations.length > 0 && <div className="p-limitations"><strong>Keep in mind</strong>{unit.limitations.map(limit => <p key={limit}>{limit}</p>)}</div>}</div></details>;
}
function InformationCard({ unit, index, sources, onObserve, onCompare, onOpen, saved, known, selected, disabled }: { unit: PersonalRankedUnit; index: number; sources: PersonalSource[]; onObserve: (unit: PersonalUnit, kind: 'save' | 'known') => void; onCompare: () => void; onOpen: () => void; saved: boolean; known: boolean; selected: boolean; disabled: boolean }) {
  const source = sources.find(item => item.id === unit.sourceIds[0]);
  return <article id={`unit-${unit.id}-${unit.version}`} className={`p-information ${index === 0 ? 'p-information-first' : ''} ${selected ? 'is-selected' : ''}`} style={{ '--card-index': Math.min(index, 6) } as React.CSSProperties}>
    <div className="p-information-top"><span className="p-rank-number">{String(index + 1).padStart(2, '0')}</span><span>{unit.kind.replaceAll('-', ' ')}</span>{source && <a href={safeExternalUrl(source.url)} target="_blank" rel="noreferrer" onClick={onOpen}>{source.publisher || domainLabel(source.url)}<Icon name="external" size={11} /></a>}<span className="p-information-effort">{unit.effortMinutes} min</span></div>
    <h3>{unit.title}</h3><p className="p-information-body">{unit.body}</p>
    <div className="p-card-insights">{unit.knownConcepts.length > 0 && <span><Icon name="known" size={12} />{unit.knownConcepts.length} familiar {unit.knownConcepts.length === 1 ? 'concept' : 'concepts'}</span>}{Math.abs(unit.personalAdjustment) > 0.0001 && <span className="p-personal-insight"><Icon name="memory" size={12} />{unit.personalAdjustment > 0 ? 'Raised' : 'Lowered'} by your choices</span>}<span title="Relative ranking utility; not a probability.">Value {Number.isFinite(unit.score) ? unit.score.toFixed(2) : '—'}</span></div>
    <UnitEvidence unit={unit} sources={sources} onOpen={onOpen} />
    <div className="p-information-actions"><button onClick={() => onObserve(unit, 'save')} disabled={disabled || saved} aria-label={`Save ${unit.title}`}><Icon name={saved ? 'check' : 'save'} size={14} />{saved ? 'Saved' : 'Save'}</button><button onClick={() => onObserve(unit, 'known')} disabled={disabled || known} aria-label={`Already know ${unit.title}`}><Icon name={known ? 'check' : 'known'} size={14} />{known ? 'Recorded as known' : 'Already know'}</button><button onClick={onCompare} disabled={disabled} aria-pressed={selected}><Icon name="compare" size={14} />{selected ? 'Selected to compare' : 'Compare'}</button></div>
  </article>;
}

export default function PersonalSearch({ snapshot, refresh }: { snapshot: PersonalSnapshot; refresh: () => Promise<void> }) {
  const [sessionId, setSessionId] = useState(sessionFromHash);
  const [detail, setDetail] = useState<SearchDetail | null>(null);
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'cards' | 'sources' | 'answer'>('cards');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<PersonalComparisonPrompt | null>(null);
  const [result, setResult] = useState<PersonalComparisonResult | null>(null);
  const [refinement, setRefinement] = useState('');
  const [hideFollowUp, setHideFollowUp] = useState(false);
  const [research, setResearch] = useState(false);
  const requestEpoch = useRef(0);
  const session = detail?.session;
  const sessionStatus = session?.status;
  const active = Boolean(sessionStatus && ACTIVE.has(sessionStatus));
  const load = useCallback(async (id: string) => {
    const epoch = requestEpoch.current;
    try { const next = await personalRequest<SearchDetail>(`/sessions/${encodeURIComponent(id)}`); if (epoch === requestEpoch.current) setDetail(next); }
    catch (e) { if (epoch === requestEpoch.current) setError(e instanceof Error ? e.message : 'Could not load this exploration.'); }
  }, []);
  useEffect(() => {
    const onHash = () => { const id = sessionFromHash(); requestEpoch.current += 1; setSessionId(id); setDetail(null); setAnswers({}); setCompareIds([]); setError(''); setHideFollowUp(false); };
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { if (sessionId) void load(sessionId); }, [sessionId, load]);
  useEffect(() => { if (!sessionId || !active) return; const timer = window.setInterval(() => void load(sessionId), 900); return () => window.clearInterval(timer); }, [sessionId, active, load]);
  useEffect(() => { if (sessionStatus && !active) void refresh(); }, [sessionStatus, active, refresh]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6500); return () => window.clearTimeout(timer); }, [notice]);
  async function action<T>(name: string, callback: () => Promise<T>): Promise<T | undefined> {
    setBusy(name); setError('');
    try { return await callback(); } catch (e) { setError(e instanceof Error ? e.message : 'The action could not be completed.'); return undefined; } finally { setBusy(''); }
  }
  function openSession(id: string) { window.location.hash = `search/${encodeURIComponent(id)}`; }
  async function start(event?: FormEvent, example?: string) {
    event?.preventDefault(); const text = (example || query).trim(); if (!text || busy) return;
    const next = await action('search', () => personalRequest<{ session: PersonalSearchSession }>('/sessions', { query: text }));
    if (next) { setQuery(''); setTab('cards'); openSession(next.session.id); void refresh(); }
  }
  async function clarify(useProfile = false) {
    if (!session) return;
    await action('clarify', async () => { await personalRequest(`/sessions/${session.id}/clarify`, { answers, useProfile }); await load(session.id); });
  }
  async function observe(unit: PersonalUnit, kind: 'save' | 'known') {
    if (!session) return;
    await action(`observe-${unit.id}`, async () => {
      await personalRequest('/observations', { unitId: unit.id, unitVersion: unit.version, kind, context: session.context });
      if (kind === 'save') { setSavedIds(ids => [...ids, unit.id]); setNotice('Saved to your personal record.'); }
      else { setKnownIds(ids => [...ids, unit.id]); setNotice('Knowledge recorded. Your cards have been reranked.'); await load(session.id); }
      await refresh();
    });
  }
  function recordOpen(unit: PersonalUnit) { if (!session) return; void personalRequest('/observations', { unitId: unit.id, unitVersion: unit.version, kind: 'open', context: session.context }).catch(() => { /* Opening a source must not be blocked by telemetry. */ }); }
  async function compare(id: string) {
    if (compareIds.includes(id)) { setCompareIds(ids => ids.filter(item => item !== id)); return; }
    const ids = [...compareIds.slice(-1), id]; setCompareIds(ids);
    if (ids.length < 2 || !session) return;
    await action('compare', async () => {
      setCompareIds([]);
      const { dataset } = detail?.dataset ? { dataset: detail.dataset } : await personalRequest<{ dataset: PersonalDataset }>(`/sessions/${session.id}/dataset`, {});
      const next = await personalRequest<PersonalComparisonPrompt>('/pairs', { datasetId: dataset.id, mode: 'learn', unitIds: ids });
      setComparison(next); setResult(null); setCompareIds([]);
    });
  }
  async function choose(choice: ComparisonChoice, reason: string) {
    if (!comparison || !session) return;
    await action('choice', async () => { const next = await personalRequest<PersonalComparisonResult>('/choices', { exposureId: comparison.exposure.id, choice, reason }); setResult(next); await load(session.id); await refresh(); });
  }
  async function refine(text: string) {
    if (!session || !text.trim()) return;
    await action('refine', async () => { await personalRequest(`/sessions/${session.id}/refine`, { text, research }); setResearch(false); setRefinement(''); setHideFollowUp(false); await load(session.id); });
  }
  const ranking = detail?.ranking || [];
  return <div className={`p-search-page ${sessionId ? 'has-session' : ''}`}>
    <PersonalError error={error} dismiss={() => setError('')} />
    {!sessionId ? <><section className="p-search-hero"><div className="p-hero-orbit" aria-hidden="true"><span /><span /><span /><i><Icon name="spark" size={27} /></i></div><span className="p-eyebrow">THE WEB, THROUGH YOUR LENS</span><h1>Find what matters.<br /><span>To you.</span></h1><p>Explore freely. Make sense of the sources.<br />Build an engine that learns what you value.</p><form className="p-search-box" onSubmit={event => void start(event)}><Icon name="search" size={21} /><input aria-label="What do you want to explore?" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} placeholder="What do you want to explore?" autoFocus /><button aria-label="Start exploration" disabled={!query.trim() || Boolean(busy)}>{busy === 'search' ? <span className="vr-spinner" /> : <Icon name="arrow" size={20} />}</button></form><div className="p-examples">{EXAMPLES.map(example => <button key={example} onClick={() => void start(undefined, example)} disabled={Boolean(busy)}>{example}<Icon name="arrow" size={12} /></button>)}</div></section><section className="p-search-explainer"><div><span>01</span><Icon name="source" /><h3>Keep the whole picture.</h3><p>Real sources, useful comparisons, and the details that could change your mind.</p></div><div><span>02</span><Icon name="spark" /><h3>Get to the useful parts.</h3><p>Independently readable cards, grounded in passages you can inspect.</p></div><div><span>03</span><Icon name="memory" /><h3>Make it yours.</h3><p>Choose what matters more. Your comparisons train your personal ranking model.</p></div></section><section className="p-recent"><div className="p-section-head"><h2>Recent explorations</h2><span>{snapshot.recentSessions.length} saved</span></div>{snapshot.recentSessions.length ? <div className="p-recent-grid">{snapshot.recentSessions.slice(0, 8).map(item => <button key={item.id} onClick={() => openSession(item.id)}><Icon name="history" size={17} /><div><strong>{item.query}</strong><span>{item.unitCount} cards · {relativeDate(item.createdAt)} · {item.status.replaceAll('-', ' ')}</span></div><Icon name="arrow" size={15} /></button>)}</div> : <div className="p-recent-empty"><Icon name="history" /><p>Your first exploration starts above.<span>Sources, context, and choices stay in your workspace.</span></p></div>}</section></> : !session ? <div className="p-empty"><span className="vr-spinner" /><p>Opening exploration…</p><button className="p-subtle-button" onClick={() => { window.location.hash = 'search'; }}>Back to search</button></div> : <>
      <div className="p-session-heading"><button onClick={() => { window.location.hash = 'search'; }} className="p-back"><Icon name="arrow" size={14} />New exploration</button><div><h1>{session.query}</h1><button className="p-subtle-button" title="Copy a link to this saved exploration" onClick={() => { void navigator.clipboard.writeText(window.location.href).then(() => setNotice('Exploration link copied.')).catch(() => setNotice('Use the address bar to copy this exploration link.')); }}>Copy link<Icon name="external" size={12} /></button></div>{Object.values(session.answers).length > 0 && <div className="p-context-tags">{Object.values(session.answers).filter(Boolean).map((answer, index) => <span key={`${answer}-${index}`}>{answer}</span>)}</div>}</div>
      <SearchProgress session={session} cancel={() => { void action('cancel', async () => { await personalRequest(`/sessions/${session.id}/cancel`, {}); await load(session.id); }); }} />
      {session.error && <PersonalError error={session.error} />}{['partial', 'failed', 'cancelled'].includes(session.status) && session.sources.length > 0 && <button className="vr-button vr-button-secondary" disabled={Boolean(busy)} onClick={() => { void action('retry', async () => { await personalRequest(`/sessions/${session.id}/retry`, {}); await load(session.id); }); }}><Icon name="undo" size={14} />Resume saved work</button>}
      {session.status === 'awaiting-clarification' && <section className="p-clarify"><div><span className="p-eyebrow">SHAPE THIS EXPLORATION</span><h2>What would make this useful?</h2><p>A few choices help us search with your priorities in mind.</p></div><form onSubmit={event => { event.preventDefault(); void clarify(); }}>{session.questions.map((question, index) => <fieldset key={question.id}><legend><span>0{index + 1}</span>{question.question}</legend><div className="p-option-chips">{question.options.map(option => <button key={option} type="button" className={answers[question.id] === option ? 'active' : ''} aria-pressed={answers[question.id] === option} onClick={() => setAnswers(previous => ({ ...previous, [question.id]: option }))}>{option}{answers[question.id] === option && <Icon name="check" size={12} />}</button>)}</div><input aria-label={`Your answer: ${question.question}`} placeholder="Or answer in your own words…" maxLength={1000} value={answers[question.id] || ''} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} /></fieldset>)}<div className="p-clarify-actions"><button className="vr-button vr-button-primary" disabled={Boolean(busy)}>Explore with this context<Icon name="arrow" size={15} /></button><button className="p-subtle-button" type="button" disabled={Boolean(busy)} onClick={() => void clarify(true)}>Use my profile · search now</button></div></form></section>}
      {(session.sources.length > 0 || ranking.length > 0) && <><div className="p-results-toolbar"><div className="p-result-tabs" role="tablist" aria-label="Exploration views">{([{ id: 'cards', label: 'Ranked cards', count: ranking.length }, { id: 'sources', label: 'All sources', count: session.sources.length }, { id: 'answer', label: 'Synthesis' }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{'count' in item && <span>{item.count}</span>}</button>)}</div>{ranking.length > 1 && <button className="p-subtle-button" disabled={Boolean(busy) || active} onClick={() => { void action('dataset', async () => { const { dataset } = await personalRequest<{ dataset: PersonalDataset }>(`/sessions/${session.id}/dataset`, {}); await refresh(); window.location.hash = `arena/${dataset.id}`; }); }}><Icon name="compare" size={14} />Practice in Arena</button>}</div>
      {tab === 'cards' ? <div className="p-results-layout"><div className="p-information-list">{compareIds.length > 0 && <div className="p-compare-hint" role="status"><Icon name="compare" size={16} />Now choose another card to compare.<button onClick={() => setCompareIds([])}>Cancel</button></div>}{ranking.map((unit, index) => <InformationCard key={`${unit.id}-${unit.version}`} unit={unit} index={index} sources={session.sources} disabled={Boolean(busy) || active} saved={savedIds.includes(unit.id)} known={knownIds.includes(unit.id) || unit.knownConcepts.length > 0} selected={compareIds.includes(unit.id)} onObserve={(item, kind) => void observe(item, kind)} onCompare={() => void compare(unit.id)} onOpen={() => recordOpen(unit)} />)}{!ranking.length && <div className="p-empty">{active ? <><span className="vr-spinner" /><p>Turning source passages into information cards…</p></> : session.status === 'awaiting-clarification' ? <><Icon name="search" size={24} /><h3>Your context comes first.</h3><p>Answer the questions above or use your profile to continue.</p></> : <><Icon name="source" size={24} /><h3>No verified information cards yet.</h3><p>{['failed', 'cancelled', 'partial'].includes(session.status) ? 'Processing has stopped. Resume saved work above to continue, or browse the sources.' : 'Browse the original sources for the evidence gathered in this exploration.'}</p></>}</div>}</div><aside className="p-search-side"><section><span className="p-eyebrow">YOUR RANKING ENGINE</span><div className="p-personal-core"><Icon name="memory" size={28} /></div><h3>A point of view.<br />Built with you.</h3><p>Compare two cards to teach the engine which information deserves your time.</p><div className="p-mini-stats"><span><strong>{snapshot.trainingCount}</strong>training choices</span><span><strong>{snapshot.facts.filter(fact => fact.kind === 'knowledge').length}</strong>known concepts</span></div><a href="#memory">Inspect your memory<Icon name="arrow" size={13} /></a></section><section className="p-side-note"><Icon name="source" size={17} /><p>Appeal and evidence are different. A high-ranked card still deserves a look at its sources.</p></section></aside></div> : tab === 'sources' ? <div className="p-source-list">{session.sources.slice().sort((a, b) => (a.originalRank ?? 0) - (b.originalRank ?? 0)).map((source, index) => <article key={`${source.id}-${source.version}`}><span className="p-source-order">{String(index + 1).padStart(2, '0')}</span><div><div className="p-source-meta">{source.publisher || domainLabel(source.url)}<span>·</span>{source.provenance.replaceAll('-', ' ')}</div><a href={safeExternalUrl(source.url)} target="_blank" rel="noreferrer"><h3>{source.title}</h3><Icon name="external" size={14} /></a><p>{source.text.slice(0, 500)}{source.text.length > 500 ? '…' : ''}</p><small>{source.publishedAt ? `Published ${relativeDate(source.publishedAt)} · ` : ''}Retrieved {relativeDate(source.retrievedAt)}</small><details><summary>Read retrieved passage</summary><div className="p-source-text">{source.text}</div>{source.limitations?.map(limit => <p className="p-caption" key={limit}>{limit}</p>)}</details></div></article>)}</div> : <section className="p-synthesis"><span className="p-eyebrow">ASSEMBLED FROM YOUR EXPLORATION</span><h2>A clearer picture.</h2>{session.answer ? <div className="p-answer-text">{session.answer.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph.split(/(\[unit:[^\]]+\])/g).map((part, i) => { const match = part.match(/^\[unit:(.+)@(\d+)\]$/); const unit = match ? ranking.find(item => item.id === match[1] && item.version === Number(match[2])) : undefined; return unit ? <button className="p-citation" key={i} onClick={() => { setTab('cards'); window.setTimeout(() => document.getElementById(`unit-${unit.id}-${unit.version}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }), 50); }}>Card {ranking.indexOf(unit) + 1}</button> : part; })}</p>)}</div> : <p>Your synthesis will appear after source grounding.</p>}<div className="p-synthesis-evidence"><h3>Explore the evidence</h3>{ranking.slice(0, 8).map(unit => <details key={unit.id}><summary>{unit.title}</summary><p>{unit.body}</p><UnitEvidence unit={unit} sources={session.sources} onOpen={() => recordOpen(unit)} /></details>)}</div></section>}
      </>}
      {!active && ranking.length > 0 && <section className="p-refine"><span className="p-eyebrow">KEEP SHAPING THE PICTURE</span>{session.followUp && !hideFollowUp ? <><h2>{session.followUp.question}</h2><div className="p-option-chips">{session.followUp.options.map(option => <button disabled={Boolean(busy)} key={option} onClick={() => void refine(option)}>{option}<Icon name="arrow" size={12} /></button>)}<button className="p-skip-question" onClick={() => setHideFollowUp(true)}>Skip this question</button></div></> : <h2>What should rise to the top?</h2>}<form onSubmit={event => { event.preventDefault(); void refine(refinement); }}><input value={refinement} maxLength={1000} onChange={event => setRefinement(event.target.value)} aria-label="Refine this exploration" placeholder="More technical depth, a lower budget, a missing perspective…" /><button aria-label="Apply refinement" disabled={Boolean(busy) || !refinement.trim()}><Icon name="arrow" size={18} /></button></form><label className="p-research-option"><input type="checkbox" checked={research} onChange={event => setResearch(event.target.checked)} />Search the web again for missing evidence</label><p>Refine this exploration’s priorities. Your lasting preferences come from your choices.</p></section>}
    </>}
    {notice && <div className="p-notice" role="status"><Icon name="check" size={15} />{notice}</div>}
    {comparison && <PersonalDialog title="Which is more useful to you?" wide onClose={() => { setComparison(null); setResult(null); }}><PersonalComparison pair={comparison} result={result} busy={Boolean(busy)} onChoose={choose} onNext={() => { setComparison(null); setResult(null); }} onUndo={result ? async () => { await action('undo', async () => { await personalRequest(`/choices/${result.comparison.id}`, {}, 'DELETE'); setResult(null); setComparison(null); await load(session!.id); await refresh(); }); } : undefined} nextLabel="Back to my ranking" /></PersonalDialog>}
  </div>;
}
