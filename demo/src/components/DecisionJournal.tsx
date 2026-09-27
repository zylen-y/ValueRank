import { useState } from 'react';
import type { ResearchDecision, ResearchDecisionChanges, ResearchProjectDetail } from '../domain/research';
import { PersonalDialog, PersonalIcon as Icon } from './PersonalShared';
import { domainLabel, relativeDate, safeExternalUrl } from './personal-utils';
import './decision-journal.css';

export interface DecisionInput { decision: string; nextAction: string; revisitTrigger: string; savedIds: string[] }

function DecisionForm({ previous, savedIds, busy, submit }: { previous?: ResearchDecision; savedIds: string[]; busy: boolean; submit: (input: DecisionInput) => Promise<void> }) {
  const [decision, setDecision] = useState(previous?.decision ?? '');
  const [nextAction, setNextAction] = useState(previous?.nextAction ?? '');
  const [revisitTrigger, setRevisitTrigger] = useState(previous?.revisitTrigger ?? '');
  return <form className="r-project-form" onSubmit={event => { event.preventDefault(); void submit({ decision, nextAction, revisitTrigger, savedIds }); }}>
    <p>Write the call you are making. This keeps your decision separate from the engine’s advice.</p>
    <label>My decision<textarea autoFocus required minLength={3} maxLength={1000} rows={3} value={decision} onChange={event => setDecision(event.target.value)} placeholder="Start with explicit profiles and a local retrieval baseline…" /></label>
    <label>My next action<textarea required minLength={3} maxLength={700} rows={2} value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="Build a small test with ten representative questions…" /></label>
    <label>I’ll revisit this when <span className="d-optional">optional</span><textarea maxLength={700} rows={2} value={revisitTrigger} onChange={event => setRevisitTrigger(event.target.value)} placeholder="The baseline misses important context, or my requirements change…" /></label>
    <p>{savedIds.length ? `${savedIds.length} selected shortlist cards will be kept as supporting snapshots.` : 'No supporting cards selected. You can still record your decision.'} {savedIds.length > 8 ? 'Return to the shortlist and select at most 8 cards.' : 'Later edits to your shortlist will not rewrite this record.'}</p>
    <button className="vr-button vr-button-primary" disabled={busy || decision.trim().length < 3 || nextAction.trim().length < 3 || savedIds.length > 8}>{busy ? <span className="vr-spinner" /> : <Icon name="check" size={15} />}Record my decision</button>
  </form>;
}

function Changes({ changes }: { changes?: ResearchDecisionChanges }) {
  if (!changes) return null;
  const changed = changes.contextChanged || changes.added.length > 0 || changes.removed.length > 0 || changes.notesChanged.length > 0;
  return <details className={`d-changes ${changed ? 'has-changes' : ''}`} open={changed}>
    <summary><Icon name="history" size={15} />{changed ? 'Since you made this decision' : 'Your saved context and evidence are unchanged'}</summary>
    {changed ? <><ul>
      {changes.contextChanged && <li><strong>Your priorities changed.</strong> Compare the current project goal with the context saved below.</li>}
      {changes.added.length > 0 && <li><strong>{changes.added.length} {changes.added.length === 1 ? 'card added' : 'cards added'} to the shortlist.</strong> {changes.added.slice(0, 3).map(item => item.title).join(' · ')}{changes.added.length > 3 ? '…' : ''}</li>}
      {changes.removed.length > 0 && <li><strong>{changes.removed.length} {changes.removed.length === 1 ? 'card removed' : 'cards removed'}.</strong> This decision keeps its original supporting snapshots.</li>}
      {changes.notesChanged.length > 0 && <li><strong>{changes.notesChanged.length} saved {changes.notesChanged.length === 1 ? 'note changed' : 'notes changed'}.</strong> Your earlier notes remain with the decision.</li>}
      {changes.newSourceUrls.length > 0 && <li>Newly saved source {changes.newSourceUrls.length === 1 ? 'URL' : 'URLs'}: {changes.newSourceUrls.map(domainLabel).join(', ')}.</li>}
      {changes.changedSourceUrls.length > 0 && <li>Different captured text at {changes.changedSourceUrls.length} previously saved source {changes.changedSourceUrls.length === 1 ? 'URL' : 'URLs'}. Inspect the passages before treating this as a material update.</li>}
    </ul><p>These are changes in your workspace. They do not automatically change your decision or verify the new claims.</p></> : <p>This compares saved records only. It does not monitor the web for changes.</p>}
  </details>;
}

