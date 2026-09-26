import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import SignalLab from './components/SignalLab';
import type { AppState, FeedbackKind, RankedItem, Topic } from './domain/types';

const TOPIC_NAMES: Record<Topic, string> = {
  agents: 'AI agents', ranking: 'Ranking & retrieval', rl: 'Reinforcement learning',
  web: 'Web engineering', language: 'Language learning', design: 'Product design',
};
const GOALS = [
  { name: 'Build ValueRank', text: 'Build ValueRank: a personalized content ranking engine with an AI agent harness and Jev.' },
  { name: 'Language learning', text: 'Build an effective language-learning product using personalization, retrieval practice, and AI.' },
  { name: 'Ship a web product', text: 'Ship a well-designed web product with React, Next.js, and Vercel.' },
];
type View = 'signal' | 'queue' | 'knowledge' | 'pipeline';
type IconName = 'queue' | 'spark' | 'brain' | 'pipeline' | 'plus' | 'arrow' | 'check' | 'close' | 'external' | 'like' | 'known' | 'dislike' | 'download' | 'search' | 'play' | 'info' | 'undo';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    queue: <><rect x="4" y="4" width="16" height="4" rx="1" /><rect x="4" y="11" width="16" height="4" rx="1" /><path d="M4 18h12" /></>,
    spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7L20 2Z" /></>,
    brain: <><path d="M12 5a4 4 0 0 0-7 2.6A4 4 0 0 0 3 15a4 4 0 0 0 9 4V5Zm0 0a4 4 0 0 1 7 2.6A4 4 0 0 1 21 15a4 4 0 0 1-9 4" /><path d="M7 10c3 0 3 4 1 5m9-5c-3 0-3 4-1 5" /></>,
    pipeline: <><circle cx="5" cy="5" r="2" /><circle cx="19" cy="12" r="2" /><circle cx="5" cy="19" r="2" /><path d="M7 5h4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7m7-7h3" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    external: <><path d="M14 4h6v6m0-6L10 14" /><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
    like: <><path d="M8 10v10H4V10h4Zm0 0 5-7c2 0 2 2 1 6h5a2 2 0 0 1 2 2l-2 8a2 2 0 0 1-2 1H8" /></>,
    known: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14" /></>,
    dislike: <><path d="M8 14V4H4v10h4Zm0 0 5 7c2 0 2-2 1-6h5a2 2 0 0 0 2-2l-2-8a2 2 0 0 0-2-1H8" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    play: <path d="m9 5 11 7-11 7V5Z" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.01" /></>,
    undo: <><path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`vr-brand-mark ${small ? 'small' : ''}`} aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m6 7 9 19h3L9 7H6Zm11 0 5 11 5-11h-4l-2 5-2-5h-2Z" fill="currentColor" /></svg></span>;
}

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, body === undefined ? undefined : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data as T;
}

