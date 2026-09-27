import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { PersonalComparisonPrompt, PersonalComparisonResult, PersonalDataset, PersonalRankedUnit, PersonalSearchSession, PersonalSnapshot, PersonalSource, PersonalUnit, ComparisonChoice } from '../domain/personal';
import PersonalComparison from './PersonalComparison';
import { PersonalIcon as Icon, PersonalError, PersonalDialog } from './PersonalShared';
import { personalRequest, relativeDate, domainLabel, safeExternalUrl } from './personal-utils';
import type { ResearchProject, ResearchProjectDetail, ResearchSave } from '../domain/research';
import './research.css';
import './research-coverage.css';
import { RankUpdate, WhyRanked, type RankingUpdate } from './RankingFeedback';

interface SearchDetail { session: PersonalSearchSession; ranking: PersonalRankedUnit[]; dataset?: PersonalDataset; project?: ResearchProjectDetail; saved?: ResearchSave[] }
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
  return <details className="p-evidence"><summary><Icon name="source" size={14} />{unit.evidence.length} evidence {unit.evidence.length === 1 ? 'passage' : 'passages'}<span>Inspect sources</span></summary><div>{unit.sourceSupport && <p className="p-caption">Jev passage-match estimate: {unit.sourceSupport.score.toFixed(2)}. An automated screening signal, not a calibrated probability or independent fact check.</p>}{unit.evidence.map((evidence, index) => { const source = sources.find(item => item.id === evidence.sourceId && item.version === evidence.sourceVersion); return <article key={`${evidence.sourceId}-${index}`}><blockquote>“{evidence.quote}”</blockquote>{source && <a href={safeExternalUrl(source.url)} target="_blank" rel="noreferrer" onClick={onOpen}>{source.title}<Icon name="external" size={12} /></a>}<small>{source?.provenance.replaceAll('-', ' ')}{source?.publishedAt ? ` · Published ${relativeDate(source.publishedAt)}` : ''}{source ? ` · Retrieved ${relativeDate(source.retrievedAt)}` : ''}</small></article>; })}{unit.limitations.length > 0 && <div className="p-limitations"><strong>Keep in mind</strong>{unit.limitations.map(limit => <p key={limit}>{limit}</p>)}</div>}</div></details>;
}
function ResearchCoverage({ session }: { session: PersonalSearchSession }) {
  const plan = session.researchPlan;
  if (!plan) return null;
  return <details className="r-coverage" open={session.status === 'awaiting-clarification'}>
    <summary><Icon name="source" size={15} />Research scope<span>{plan.options.length ? `${plan.options.length} alternatives · ` : ''}{plan.facets.length} decision criteria</span></summary>
    <p>Evidence coverage shows what these cards address. It does not establish source accuracy or a complete comparison.</p>
    <div>{plan.options.map(option => {
      const count = session.units.filter(unit => unit.researchTags?.optionIds.includes(option.id)).length;
      return <article key={option.id}><strong>{option.label}</strong><span className={count ? 'has-evidence' : ''}>{count ? `${count} ${count === 1 ? 'card' : 'cards'} with evidence` : ACTIVE.has(session.status) || session.status === 'awaiting-clarification' ? 'To investigate' : 'Evidence gap'}</span></article>;
    })}</div>
    <div className="r-coverage-facets">{plan.facets.map(facet => <span key={facet.id}>{facet.label}<small>{session.units.filter(unit => unit.researchTags?.facetIds.includes(facet.id)).length} cards</small></span>)}</div>
    <details><summary>Planned searches</summary><ol>{plan.queries.map(query => <li key={query}>{query}</li>)}</ol></details>
  </details>;
}
function SynthesisReview({ session }: { session: PersonalSearchSession }) {
  const review = session.answerReview;
  if (!review || review.status === 'passed') return null;
  return <section className="r-synthesis-review" aria-label="Unaccepted synthesis draft">
    <span className="p-eyebrow">{review.status === 'checking' ? 'CHECKING THE DRAFT' : 'DRAFT NEEDS SOURCE REVIEW'}</span>
    <h3>{review.status === 'checking' ? 'Comparing each claim with its passages.' : 'A source check needs a closer look.'}</h3>
    <p>This draft has not been accepted as a completed synthesis. Your ranked cards remain available; the original passages are below.</p>
    {review.checks.map(check => <details key={check.id} className={`r-claim-check is-${check.status}`}><summary><span>{check.status === 'matched' ? 'Passage match' : check.status === 'flagged' ? 'Possible mismatch' : check.status === 'unavailable' ? 'Check unavailable' : 'Checking…'}</span>{check.claim}</summary>{check.error && <p>{check.error}</p>}{check.unitIds.map(id => { const unit = session.units.find(unit => unit.id === id); return unit ? <div className="r-check-evidence" key={id}><strong>{unit.title}</strong><UnitEvidence unit={unit} sources={session.sources} /></div> : null; })}</details>)}
    <small>Jev’s passage checks are fallible. A match does not independently establish a source’s accuracy.</small>
  </section>;
}
function InformationCard({ unit, index, sources, onObserve, onCompare, onOpen, saved, known, selected, disabled }: { unit: PersonalRankedUnit; index: number; sources: PersonalSource[]; onObserve: (unit: PersonalUnit, kind: 'save' | 'known') => void; onCompare: () => void; onOpen: () => void; saved: boolean; known: boolean; selected: boolean; disabled: boolean }) {
  const source = sources.find(item => item.id === unit.sourceIds[0]);
  return <article data-rank-id={unit.id} id={`unit-${unit.id}-${unit.version}`} className={`p-information ${index === 0 ? 'p-information-first' : ''} ${selected ? 'is-selected' : ''}`} style={{ '--card-index': Math.min(index, 6) } as React.CSSProperties}>
    <div className="p-information-top"><span className="p-rank-number">{String(index + 1).padStart(2, '0')}</span><span>{unit.kind.replaceAll('-', ' ')}</span>{source && <a href={safeExternalUrl(source.url)} target="_blank" rel="noreferrer" onClick={onOpen}>{source.publisher || domainLabel(source.url)}<Icon name="external" size={11} /></a>}<span className="p-information-effort">{unit.effortMinutes} min</span></div>
    <h3>{unit.title}</h3><p className="p-information-body">{unit.body}</p>
    <div className="p-card-insights">{unit.knownConcepts.length > 0 && <span><Icon name="known" size={12} />{unit.knownConcepts.length} of {unit.concepts.length} concepts familiar</span>}{Math.abs(unit.personalAdjustment) > 0.0001 && <span className="p-personal-insight"><Icon name="memory" size={12} />{unit.personalAdjustment > 0 ? 'Raised' : 'Lowered'} by your choices</span>}<span title="Relative ranking utility; not a probability.">Value {Number.isFinite(unit.score) ? unit.score.toFixed(2) : '—'}</span></div>
    <WhyRanked unit={unit} />
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
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [targetProject, setTargetProject] = useState('');
  const [saveUnit, setSaveUnit] = useState<PersonalUnit | null>(null);
  const [knownIds, setKnownIds] = useState<string[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<PersonalComparisonPrompt | null>(null);
  const [result, setResult] = useState<PersonalComparisonResult | null>(null);
  const [rankingUpdate, setRankingUpdate] = useState<RankingUpdate | null>(null);
  const rankedList = useRef<HTMLDivElement>(null);
  const priorPositions = useRef(new Map<string, number>());
  const [refinement, setRefinement] = useState('');
  const [hideFollowUp, setHideFollowUp] = useState(false);
  const [research, setResearch] = useState(false);
  const requestEpoch = useRef(0);
  const currentSessionId = useRef(sessionId);
  const session = detail?.session;
  const sessionStatus = session?.status;
  const active = Boolean(sessionStatus && ACTIVE.has(sessionStatus));
  useEffect(() => { let disposed = false; void personalRequest<{ projects: ResearchProject[] }>('/projects').then(value => { if (!disposed) setProjects(value.projects); }).catch(() => { /* Project operations surface errors when used. */ }); return () => { disposed = true; }; }, []);
  const load = useCallback(async (id: string) => {
    const epoch = requestEpoch.current;
    try { const next = await personalRequest<SearchDetail>(`/sessions/${encodeURIComponent(id)}`); if (epoch === requestEpoch.current && id === currentSessionId.current) { setDetail(next); return next; } }
    catch (e) { if (epoch === requestEpoch.current && id === currentSessionId.current) setError(e instanceof Error ? e.message : 'Could not load this exploration.'); }
  }, []);
  useEffect(() => {
    const onHash = () => { const id = sessionFromHash(); requestEpoch.current += 1; currentSessionId.current = id; setSessionId(id); setComparison(null); setResult(null); setSaveUnit(null); setNotice(''); setTab('cards'); setResearch(false); setRefinement(''); setDetail(null); setAnswers({}); setCompareIds([]); setError(''); setHideFollowUp(false); setRankingUpdate(null); setKnownIds([]); priorPositions.current.clear(); };
    window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => { if (sessionId) void load(sessionId); }, [sessionId, load]);
  useEffect(() => { if (!sessionId || !active) return; const timer = window.setInterval(() => void load(sessionId), 900); return () => window.clearInterval(timer); }, [sessionId, active, load]);
  useEffect(() => { if (sessionStatus && !active) void refresh(); }, [sessionStatus, active, refresh]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 6500); return () => window.clearTimeout(timer); }, [notice]);
  async function action<T>(name: string, callback: () => Promise<T>): Promise<T | undefined> {
    if (busy) return undefined;
    const epoch = requestEpoch.current; setBusy(name); setError('');
    try { const value = await callback(); return epoch === requestEpoch.current ? value : undefined; } catch (e) { if (epoch === requestEpoch.current) setError(e instanceof Error ? e.message : 'The action could not be completed.'); return undefined; } finally { setBusy(''); }
  }
  function openSession(id: string) { window.location.hash = `search/${encodeURIComponent(id)}`; }
  async function start(event?: FormEvent, example?: string) {
    event?.preventDefault(); const text = (example || query).trim(); if (!text || busy) return;
    const next = await action('search', async () => {
      let projectId = targetProject;
      if (!projectId) { const created = await personalRequest<{ project: ResearchProject }>('/projects', { title: text.slice(0, 100), goal: text.length >= 3 ? text : `Research ${text}`, constraints: '' }); projectId = created.project.id; setTargetProject(projectId); setProjects(items => [created.project, ...items]); }
      return personalRequest<{ session: PersonalSearchSession }>('/sessions', { query: text, projectId });
    });
    if (next) { setQuery(''); setTab('cards'); openSession(next.session.id); void refresh(); }
  }
  async function clarify(useProfile = false) {
    if (!session) return;
    await action('clarify', async () => { await personalRequest(`/sessions/${session.id}/clarify`, { answers, useProfile }); await load(session.id); });
  }
  async function observe(unit: PersonalUnit, kind: 'save' | 'known') {
    if (!session) return;
    if (kind === 'save' && !detail?.project) { setSaveUnit(unit); return; }
    await action(`observe-${unit.id}`, async () => {
      if (kind === 'save' && detail?.project) await personalRequest(`/projects/${detail.project.project.id}/saved`, { sessionId: session.id, unitId: unit.id, unitVersion: unit.version });
      await personalRequest('/observations', { unitId: unit.id, unitVersion: unit.version, kind, context: session.context });
      if (kind === 'save') { setNotice('Saved to your project shortlist.'); await load(session.id); }
      else { setKnownIds(ids => [...ids, unit.id]); setNotice('Card concepts marked familiar. Your cards have been reranked; correct this in Memory.'); await load(session.id); }
      await refresh();
    });
  }
  async function saveToProject() {
    if (!session || !saveUnit) return;
    await action('save', async () => {
      let projectId = targetProject;
      if (!projectId) { const created = await personalRequest<{ project: ResearchProject }>('/projects', { title: session.query.slice(0, 100), goal: session.context.goal.length >= 3 ? session.context.goal.slice(0, 1000) : `Research ${session.query}`, constraints: '' }); projectId = created.project.id; setTargetProject(projectId); setProjects(items => [created.project, ...items]); }
      await personalRequest(`/projects/${projectId}/saved`, { sessionId: session.id, unitId: saveUnit.id, unitVersion: saveUnit.version });
      setSaveUnit(null); setNotice('Saved with its source passages. Find it in Projects.'); await load(session.id);
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
      if (session.id === currentSessionId.current) { setComparison(next); setResult(null); setCompareIds([]); }
    });
  }
  async function choose(choice: ComparisonChoice, reason: string) {
    if (!comparison || !session) return;
    const previous = new Map((detail?.ranking ?? []).map((unit, index) => [unit.id, index + 1]));
    await action('choice', async () => {
      const next = await personalRequest<PersonalComparisonResult>('/choices', { exposureId: comparison.exposure.id, choice, reason }); if (session.id === currentSessionId.current) setResult(next);
      const updated = await load(session.id);
      if (updated) setRankingUpdate({ comparisonId: next.comparison.id, modelVersion: next.modelVersion, trained: ['a', 'b', 'tie'].includes(choice), choice: choice === 'a' || choice === 'b' ? `You chose “${comparison[choice].title}”` : choice === 'tie' ? 'You valued both equally' : choice === 'neither' ? 'Neither card was useful' : 'You skipped this comparison', changes: updated.ranking.flatMap((unit, index) => { const before = previous.get(unit.id); return before && before !== index + 1 ? [{ id: unit.id, title: unit.title, before, after: index + 1 }] : []; }).sort((a, b) => (b.before - b.after) - (a.before - a.after)) });
      await refresh();
    });
  }
  async function undoChoice(id: string) { if (!session) return; await action('undo', async () => { await personalRequest(`/choices/${id}`, {}, 'DELETE'); setResult(null); setComparison(null); setRankingUpdate(null); await load(session.id); await refresh(); }); }
  async function teachRanking() {
    if (!session) return;
    await action('compare', async () => {
      const { dataset } = detail?.dataset ? { dataset: detail.dataset } : await personalRequest<{ dataset: PersonalDataset }>(`/sessions/${session.id}/dataset`, {});
      const next = await personalRequest<PersonalComparisonPrompt>('/pairs', { datasetId: dataset.id, mode: 'learn' }); if (session.id === currentSessionId.current) { setComparison(next); setResult(null); setCompareIds([]); }
    });
  }
  async function refine(text: string) {
    if (!session || !text.trim()) return;
    await action('refine', async () => { await personalRequest(`/sessions/${session.id}/refine`, { text, research }); setResearch(false); setRefinement(''); setHideFollowUp(false); await load(session.id); });
  }
  const ranking = detail?.ranking || [];
  const rankOrder = ranking.map(unit => unit.id).join('|');
  useLayoutEffect(() => {
    const next = new Map<string, number>();
    for (const card of rankedList.current?.querySelectorAll<HTMLElement>('[data-rank-id]') ?? []) {
      const id = card.dataset.rankId!; const position = card.offsetTop; const before = priorPositions.current.get(id); next.set(id, position);
      if (before !== undefined && before !== position && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) card.animate([{ transform: `translateY(${before - position}px)`, opacity: .7 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    priorPositions.current = next;
  }, [rankOrder, tab]);
  return <div className={`p-search-page ${sessionId ? 'has-session' : ''}`}>
    <PersonalError error={error} dismiss={() => setError('')} />
    {!sessionId ? <><section className="p-search-hero"><div className="p-hero-orbit" aria-hidden="true"><span /><span /><span /><i><Icon name="spark" size={27} /></i></div><span className="p-eyebrow">THE WEB, THROUGH YOUR LENS</span><h1>Find what matters.<br /><span>To you.</span></h1><p>Explore freely. Make sense of the sources.<br />Build an engine that learns what you value.</p><form className="p-search-box" onSubmit={event => void start(event)}><Icon name="search" size={21} /><input aria-label="What do you want to explore?" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} placeholder="What do you want to explore?" autoFocus /><button aria-label="Start exploration" disabled={!query.trim() || Boolean(busy)}>{busy === 'search' ? <span className="vr-spinner" /> : <Icon name="arrow" size={20} />}</button></form><div className="r-search-context"><span>Research for</span><select aria-label="Search project" value={targetProject} onChange={event => setTargetProject(event.target.value)}><option value="">New project for this search</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select><a href="#projects">All projects<Icon name="arrow" size={12} /></a></div><div className="p-examples">{EXAMPLES.map(example => <button key={example} onClick={() => void start(undefined, example)} disabled={Boolean(busy)}>{example}<Icon name="arrow" size={12} /></button>)}</div></section><section className="p-search-explainer"><div><span>01</span><Icon name="source" /><h3>Keep the whole picture.</h3><p>Real sources, useful comparisons, and the details that could change your mind.</p></div><div><span>02</span><Icon name="spark" /><h3>Get to the useful parts.</h3><p>Independently readable cards, grounded in passages you can inspect.</p></div><div><span>03</span><Icon name="memory" /><h3>Make it yours.</h3><p>Choose what matters more. Your comparisons train your personal ranking model.</p></div></section><section className="p-recent"><div className="p-section-head"><h2>Recent explorations</h2><span>{snapshot.recentSessions.length} saved</span></div>{snapshot.recentSessions.length ? <div className="p-recent-grid">{snapshot.recentSessions.slice(0, 8).map(item => <button key={item.id} onClick={() => openSession(item.id)}><Icon name="history" size={17} /><div><strong>{item.query}</strong><span>{item.unitCount} cards · {relativeDate(item.createdAt)} · {item.status.replaceAll('-', ' ')}</span></div><Icon name="arrow" size={15} /></button>)}</div> : <div className="p-recent-empty"><Icon name="history" /><p>Your first exploration starts above.<span>Sources, context, and choices stay in your workspace.</span></p></div>}</section></> : !session ? <div className="p-empty"><span className="vr-spinner" /><p>Opening exploration…</p><button className="p-subtle-button" onClick={() => { window.location.hash = 'search'; }}>Back to search</button></div> : <>
      <div className="p-session-heading"><button onClick={() => { window.location.hash = 'search'; }} className="p-back"><Icon name="arrow" size={14} />New exploration</button><div><h1>{session.query}</h1><button className="p-subtle-button" title="Copy a link to this saved exploration" onClick={() => { void navigator.clipboard.writeText(window.location.href).then(() => setNotice('Exploration link copied.')).catch(() => setNotice('Use the address bar to copy this exploration link.')); }}>Copy link<Icon name="external" size={12} /></button></div>{Object.values(session.answers).length > 0 && <div className="p-context-tags">{Object.values(session.answers).filter(Boolean).map((answer, index) => <span key={`${answer}-${index}`}>{answer}</span>)}</div>}</div>
      {detail?.project && <div className="r-session-project"><a href={`#projects/${detail.project.project.id}`}><Icon name="source" size={15} /><strong>{detail.project.project.title}</strong></a><span>Your choices learn within this project</span><a href={`#projects/${detail.project.project.id}`}><Icon name="save" size={13} />{detail.project.saved.length} saved<Icon name="arrow" size={13} /></a></div>}
      <SearchProgress session={session} cancel={() => { void action('cancel', async () => { await personalRequest(`/sessions/${session.id}/cancel`, {}); await load(session.id); }); }} />
      <ResearchCoverage session={session} />
      {(session.withheldUnits?.length ?? 0) > 0 && <details className="r-withheld"><summary>{session.withheldUnits!.length} cards held back for evidence review</summary><p>Jev flagged possible claim–passage mismatches. These cards do not enter your ranking or synthesis. The development threshold is unvalidated; inspect the original passages.</p>{session.withheldUnits!.map(({ unit, reason }) => <article key={`${unit.id}-${unit.version}`}><h3>{unit.title}</h3><p>{unit.body}</p><small>{reason}</small><UnitEvidence unit={unit} sources={session.sources} /></article>)}</details>}
      {session.error && <PersonalError error={session.error} />}{['partial', 'failed', 'cancelled'].includes(session.status) && session.sources.length > 0 && <button className="vr-button vr-button-secondary" disabled={Boolean(busy)} onClick={() => { void action('retry', async () => { await personalRequest(`/sessions/${session.id}/retry`, {}); await load(session.id); }); }}><Icon name="undo" size={14} />Resume saved work</button>}
      {session.status === 'awaiting-clarification' && <section className="p-clarify"><div><span className="p-eyebrow">SHAPE THIS EXPLORATION</span><h2>{session.questions.length ? 'What would make this useful?' : 'Your research scope is ready.'}</h2><p>{session.questions.length ? 'A few choices help us search with your priorities in mind.' : 'Your question already supplies enough context. Review the scope above and start your investigation.'}</p></div><form onSubmit={event => { event.preventDefault(); void clarify(); }}>{session.questions.map((question, index) => <fieldset key={question.id}><legend><span>0{index + 1}</span>{question.question}</legend><div className="p-option-chips">{question.options.map(option => <button key={option} type="button" className={answers[question.id] === option ? 'active' : ''} aria-pressed={answers[question.id] === option} onClick={() => setAnswers(previous => ({ ...previous, [question.id]: option }))}>{option}{answers[question.id] === option && <Icon name="check" size={12} />}</button>)}</div><input aria-label={`Your answer: ${question.question}`} placeholder="Or answer in your own words…" maxLength={500} value={answers[question.id] || ''} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} /></fieldset>)}<div className="p-clarify-actions"><button className="vr-button vr-button-primary" disabled={Boolean(busy)}>Explore with this context<Icon name="arrow" size={15} /></button>{session.questions.length > 0 && <button className="p-subtle-button" type="button" disabled={Boolean(busy)} onClick={() => void clarify(true)}>Continue without answers</button>}</div></form></section>}
      {(session.sources.length > 0 || ranking.length > 0) && <><div className="p-results-toolbar"><div className="p-result-tabs" role="tablist" aria-label="Exploration views">{([{ id: 'cards', label: 'Ranked cards', count: ranking.length }, { id: 'sources', label: 'All sources', count: session.sources.length }, { id: 'answer', label: 'Synthesis' }] as const).map(item => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}{'count' in item && <span>{item.count}</span>}</button>)}</div>{ranking.length > 1 && <button className="p-subtle-button" disabled={Boolean(busy) || active} onClick={() => { void action('dataset', async () => { const { dataset } = await personalRequest<{ dataset: PersonalDataset }>(`/sessions/${session.id}/dataset`, {}); await refresh(); if (session.id === currentSessionId.current) window.location.hash = `arena/${dataset.id}`; }); }}><Icon name="compare" size={14} />Practice in Arena</button>}</div>
      {tab === 'cards' ? <div className="p-results-layout"><div className="p-information-list" ref={rankedList}>{rankingUpdate && <RankUpdate update={rankingUpdate} disabled={Boolean(busy) || active} undo={() => void undoChoice(rankingUpdate.comparisonId)} dismiss={() => setRankingUpdate(null)} />}{compareIds.length > 0 && <div className="p-compare-hint" role="status"><Icon name="compare" size={16} />Now choose another card to compare.<button onClick={() => setCompareIds([])}>Cancel</button></div>}{ranking.map((unit, index) => <InformationCard key={unit.id} unit={unit} index={index} sources={session.sources} disabled={Boolean(busy) || active} saved={Boolean(detail?.saved?.some(item => item.unit.id === unit.id && item.unit.version === unit.version))} known={knownIds.includes(unit.id) || (unit.concepts.length > 0 && unit.knownConcepts.length === unit.concepts.length)} selected={compareIds.includes(unit.id)} onObserve={(item, kind) => void observe(item, kind)} onCompare={() => void compare(unit.id)} onOpen={() => recordOpen(unit)} />)}{!ranking.length && <div className="p-empty">{active ? <><span className="vr-spinner" /><p>Turning source passages into information cards…</p></> : session.status === 'awaiting-clarification' ? <><Icon name="search" size={24} /><h3>Your context comes first.</h3><p>Review the scope above and continue when you are ready.</p></> : <><Icon name="source" size={24} /><h3>No ranked information cards yet.</h3><p>{['failed', 'cancelled', 'partial'].includes(session.status) ? 'Processing has stopped. Resume saved work above to continue, or browse the sources.' : 'Browse the original sources for the evidence gathered in this exploration.'}</p></>}</div>}</div><aside className="p-search-side"><section><span className="p-eyebrow">YOUR RANKING ENGINE</span><div className="p-personal-core"><Icon name="memory" size={28} /></div><h3>A point of view.<br />Built with you.</h3><p>Compare two cards to teach the engine which information deserves your time.</p><button className="vr-button vr-button-primary r-teach-button" disabled={Boolean(busy) || active || ranking.length < 2} onClick={() => void teachRanking()}><Icon name="compare" size={14} />Teach my ranking</button><div className="p-mini-stats"><span><strong>{snapshot.models.filter(model => model.domain === 'content' && model.scopeId === session.context.scopeId).reduce((sum, model) => sum + model.trainingCount, 0)}</strong>choices in this scope</span><span><strong>{snapshot.facts.filter(fact => fact.kind === 'knowledge').length}</strong>known concepts</span></div><a href="#memory">Inspect your memory<Icon name="arrow" size={13} /></a></section><section className="p-side-note"><Icon name="source" size={17} /><p>Appeal and evidence are different. A high-ranked card still deserves a look at its sources.</p></section></aside></div> : tab === 'sources' ? <div className="p-source-list">{session.sources.slice().sort((a, b) => (a.originalRank ?? 0) - (b.originalRank ?? 0)).map((source, index) => <article key={`${source.id}-${source.version}`}><span className="p-source-order">{String(index + 1).padStart(2, '0')}</span><div><div className="p-source-meta">{source.publisher || domainLabel(source.url)}<span>·</span>{source.provenance.replaceAll('-', ' ')}</div><a href={safeExternalUrl(source.url)} target="_blank" rel="noreferrer"><h3>{source.title}</h3><Icon name="external" size={14} /></a><p>{source.text.slice(0, 500)}{source.text.length > 500 ? '…' : ''}</p><small>{source.publishedAt ? `Published ${relativeDate(source.publishedAt)} · ` : ''}Retrieved {relativeDate(source.retrievedAt)}</small><details><summary>Read retrieved passage</summary><div className="p-source-text">{source.text}</div>{source.limitations?.map(limit => <p className="p-caption" key={limit}>{limit}</p>)}</details></div></article>)}</div> : <section className="p-synthesis"><span className="p-eyebrow">ASSEMBLED FROM YOUR EXPLORATION</span><h2>A clearer picture.</h2>{session.answer && !session.answerReview && <p className="p-caption">Saved from an earlier run. Automated passage checks were not recorded for this synthesis.</p>}<SynthesisReview session={session} />{session.answerReview?.status === 'passed' && <p className="p-caption">Automated passage checks completed for {session.answerReview.checks.length} statements. Inspect the citations for the supporting context.</p>}{session.answer ? <div className="p-answer-text">{session.answer.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph.split(/(\[unit:[^\]]+\])/g).map((part, i) => { const match = part.match(/^\[unit:(.+)@(\d+)\]$/); const unit = match ? ranking.find(item => item.id === match[1] && item.version === Number(match[2])) : undefined; return unit ? <button className="p-citation" key={i} onClick={() => { setTab('cards'); window.setTimeout(() => document.getElementById(`unit-${unit.id}-${unit.version}`)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }), 50); }}>Card {ranking.indexOf(unit) + 1}</button> : part; })}</p>)}</div> : !session.answerReview && <p>Your synthesis will appear after source grounding.</p>}<div className="p-synthesis-evidence"><h3>Explore the evidence</h3>{ranking.slice(0, 8).map(unit => <details key={unit.id}><summary>{unit.title}</summary><p>{unit.body}</p><UnitEvidence unit={unit} sources={session.sources} onOpen={() => recordOpen(unit)} /></details>)}</div></section>}
      </>}
      {!active && ranking.length > 0 && <section className="p-refine"><span className="p-eyebrow">KEEP SHAPING THE PICTURE</span>{session.followUp && !hideFollowUp ? <><h2>{session.followUp.question}</h2><div className="p-option-chips">{session.followUp.options.map(option => <button disabled={Boolean(busy)} key={option} onClick={() => void refine(option)}>{option}<Icon name="arrow" size={12} /></button>)}<button className="p-skip-question" onClick={() => setHideFollowUp(true)}>Skip this question</button></div></> : <h2>What should rise to the top?</h2>}<form onSubmit={event => { event.preventDefault(); void refine(refinement); }}><input value={refinement} maxLength={700} onChange={event => setRefinement(event.target.value)} aria-label="Refine this exploration" placeholder="More technical depth, a lower budget, a missing perspective…" /><button aria-label="Apply refinement" disabled={Boolean(busy) || !refinement.trim()}><Icon name="arrow" size={18} /></button></form><label className="p-research-option"><input type="checkbox" checked={research} onChange={event => setResearch(event.target.checked)} />Search the web again for missing evidence</label><p>Refine this exploration’s priorities. Your lasting preferences come from your choices.</p></section>}
    </>}
    {saveUnit && <PersonalDialog title="Save evidence to a project" onClose={() => setSaveUnit(null)}><div className="r-project-form"><p>{saveUnit.title}</p><label>Project<select value={targetProject} onChange={event => setTargetProject(event.target.value)}><option value="">Create a project for this exploration</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select></label><button className="vr-button vr-button-primary" disabled={Boolean(busy)} onClick={() => void saveToProject()}>Save with source passages</button></div></PersonalDialog>}
    {notice && <div className="p-notice" role="status"><Icon name="check" size={15} />{notice}</div>}
    {comparison && <PersonalDialog title="Which is more useful to you?" wide onClose={() => { setComparison(null); setResult(null); }}><PersonalComparison pair={comparison} result={result} busy={Boolean(busy)} onChoose={choose} onNext={() => { setComparison(null); setResult(null); }} onUndo={result ? () => undoChoice(result.comparison.id) : undefined} nextLabel="Back to my ranking" /></PersonalDialog>}
  </div>;
}