function RecordDetail({ record, remove, busy }: { record: ResearchDecision; remove: () => void; busy: boolean }) {
  return <div className="d-record-detail"><h4>Context when you decided</h4><p>{record.project.goal}</p>{record.project.constraints && <p>{record.project.constraints}</p>}<span>Context version {record.project.version}</span>
    <h4>{record.evidence.length} supporting {record.evidence.length === 1 ? 'snapshot' : 'snapshots'}</h4>{record.evidence.map(item => <details key={item.id}><summary>{item.unit.title}</summary><p>{item.unit.body}</p>{item.unit.evidence.map((reference, index) => { const source = item.sources.find(value => value.id === reference.sourceId && value.version === reference.sourceVersion); return <div key={index}><blockquote>{reference.quote}</blockquote><a href={safeExternalUrl(source?.url)} target="_blank" rel="noreferrer">{source?.title}<Icon name="external" size={12} /></a><p className="d-source-meta">{source?.provenance.replaceAll('-', ' ')} · Retrieved {source ? relativeDate(source.retrievedAt) : 'unknown'}{source?.publishedAt ? ` · Published ${relativeDate(source.publishedAt)}` : ' · Publication date not recorded'}</p>{source?.limitations?.map(limit => <p className="r-caveat" key={limit}>{limit}</p>)}</div>; })}{item.unit.limitations.map(limit => <p className="r-caveat" key={limit}>{limit}</p>)}{item.note && <p>Your note at the time: {item.note}</p>}</details>)}
    <div className="d-record-actions"><a className="p-subtle-button" href={`/api/personal/projects/${record.projectId}/decisions/${record.id}/markdown`}><Icon name="download" size={13} />Export my decision</a><button className="p-subtle-button" disabled={busy} onClick={remove}><Icon name="trash" size={13} />Delete this record</button></div>
  </div>;
}

export default function DecisionJournal({ detail, savedIds, busy, record, remove }: {
  detail: ResearchProjectDetail; savedIds: string[]; busy: boolean;
  record: (input: DecisionInput) => Promise<boolean>; remove: (id: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState<ResearchDecision | null>(null);
  const records = detail.decisions ?? []; const latest = records[0];
  return <section className={`d-journal ${latest ? 'has-decision' : ''}`} aria-label="Your decision journal">
    {latest ? <>
      <header><span className="p-eyebrow">YOUR CURRENT CALL</span><span>Recorded by you · {relativeDate(latest.createdAt)}</span></header>
      <h2>{latest.decision}</h2><div className="d-next"><Icon name="arrow" size={18} /><div><span>Next action</span><p>{latest.nextAction}</p></div></div>
      {latest.revisitTrigger && <p className="d-trigger"><strong>Revisit when</strong> {latest.revisitTrigger}</p>}
      <Changes changes={detail.decisionChanges} />
      <div className="d-current-actions"><button className="p-subtle-button" disabled={busy} onClick={() => setEditing(true)}>Record a revised decision<Icon name="edit" size={13} /></button><details><summary>Original context & evidence</summary><RecordDetail record={latest} busy={busy} remove={() => setDeleting(latest)} /></details></div>
      {records.length > 1 && <details className="d-history"><summary>{records.length - 1} earlier {records.length === 2 ? 'decision' : 'decisions'}</summary>{records.slice(1).map(item => <article key={item.id}><span>{relativeDate(item.createdAt)} · recorded by you</span><h3>{item.decision}</h3><p>Next action: {item.nextAction}</p>{item.revisitTrigger && <p>Revisit when: {item.revisitTrigger}</p>}<RecordDetail record={item} busy={busy} remove={() => setDeleting(item)} /></article>)}</details>}
    </> : <div className="d-empty"><div><span className="p-eyebrow">MAKE THE RESEARCH COUNT</span><h2>What’s your next move?</h2><p>Keep your decision, the evidence behind it, and a reason to revisit it.</p></div><button className="vr-button vr-button-secondary" onClick={() => setEditing(true)} disabled={busy}><Icon name="edit" size={14} />Record my decision</button></div>}
    {editing && <PersonalDialog title={latest ? 'Record a revised decision' : 'Make your call'} onClose={() => setEditing(false)}><DecisionForm previous={latest} savedIds={savedIds} busy={busy} submit={async input => { if (await record(input)) setEditing(false); }} /></PersonalDialog>}
    {deleting && <PersonalDialog title="Delete this decision record?" onClose={() => setDeleting(null)}><div className="r-confirm"><p>This removes this record and its supporting snapshots. Your shortlist, AI briefs, and other decisions remain. {deleting.id === latest?.id && records.length > 1 ? 'The previous decision will become your current call.' : ''}</p><button className="vr-button vr-button-primary" disabled={busy} onClick={() => { const id = deleting.id; void remove(id).then(done => { if (done) setDeleting(null); }); }}>Delete record</button></div></PersonalDialog>}
  </section>;
}