function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => { dialog?.close(); }; }, []);
  return <dialog ref={ref} className={`vr-dialog ${wide ? 'vr-detail-dialog' : ''}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-labelledby="dialog-title">
    <div className="vr-dialog-head"><h2 id="dialog-title">{title}</h2><button className="vr-icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></div>
    {children}
  </dialog>;
}

function FeedbackButtons({ item, onFeedback, disabled }: { item: RankedItem; onFeedback: (id: string, kind: FeedbackKind | null) => void; disabled: boolean }) {
  const options: { kind: FeedbackKind; label: string; icon: IconName }[] = [
    { kind: 'useful', label: 'Useful', icon: 'like' },
    { kind: 'known', label: 'Already know', icon: 'known' },
    { kind: 'not_useful', label: 'Not useful', icon: 'dislike' },
  ];
  return <div className="vr-feedback" aria-label={`Feedback for ${item.title}`}>{options.map(option => <button
    key={option.kind} className={item.feedback === option.kind ? 'selected' : ''} aria-pressed={item.feedback === option.kind}
    disabled={disabled} onClick={() => onFeedback(item.id, item.feedback === option.kind ? null : option.kind)}
  ><Icon name={option.icon} size={14} />{option.label}</button>)}</div>;
}

function ScoreBadge({ item }: { item: RankedItem }) {
  return <div className="vr-score" title="Personalized utility score. This is not a probability."><strong>{Math.round(item.score)}</strong><span>VALUE</span></div>;
}

function ModelBadge({ item }: { item: RankedItem }) {
  return <span className={`vr-model-badge ${item.scoreSource === 'jev-personalized' ? 'live' : ''}`}>
    {item.scoreSource === 'jev-personalized' ? <Icon name="spark" size={11} /> : <span className="vr-tiny-dot" />}
    {item.scoreSource === 'jev-personalized' ? 'Jev + your profile' : item.scoreSource === 'stale-jev' ? 'Local · Jev needs refresh' : 'Local ranking'}
  </span>;
}

function ArticleCard({ item, onOpen, onFeedback, busy }: { item: RankedItem; onOpen: () => void; onFeedback: (id: string, kind: FeedbackKind | null) => void; busy: boolean }) {
  const move = item.previousRank ? item.previousRank - item.rank : 0;
  const familiar = item.feedback === 'known' || Boolean(item.analysis?.concepts.length && item.newConcepts.length === 0);
  return <article className={`vr-article ${item.rank === 1 ? 'vr-top-article' : ''} ${familiar ? 'vr-known-article' : ''}`}>
    <div className="vr-card-top"><div className="vr-source"><span className="vr-source-mark">{item.publisher.slice(0, 1)}</span><span>{item.publisher}</span><span className="vr-dot-separator">·</span><span>{item.kind === 'documentation' ? 'Docs' : item.kind}</span>{item.analysis && <><span className="vr-dot-separator">·</span><span>{item.analysis.readingMinutes} min</span></>}</div><span className="vr-rank">{move !== 0 && <span className={move > 0 ? 'up' : 'down'}>{move > 0 ? '↑' : '↓'} {Math.abs(move)}</span>}#{String(item.rank).padStart(2, '0')}</span></div>
    <div className="vr-article-main"><div>{item.rank === 1 && <div className="vr-top-label">HIGHEST VALUE FOR YOUR GOAL</div>}<button className="vr-article-title" onClick={onOpen}>{item.title}</button><p className={familiar ? "vr-compressed-note" : "vr-summary"}>{familiar ? <><Icon name="known" size={13} />{item.knownConcepts.length ? `${item.knownConcepts.length} familiar concepts compressed` : 'Familiar material compressed'} · Open brief to review</> : item.analysis?.summary || `${item.text.slice(0, 190)}${item.text.length > 190 ? '…' : ''}`}</p></div><ScoreBadge item={item} /></div>
    {!familiar && <div className="vr-concepts">{item.newConcepts.slice(0, 3).map(concept => <span key={concept} className="new"><span>+</span>{concept}</span>)}{item.knownConcepts.slice(0, 2).map(concept => <span key={concept} className="known"><Icon name="check" size={11} />{concept}</span>)}</div>}
    {!familiar && <div className="vr-reason"><Icon name="spark" size={14} /><p>{item.reason}</p></div>}
    {item.error && <p className="vr-item-error"><Icon name="info" size={14} />{item.error}</p>}
    <div className="vr-article-footer"><FeedbackButtons item={item} onFeedback={onFeedback} disabled={busy} /><button className="vr-read-button" onClick={onOpen}>View brief<Icon name="arrow" size={14} /></button></div>
    <div className="vr-card-caption"><ModelBadge item={item} /><span>{item.provenance === 'editorial-brief' ? 'Source-linked editorial brief' : item.provenance === 'user-paste' ? 'Your pasted source' : 'Extracted from URL'}</span></div>
  </article>;
}

function Breakdown({ item }: { item: RankedItem }) {
  return <div className="vr-breakdown">{([
    ['Goal relevance', item.breakdown.relevance], ['New to you', item.breakdown.novelty],
    ['Actionability', item.breakdown.actionability], ['Learned preference', item.breakdown.preference],
  ] as [string, number][]).map(([label, value]) => <div className="vr-breakdown-row" key={label}><span>{label}</span><div><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div><strong>{Math.round(value * 100)}%</strong></div>)}</div>;
}

function Detail({ item, onClose, onFeedback, onAnalyze, onViewPipeline, canAnalyze, busy, error }: { item: RankedItem; onClose: () => void; onFeedback: (id: string, kind: FeedbackKind | null) => void; onAnalyze: () => void; onViewPipeline: () => void; canAnalyze: boolean; busy: boolean; error: string }) {
  return <Dialog title="Your reading brief" onClose={onClose} wide><div className="vr-detail-body">
    <div className="vr-detail-meta"><span className="vr-eyebrow">{item.publisher} / {item.kind}</span><ModelBadge item={item} /></div>
    <h3 className="vr-detail-title">{item.title}</h3>
    <div className="vr-detail-source">{item.url ? <a href={item.url} target="_blank" rel="noreferrer">Open original source<Icon name="external" size={14} /></a> : <span>Your pasted note</span>}<span>{item.analysis?.readingMinutes || '—'} min read</span></div>
    <div className="vr-source-run-actions"><button className="vr-button vr-button-primary" onClick={onAnalyze} disabled={!canAnalyze || busy} title={!canAnalyze ? 'Configure both models and save your goal before analyzing' : 'Run the engine for this source only'}><Icon name="spark" size={14} />{item.status === 'processing' ? 'Analyzing this source…' : 'Analyze this source'}</button><button className="vr-text-button" onClick={onViewPipeline}>View execution trace<Icon name="arrow" size={13} /></button></div>{(error || item.error) && <div className="vr-inline-error" role="alert"><Icon name="info" size={15} />{error || item.error}</div>}
    <section className="vr-detail-section"><h4>The essential idea</h4><p>{item.analysis?.summary || 'This source has not been analyzed yet. Run the engine to create a grounded summary.'}</p><p className="vr-caption">{item.analysis?.source === 'llm' ? `Summarized by ${item.analysis.model}.` : item.analysis ? 'Editorial summary supplied with the starter collection.' : 'No summary has been generated yet.'} {item.provenance === 'editorial-brief' ? 'The engine sees a curated brief, not the full linked page.' : ''}</p></section>
    <section className="vr-detail-section"><div className="vr-section-line"><h4>Why it ranks here</h4><strong className="vr-inline-score">{Math.round(item.score)} / 100</strong></div><p>{item.reason}</p><Breakdown item={item} />{item.decision && <div className="vr-decision-metadata"><span>Saved Jev decision</span><span>{item.decision.provider === 'openrouter' ? 'OpenRouter' : item.decision.provider === 'typesafe' ? 'TypeSafe' : 'Provider not recorded'} · {item.decision.model}</span><span>Profile v{item.decision.profileVersion} · {new Date(item.decision.createdAt).toLocaleString()}</span></div>}<details className="vr-score-formula"><summary>How your value score is calculated</summary><p>40% relevance + 26% novelty + 16% actionability + 18% preference, then adjustments for time, prior knowledge, and feedback. The result is clipped to 0–100.</p><div><span>Reading-time deduction</span><strong>−{(item.breakdown.timeCost * 6).toFixed(1)} points</strong></div><div><span>Prior-knowledge deduction</span><strong>−{(item.breakdown.knownPenalty * 100).toFixed(1)} points</strong></div><div><span>This source’s feedback</span><strong>{item.feedback === 'useful' ? '+4.0' : item.feedback === 'not_useful' ? '−18.0' : '0.0'} points</strong></div><p>These weights are a transparent prototype policy, not a learned or calibrated probability.</p></details><p className="vr-caption">Components inform a utility score, not a prediction of how often you will find this useful. {item.scoreSource === 'jev-personalized' ? 'Current Jev forecasts are blended with your goal and knowledge.' : item.scoreSource === 'stale-jev' ? 'Saved Jev forecasts belong to an older profile and are excluded until refreshed.' : 'Local signals use your goal, topics, and knowledge overlap.'}</p></section>
    <section className="vr-detail-section"><h4>What’s new. What’s familiar.</h4><div className="vr-concepts vr-detail-concepts">{item.newConcepts.map(concept => <span key={concept} className="new">+ {concept}</span>)}{item.knownConcepts.map(concept => <span key={concept} className="known"><Icon name="check" size={12} />{concept}</span>)}</div>{!item.newConcepts.length && !item.knownConcepts.length && <p className="vr-caption">Concepts will appear after analysis.</p>}</section>
    <section className="vr-detail-section"><h4>Grounded in the source</h4><p className="vr-caption">Quotes below refer to the text available to this engine{item.provenance === 'editorial-brief' ? ', which is an editorial brief' : ''}.</p>{item.analysis?.evidence.length ? item.analysis.evidence.map((evidence, index) => <div className="vr-evidence" key={index}><blockquote>“{evidence.quote}”</blockquote><p>{evidence.insight}</p></div>) : <p>No verified evidence quotes yet.</p>}</section>
    <details className="vr-raw-source"><summary>Inspect the engine’s source text</summary><p>{item.text}</p></details>
    <div className="vr-detail-sticky"><span>Was this worth your time?</span><FeedbackButtons item={item} onFeedback={onFeedback} disabled={busy} /></div>
  </div></Dialog>;
}

function AddContent({ onClose, onAdd, busy, error }: { onClose: () => void; onAdd: (body: { title: string; url: string; text: string }) => Promise<void>; busy: boolean; error: string }) {
  const [title, setTitle] = useState(''); const [url, setUrl] = useState(''); const [text, setText] = useState('');
  return <Dialog title="Add something worth reading" onClose={onClose}><form className="vr-form vr-add-form" onSubmit={event => { event.preventDefault(); void onAdd({ title, url, text }); }}>
    <p className="vr-form-intro">An article, a paper, or an idea. Give your engine a new signal.</p>{error && <div className="vr-inline-error" role="alert"><Icon name="info" size={15} />{error}</div>}
    <label>Title <span>Optional</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder="A title for your reading queue" autoFocus /></label>
    <label>Source URL <span>Optional with pasted text</span><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></label>
    <label>Source text <span>Recommended</span><textarea rows={7} value={text} onChange={e => setText(e.target.value)} placeholder="Paste the relevant article or passage. The engine will ground its summary and evidence in this text." /></label>
    <div className="vr-form-note"><Icon name="info" size={16} /><p>Without pasted text, we’ll try to extract the page. Some websites don’t allow extraction. Adding a source does not call a model until you run the engine.</p></div>
    <div className="vr-modal-actions"><button type="button" className="vr-button vr-button-secondary" onClick={onClose}>Cancel</button><button className="vr-button vr-button-primary" disabled={busy || (!url.trim() && !text.trim())}>{busy ? 'Adding…' : 'Add to queue'}<Icon name="plus" size={15} /></button></div>
  </form></Dialog>;
}

function ProfileView({ state, save, busy, reset }: { state: AppState; save: (body: object) => Promise<void>; busy: boolean; reset: () => void }) {
  const [known, setKnown] = useState(state.profile.knownConcepts.join(', '));
  const [interests, setInterests] = useState(state.profile.interests);
  const [saved, setSaved] = useState(false);
  return <div className="vr-view-body"><div className="vr-page-heading"><span className="vr-eyebrow">YOUR CONTEXT, MADE VISIBLE</span><h1>A memory that grows with you.</h1><p>Your goals, knowledge, and feedback shape what rises to the top.</p></div>
    <div className="vr-profile-grid"><form className="vr-panel vr-form" onSubmit={async event => { event.preventDefault(); try { await save({ knownConcepts: known.split(',').map(s => s.trim()).filter(Boolean), interests }); setSaved(true); } catch { /* surfaced in workspace */ } }}>
      <div className="vr-panel-heading"><Icon name="brain" /><h2>Your knowledge map</h2><span className="vr-count-pill">v{state.profile.version}</span></div>
      <p className="vr-muted">Tell ValueRank what you already understand. Familiar ideas are compressed so new ones have room.</p>
      <label>Concepts you already know<textarea rows={5} disabled={busy} value={known} onChange={e => { setKnown(e.target.value); setSaved(false); }} placeholder="React, embeddings, spaced repetition…" /><small>Separate concepts with commas. “Already know” feedback adds concepts here.</small></label>
      <div className="vr-divider" /><h3>What pulls your attention?</h3><p className="vr-muted">Starting interests. Your feedback updates these weights over time.</p>
      <div className="vr-interest-sliders">{Object.entries(TOPIC_NAMES).map(([topic, label]) => <label key={topic}><span>{label}<strong>{Math.round(interests[topic as Topic] * 100)}%</strong></span><input type="range" disabled={busy} min="0" max="1" step="0.05" value={interests[topic as Topic]} onChange={e => { setInterests({ ...interests, [topic]: Number(e.target.value) }); setSaved(false); }} /></label>)}</div>
      <button className="vr-button vr-button-primary" disabled={busy}>{saved ? <><Icon name="check" size={15} />Profile saved</> : <>Save knowledge profile<Icon name="arrow" size={15} /></>}</button>
    </form><div className="vr-profile-side"><div className="vr-panel"><span className="vr-eyebrow">THE PERSONALIZATION LOOP</span><div className="vr-memory-loop"><span>Read</span><Icon name="arrow" /><span>React</span><Icon name="arrow" /><span>Refine</span></div><h2>Small signals. Better choices.</h2><p className="vr-muted">“Useful” strengthens topic preferences. “Already know” updates your knowledge. “Not useful” reduces the pull of related topics.</p><div className="vr-stat-pair"><div><strong>{state.profile.feedbackCount}</strong><span>feedback signals</span></div><div><strong>{state.profile.knownConcepts.length}</strong><span>known concepts</span></div></div><p className="vr-caption">These are editable profile updates and local preference weights. They do not fine-tune Jev’s model weights.</p></div>
    <div className="vr-panel"><h3>Your data, inspectable.</h3><p className="vr-muted">Export your feedback history, goal context, and source metadata as JSONL for later analysis.</p><a className="vr-button vr-button-secondary vr-full-button" href="/api/export" download><Icon name="download" size={16} />Export learning data</a><button className="vr-text-button vr-reset-button" onClick={reset} disabled={busy}><Icon name="undo" size={14} />Reset profile & feedback</button><p className="vr-caption">Reset keeps your sources and saved analyses.</p></div></div></div>
    <section className="vr-panel vr-feedback-history"><div className="vr-panel-heading"><h2>Your active signals</h2><span className="vr-count-pill">{state.feedback.length}</span></div>{state.feedback.length ? state.feedback.slice().reverse().slice(0, 12).map(event => <div className="vr-history-row" key={event.id}><span className={`vr-history-kind ${event.kind}`}><Icon name={event.kind === 'useful' ? 'like' : event.kind === 'known' ? 'known' : 'dislike'} size={14} />{event.kind === 'useful' ? 'Useful' : event.kind === 'known' ? 'Already know' : 'Not useful'}</span><span>{state.items.find(item => item.id === event.itemId)?.title || 'Source'}</span><time>{new Date(event.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time></div>) : <div className="vr-empty-small">No active feedback. Mark a source to start shaping your queue.</div>}</section>
  </div>;
}

function PipelineView({ state, onOpenItem }: { state: AppState; onOpenItem: (id: string) => void }) {
  const run = state.run;
  const events = run?.events || [];
  const tokens = events.reduce((total, event) => total + (event.tokens || 0), 0);
  return <div className="vr-view-body"><div className="vr-page-heading"><span className="vr-eyebrow">OPEN THE BLACK BOX</span><h1>Every decision leaves a trace.</h1><p>Follow source extraction, grounded analysis, Jev decisions, and the final ranking.</p></div>
    <div className="vr-pipeline-stages">{([{ title: 'Source', text: 'Evidence comes first', icon: 'known' }, { title: 'LLM harness', text: 'Summarize & verify quotes', icon: 'brain' }, { title: 'Jev', text: 'Typed relevance decisions', icon: 'spark' }, { title: 'Personal rank', text: 'Your context sets the order', icon: 'queue' }] as { title: string; text: string; icon: IconName }[]).map((stage, index) => <div className="vr-pipeline-stage" key={stage.title}><span className="vr-stage-number">0{index + 1}</span><Icon name={stage.icon} size={24} /><h3>{stage.title}</h3><p>{stage.text}</p></div>)}</div>
    <div className="vr-run-stats"><div><span>Latest run</span><strong>{run ? run.status : 'Not started'}</strong></div><div><span>Sources processed</span><strong>{run ? `${run.processed} / ${run.total}` : '—'}</strong></div><div><span>Reported tokens</span><strong>{tokens ? tokens.toLocaleString() : '—'}</strong></div><div><span>Errors</span><strong>{run ? run.errors : '—'}</strong></div></div>
    <section className="vr-panel vr-trace-panel"><div className="vr-panel-heading"><h2>Execution trace</h2>{run?.status === 'running' && <span className="vr-live-pill"><i />Running</span>}<span className="vr-trace-id">{run ? run.id.slice(0, 16) : 'No model calls yet'}</span></div>{events.length ? <div className="vr-trace-events">{events.map(event => <div className={`vr-trace-event ${event.status}`} key={event.id}><span className="vr-trace-dot">{event.status === 'completed' ? <Icon name="check" size={12} /> : event.status === 'failed' ? '!' : <span className="vr-spinner" />}</span><div className="vr-trace-content">{event.itemId && <button className="vr-trace-source" onClick={() => event.itemId && onOpenItem(event.itemId)}>{state.items.find(item => item.id === event.itemId)?.title || 'View source'}<Icon name="arrow" size={11} /></button>}<div className="vr-trace-title"><strong>{event.title}</strong><span className="vr-stage-tag">{event.stage}</span><time>{new Date(event.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><p>{event.detail}</p><div className="vr-trace-metadata">{event.model && <span>{event.model}</span>}{event.durationMs !== undefined && <span>{(event.durationMs / 1000).toFixed(1)}s</span>}{event.tokens !== undefined && <span>{event.tokens.toLocaleString()} tokens</span>}</div></div></div>)}</div> : <div className="vr-trace-empty"><div className="vr-empty-icon"><Icon name="pipeline" size={26} /></div><h3>The engine is ready for its first run.</h3><p>Run it from your queue to see real model calls and verified evidence here. Local ranking works before you connect the models.</p></div>}</section>
    <p className="vr-bottom-note"><Icon name="info" size={14} />This trace reports actual events. Token counts appear only when the provider reports them.</p>
  </div>;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [view, setView] = useState<View>('signal');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [goal, setGoal] = useState('');
  const [goalDirty, setGoalDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [setup, setSetup] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'useful'>('all');
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const loaded = useRef(false);
  const mutationEpoch = useRef(0);
  const mutationActive = useRef(false);
  const applyState = useCallback((next: AppState) => {
    setState(previous => ({ ...next, items: next.items.map(item => {
      const before = previous?.items.find(prior => prior.id === item.id);
      return { ...item, previousRank: before && before.rank !== item.rank ? before.rank : before?.previousRank };
    }) }));
  }, []);

  const refresh = useCallback(async () => {
    if (mutationActive.current) return;
    const epoch = mutationEpoch.current;
    try {
      const next = await request<AppState>('/api/state');
      if (epoch !== mutationEpoch.current || mutationActive.current) return;
      applyState(next);
      if (!loaded.current) { setGoal(next.profile.goal); loaded.current = true; setError(''); }
    } catch (e) { if (!loaded.current) setError(e instanceof Error ? e.message : 'Could not load your workspace.'); }
  }, [applyState]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), state?.run?.status === 'running' ? 1200 : 6000);
    return () => window.clearInterval(timer);
  }, [refresh, state?.run?.status]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => window.clearTimeout(timer); }, [toast]);

  async function mutate(path: string, body: object, message: string, method = 'POST') {
    mutationEpoch.current += 1; mutationActive.current = true;
    setBusy(path); setError('');
    try { const next = await request<AppState>(path, body, method); applyState(next); setToast(message); return next; }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.'); throw e; }
    finally { mutationActive.current = false; setBusy(''); }
  }
  async function saveProfile(body: object) { await mutate('/api/profile', body, 'Profile updated. Your queue has been reranked.', 'PUT'); }
  async function saveGoal(event?: FormEvent, preset?: string) {
    event?.preventDefault(); const nextGoal = preset || goal;
    if (!nextGoal.trim()) return;
    try { await saveProfile({ goal: nextGoal }); setGoal(nextGoal); setGoalDirty(false); } catch { /* surfaced by mutate */ }
  }
  async function feedback(itemId: string, kind: FeedbackKind | null) {
    try { if (kind) await mutate('/api/feedback', { itemId, kind }, kind === 'known' ? 'Knowledge updated. Familiar ideas move down the queue.' : 'Signal saved. Your queue has been reranked.');
    else await mutate(`/api/feedback/${encodeURIComponent(itemId)}`, {}, 'Feedback removed. Your profile has been rebuilt.', 'DELETE'); } catch { /* surfaced by mutate */ }
  }
  async function runEngine(itemId?: string) {
    if (!state || busy || running) return;
    setBusy('run'); setError('');
    try { await request('/api/run', { itemIds: itemId ? [itemId] : batchItems.map(item => item.id) }); await refresh(); setToast(itemId ? 'Analyzing this source. Follow its execution in Pipeline.' : `Engine started for ${batchItems.length} sources. Follow execution in Pipeline.`); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start the engine.'); }
    finally { setBusy(''); }
  }
  const selectedItem = state?.items.find(item => item.id === selectedId);
  const canRun = Boolean(state?.connections.llm && state.connections.jev);
  const running = state?.run?.status === 'running';
  const pendingItems = state?.items.filter(item => !item.decision || item.decision.profileVersion !== state.profile.version) || [];
  const batchItems = (pendingItems.length ? pendingItems : state?.items || []).slice(0, 8);
  const filtered = state?.items.filter(item => (filter === 'all' || (filter === 'unread' ? !item.feedback : item.feedback === 'useful')) && `${item.title} ${item.publisher} ${item.analysis?.summary || ''}`.toLowerCase().includes(search.toLowerCase())) || [];
  const processed = state?.items.filter(item => item.scoreSource === 'jev-personalized').length || 0;

  return <div className="vr-app">
    <aside className="vr-sidebar"><a className="vr-brand" href="/" aria-label="ValueRank home"><BrandMark /><span>ValueRank<span className="vr-beta">LAB</span></span></a>
      <div className="vr-workspace-label">PERSONAL WORKSPACE</div><nav aria-label="Main navigation">{([{ id: 'signal', label: 'Signal Lab', icon: 'spark' }, { id: 'queue', label: 'Reading queue', icon: 'queue' }, { id: 'knowledge', label: 'Knowledge', icon: 'brain' }, { id: 'pipeline', label: 'Pipeline', icon: 'pipeline' }] as { id: View; label: string; icon: IconName }[]).map(item => <button key={item.id} className={`vr-nav-item ${view === item.id ? 'active' : ''}`} onClick={() => setView(item.id)} aria-label={item.label} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon} /><span>{item.label}</span>{item.id === 'queue' && state && <span className="vr-nav-count">{state.items.length}</span>}{item.id === 'pipeline' && running && <i className="vr-status-dot" />}</button>)}</nav>
      <div className="vr-sidebar-note"><span className="vr-sidebar-note-icon"><Icon name="spark" size={19} /></span><p>The internet has enough content.<br /><strong>Find your next useful idea.</strong></p><span>Built around your goals.</span></div>
      <div className="vr-sidebar-bottom"><span className="vr-sidebar-footnote">A more intentional internet.</span><button className="vr-account" onClick={() => setView('knowledge')}><span className="vr-avatar">Y</span><span><strong>Your workspace</strong><small>Personal learning engine</small></span><Icon name="arrow" size={15} /></button></div>
    </aside>
    <div className="vr-main"><header className="vr-header"><div className="vr-breadcrumb"><span>Workspace</span><span>/</span><strong>{view === 'signal' ? 'Signal Lab' : view === 'queue' ? 'Reading queue' : view === 'knowledge' ? 'Knowledge' : 'Pipeline'}</strong></div><div className="vr-header-actions"><button className="vr-connection-status" title="Status shows configured API keys. A model run verifies provider access." onClick={() => setSetup(true)}><i className={canRun ? 'connected' : ''} />{canRun ? 'Keys configured' : 'Local mode'}<Icon name="info" size={12} /></button><button className="vr-button vr-button-secondary vr-add-button" onClick={() => { setError(''); setAdding(true); }} disabled={!state}><Icon name="plus" size={15} />Add content</button></div></header>
      {error && <div className="vr-alert" role="alert"><Icon name="info" size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
      {!state ? <div className="vr-loading"><BrandMark /><h1>Opening your workspace.</h1><p>{error ? 'The local server may not be available.' : 'Gathering your sources and knowledge profile…'}</p>{error && <button className="vr-button vr-button-primary" onClick={() => void refresh()}>Try again</button>}</div> : view === 'signal' ? <SignalLab state={state} onSaved={refresh} /> : view === 'knowledge' ? <ProfileView state={state} busy={Boolean(busy) || running} save={saveProfile} reset={() => setResetConfirm(true)} /> : view === 'pipeline' ? <PipelineView state={state} onOpenItem={setSelectedId} /> : <div className="vr-view-body">
        <div className="vr-queue-hero"><div><span className="vr-eyebrow"><span className="vr-live-dot" />LESS NOISE. MORE PROGRESS.</span><h1>Make your next read count.</h1><p>A reading queue that understands where you’re going.</p></div><div className="vr-hero-stats"><div><strong>{state.items.length}<span>sources</span></strong><span>in your orbit</span></div><span className="vr-hero-stat-divider" /><div><strong>{state.profile.knownConcepts.length}<span>concepts</span></strong><span>already in your toolkit</span></div></div></div>
        <section className="vr-goal-panel"><div className="vr-goal-icon"><Icon name="spark" size={23} /></div><div className="vr-goal-content"><label htmlFor="vr-goal">WHAT ARE YOU WORKING TOWARD?</label><form onSubmit={event => void saveGoal(event)}><input id="vr-goal" disabled={running || Boolean(busy)} value={goal} onChange={event => { setGoal(event.target.value); setGoalDirty(true); }} aria-label="Your learning goal" /><button type="submit" className={goalDirty ? 'vr-goal-save dirty' : 'vr-goal-save'} disabled={Boolean(busy) || running || !goal.trim()} aria-label="Update learning goal"><span>{goalDirty ? 'Update goal' : 'Edit goal'}</span><Icon name="arrow" size={16} /></button></form><div className="vr-goal-presets"><span>Try a direction</span>{GOALS.map(preset => <button key={preset.name} onClick={() => void saveGoal(undefined, preset.text)} disabled={Boolean(busy) || running}>{preset.name}<Icon name="arrow" size={11} /></button>)}</div></div></section>
        {!canRun && <div className="vr-setup-banner"><Icon name="info" size={16} /><span>Your queue is ranked locally. Connect LLM + Jev to add grounded analysis and model decisions.</span><button onClick={() => setSetup(true)}>Connection details<Icon name="arrow" size={13} /></button></div>}
        {running && state.run && <div className="vr-run-banner"><span className="vr-spinner" /><span>Engine running <strong>{state.run.processed} / {state.run.total} sources</strong></span><div className="vr-progress-track"><i style={{ width: `${state.run.total ? (state.run.processed / state.run.total) * 100 : 0}%` }} /></div><button onClick={() => setView('pipeline')}>View trace<Icon name="arrow" size={13} /></button></div>}
        <div className="vr-queue-layout"><section className="vr-queue-column"><div className="vr-queue-heading"><div><h2>Your signal queue<span>{filtered.length}</span></h2><p>Ranked for your goal. Refined by your feedback.</p></div><button className="vr-button vr-button-primary" onClick={() => void runEngine()} disabled={!canRun || running || Boolean(busy) || !state.items.length || goalDirty} title={goalDirty ? 'Update your goal before running the engine' : canRun ? `Analyze and score ${batchItems.length} sources from your queue` : 'Connect both models to run the engine'}><Icon name={running ? 'pipeline' : 'spark'} size={15} />{running ? 'Running…' : `Run engine · ${batchItems.length}`}</button></div>
          <div className="vr-queue-toolbar"><div className="vr-tabs" aria-label="Filter reading queue">{([{ id: 'all', label: 'All sources' }, { id: 'unread', label: 'Unread' }, { id: 'useful', label: 'Useful' }] as const).map(option => <button key={option.id} className={filter === option.id ? 'active' : ''} onClick={() => setFilter(option.id)} aria-pressed={filter === option.id}>{option.label}</button>)}</div><label className="vr-search"><Icon name="search" size={15} /><input aria-label="Search sources" placeholder="Search sources" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
          <div className="vr-articles">{filtered.map(item => <ArticleCard key={item.id} item={item} onOpen={() => setSelectedId(item.id)} onFeedback={(id, kind) => void feedback(id, kind)} busy={Boolean(busy) || running} />)}{!filtered.length && <div className="vr-empty-small"><Icon name="search" size={25} /><h3>No sources in this view.</h3><p>{filter === 'useful' ? 'Mark a source as useful to find it here.' : 'Try another filter or add something new.'}</p></div>}</div>
          <p className="vr-bottom-note"><Icon name="info" size={13} />Value scores combine relevance, novelty, actionability, and your preferences. They are not probabilities.</p>
        </section><aside className="vr-context-column"><section className="vr-context-card"><div className="vr-context-title"><span className="vr-eyebrow">YOUR SIGNAL PROFILE</span><Icon name="brain" size={17} /></div><h3>Built around you.</h3><p className="vr-muted">Every reaction makes your context a little more precise.</p><div className="vr-profile-signal"><span className="vr-profile-signal-value">{state.profile.feedbackCount}</span><span>active signals<br /><small>Profile version {state.profile.version}</small></span><svg viewBox="0 0 75 35" aria-hidden="true"><path d="m14 18 22-11 23 12-23 10-22-11Zm22-11v22m-22-11 45 1" fill="none" stroke="currentColor" strokeWidth="1" /><circle cx="14" cy="18" r="4" fill="currentColor" /><circle cx="36" cy="7" r="4" fill="currentColor" /><circle cx="59" cy="19" r="4" fill="currentColor" /><circle cx="36" cy="29" r="4" fill="currentColor" /></svg></div><div className="vr-divider" /><div className="vr-context-section-label">CURRENT INTERESTS</div><div className="vr-interest-bars">{Object.entries(state.profile.interests).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([topic, value]) => <div key={topic}><span>{TOPIC_NAMES[topic as Topic]}<b>{Math.round(value * 100)}%</b></span><div><i style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} /></div></div>)}</div><div className="vr-divider" /><div className="vr-context-section-label">ALREADY IN YOUR TOOLKIT</div><div className="vr-knowledge-chips">{state.profile.knownConcepts.slice(0, 7).map(concept => <span key={concept}>{concept}</span>)}{state.profile.knownConcepts.length > 7 && <span>+{state.profile.knownConcepts.length - 7} more</span>}{!state.profile.knownConcepts.length && <p className="vr-caption">Add familiar concepts to make room for new ones.</p>}</div><button className="vr-context-link" onClick={() => setView('knowledge')}>Shape your knowledge profile<Icon name="arrow" size={14} /></button></section>
          <section className="vr-how-card"><span className="vr-eyebrow">THOUGHTFULLY CONNECTED</span><h3>A small engine.<br />A personal point of view.</h3><div className="vr-mini-pipeline"><span><Icon name="known" size={15} />Source</span><i /><span><Icon name="brain" size={15} />LLM</span><i /><span><Icon name="spark" size={15} />Jev</span></div><p>The LLM extracts meaning. Jev makes typed decisions. Your knowledge and feedback shape the final order.</p><button onClick={() => setView('pipeline')}>See how it works<Icon name="arrow" size={14} /></button></section>
          <div className="vr-model-summary"><span><i className={state.connections.llm ? 'connected' : ''} />LLM harness<strong>{state.connections.llm ? 'Key configured' : 'Key needed'}</strong></span><span><i className={state.connections.jev ? 'connected' : ''} />Jev decisions<strong>{state.connections.jev ? 'Key configured' : 'Key needed'}</strong></span><p>{processed} / {state.items.length} sources scored by Jev for this profile</p></div>
        </aside></div>
      </div>}
      <footer className="vr-footer"><span><BrandMark small />ValueRank<span className="vr-footer-dot">·</span>Make information work for you.</span><span>Research prototype<span className="vr-footer-dot">·</span>Local-first workspace</span></footer>
    </div>
    {toast && <div className="vr-toast" role="status"><span><Icon name="check" size={16} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss notification"><Icon name="close" size={14} /></button></div>}
    {selectedItem && <Detail item={selectedItem} onClose={() => setSelectedId(null)} onFeedback={(id, kind) => void feedback(id, kind)} onAnalyze={() => void runEngine(selectedItem.id)} onViewPipeline={() => { setSelectedId(null); setView('pipeline'); }} canAnalyze={canRun && !goalDirty} busy={Boolean(busy) || running} error={error} />}
    {adding && <AddContent error={error} onClose={() => setAdding(false)} busy={Boolean(busy)} onAdd={async body => { try { await mutate('/api/items', body, 'Source added. Run the engine when you’re ready.'); setAdding(false); } catch { /* surfaced by mutate */ } }} />}
    {setup && <Dialog title="Your engine connections" onClose={() => setSetup(false)}><div className="vr-connection-dialog"><p>Local ranking and feedback are available now. The full engine uses two model connections.</p><div className="vr-connection-row"><Icon name="brain" size={23} /><div><h3>LLM harness</h3><span>{state?.connections.llmModel || 'Vercel AI Gateway'}</span></div><span className={state?.connections.llm ? 'ready' : ''}>{state?.connections.llm ? 'Key configured' : 'Key needed'}</span></div><div className="vr-connection-row"><Icon name="spark" size={23} /><div><h3>Jev via {state?.connections.jevProvider === 'openrouter' ? 'OpenRouter' : 'TypeSafe'}</h3><span>{state?.connections.jevModel || 'Model not configured'}</span></div><span className={state?.connections.jev ? 'ready' : ''}>{state?.connections.jev ? 'Key configured' : 'Key needed'}</span></div>{!canRun && <div className="vr-connection-instructions"><h4>Connect locally</h4><p>Save <code>AI_GATEWAY_API_KEY</code> for the LLM and <code>OPENROUTER_API_KEY</code> for Jev in <code>demo/.env.local</code>. You can also route Jev directly with <code>TYPESAFE_API_KEY</code>. Keys stay on the server; never paste them into the app.</p><p className="vr-caption">Connection status updates automatically. “Key configured” describes setup only; a model run verifies provider access.</p></div>}<p className="vr-caption">Key status does not guarantee provider access. Each run processes up to 8 sources. You can inspect model calls and reported token usage in Pipeline.</p><button className="vr-button vr-button-primary" onClick={() => setSetup(false)}>Back to workspace<Icon name="arrow" size={15} /></button></div></Dialog>}
    {resetConfirm && <Dialog title="Reset your learning profile?" onClose={() => setResetConfirm(false)}><div className="vr-connection-dialog"><p>This clears your feedback and restores the starter profile. Your added content and saved analyses stay in the workspace.</p><div className="vr-modal-actions"><button className="vr-button vr-button-secondary" onClick={() => setResetConfirm(false)}>Keep my profile</button><button className="vr-button vr-button-primary" disabled={Boolean(busy)} onClick={async () => { try { const next = await mutate('/api/reset', {}, 'Profile and feedback reset. Your sources are still here.'); setGoal(next.profile.goal); setGoalDirty(false); setResetConfirm(false); setView('queue'); } catch { /* surfaced by mutate */ } }}>Reset profile</button></div></div></Dialog>}
  </div>;
}
