import type { PersonalRankedUnit } from '../domain/personal';
import { PersonalIcon as Icon } from './PersonalShared';

export interface RankingUpdate {
  comparisonId: string;
  choice: string;
  modelVersion: number;
  trained: boolean;
  changes: { id: string; title: string; before: number; after: number }[];
}

export function WhyRanked({ unit }: { unit: PersonalRankedUnit }) {
  const judgments = unit.features.encoder.includes('jev') ? [
    { id: 'relevance', label: 'Fits your goal' },
    { id: 'novelty', label: 'Beyond your recorded knowledge' },
    { id: 'actionability', label: 'Helps you take action' },
  ].flatMap(item => { const value = unit.features.values[unit.features.names.indexOf(item.id)]; return Number.isFinite(value) ? [{ ...item, value }] : []; }) : [];
  return <details className="r-why-ranked"><summary><Icon name="memory" size={13} />Why this position?<span>{unit.modelVersion ? `Personal model v${unit.modelVersion}` : 'Starting from your goal'}</span></summary><div>
    {judgments.length > 0 && <><p>Jev’s estimates for this goal</p><div className="r-judgment-bars">{judgments.map(item => <div key={item.id}><label>{item.label}<span>{Math.round(item.value * 100)}%</span></label><div><i style={{ width: `${Math.max(0, Math.min(1, item.value)) * 100}%` }} /></div></div>)}</div></>}
    <p>{unit.modelVersion ? Math.abs(unit.personalAdjustment) < .0001 ? 'Your learned model leaves this card’s starting score unchanged.' : `Your comparisons ${unit.personalAdjustment > 0 ? 'increase' : 'decrease'} the value assigned to this card’s features.` : 'No learned model is being applied here yet. Compare two cards to give it your first example.'}</p>
    {unit.knownConcepts.length > 0 && <p>Lowered because you marked these concepts as familiar: {unit.knownConcepts.join(', ')}.</p>}
    <small>Rank reflects usefulness for your goal. The evidence passages remain available for checking the claims.</small>
  </div></details>;
}

export function RankUpdate({ update, disabled, undo, dismiss }: { update: RankingUpdate; disabled: boolean; undo: () => void; dismiss: () => void }) {
  return <section className="r-rank-update" aria-label="Your last ranking feedback" role="status"><div className="r-rank-update-head"><span><Icon name="memory" size={18} /></span><div><strong>{!update.trained ? 'Recorded without changing your model.' : update.changes.length ? 'Your choice moved the ranking.' : 'Choice learned. The order is unchanged.'}</strong><p>{update.choice}{update.trained ? ` · Personal model v${update.modelVersion}` : ''}</p></div><button onClick={dismiss} aria-label="Dismiss ranking update"><Icon name="close" size={14} /></button></div>
    {update.changes.length > 0 && <div className="r-rank-moves">{update.changes.slice(0, 3).map(item => <div key={item.id}><span className={item.after < item.before ? 'up' : 'down'}>{item.after < item.before ? '↑' : '↓'}</span><p>{item.title}</p><span>#{item.before}<Icon name="arrow" size={11} /><strong>#{item.after}</strong></span></div>)}</div>}
    <button className="p-subtle-button" disabled={disabled} onClick={undo}><Icon name="undo" size={13} />Undo this choice</button>
  </section>;
}
