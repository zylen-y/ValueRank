import { useEffect, useState } from 'react';
import type { ComparisonChoice, PersonalComparisonPrompt, PersonalComparisonResult, PersonalUnit } from '../domain/personal';
import { PersonalIcon as Icon } from './PersonalShared';
import { safeExternalUrl } from './personal-utils';

function imageSource(value?: string) {
  if (!value) return undefined;
  return value.startsWith('/api/personal/assets/') || value.startsWith('/personal/') || value.startsWith('/arena/') ? value : safeExternalUrl(value);
}
function previewDescription(unit: PersonalUnit) {
  if (!unit.domain.startsWith('catalog-')) return unit.body;
  return unit.body.split('\n').filter(line => /^(creator|category|price|currency|year|duration|rating|publicationYear|firstPublishYear):/i.test(line)).map(line => line.replace(/^Creator:\s*/i, '')).slice(0, 5).join('\n') || unit.body;
}
export function PersonalUnitVisual({ unit }: { unit: PersonalUnit }) {
  const url = imageSource(unit.imageUrl);
  const [failed, setFailed] = useState(false);
  return url && !failed ? <><div className="p-choice-image"><img src={url} alt={unit.title} onError={() => setFailed(true)} loading="eager" decoding="async" referrerPolicy="no-referrer" /></div>{unit.modality === 'text' && <p className="cl-choice-description">{previewDescription(unit)}</p>}</> : <div className="p-choice-text"><Icon name={unit.modality === 'image' ? 'source' : 'known'} size={27} /><h3>{unit.title}</h3><p>{unit.body}</p>{unit.modality === 'image' && <small>Image unavailable · source description shown</small>}</div>;
}
export default function PersonalComparison({ pair, result, busy, onChoose, onNext, onUndo, nextLabel = 'Next comparison' }: { pair: PersonalComparisonPrompt; result: PersonalComparisonResult | null; busy: boolean; onChoose: (choice: ComparisonChoice, reason: string) => Promise<void>; onNext: () => void; onUndo?: () => Promise<void>; nextLabel?: string }) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (busy || result || event.metaKey || event.ctrlKey || event.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return;
      const choice = event.key === '1' ? 'a' : event.key === '2' ? 'b' : event.key === '3' ? 'tie' : event.key === '4' ? 'neither' : event.key.toLowerCase() === 's' ? 'skip' : undefined;
      if (choice) { event.preventDefault(); void onChoose(choice, reason); }
    };
    window.addEventListener('keydown', handleKey); return () => window.removeEventListener('keydown', handleKey);
  }, [busy, result, onChoose, reason]);
  const probability = result?.prediction.probabilityA;
  const predicted = probability !== undefined ? probability >= 0.5 ? 'A' : 'B' : null;
  return <div className="p-comparison"><div className="p-comparison-prompt"><span className="p-eyebrow">{pair.exposure.mode === 'test' ? 'UNSEEN ITEMS · BLIND PREDICTION' : pair.exposure.mode === 'tournament' ? 'TOURNAMENT · ONE CHOICE AT A TIME' : 'A SMALL CHOICE. A PERSONAL SIGNAL.'}</span><h2>{pair.prompt}</h2><p>{pair.exposure.mode === 'test' ? 'Your model has already made its prediction. Choose to reveal it.' : 'Pick what you prefer. There is no objectively correct answer.'}</p></div><div className="p-choice-grid">{([{ side: 'a', unit: pair.a }, { side: 'b', unit: pair.b }] as const).map(({ side, unit }) => <div className={`p-choice ${result?.comparison.choice === side ? 'was-chosen' : ''}`} key={`${pair.exposure.id}-${side}`}><button disabled={busy || Boolean(result)} onClick={() => void onChoose(side, reason)} aria-label={`Choose ${side.toUpperCase()}: ${unit.title}`}><span className="p-choice-letter">{side.toUpperCase()}<kbd>{side === 'a' ? '1' : '2'}</kbd></span><PersonalUnitVisual unit={unit} /><span className="p-choice-bottom"><strong>{unit.title}</strong>{result?.comparison.choice === side ? <span><Icon name="check" size={14} />Your choice</span> : <span>Choose {side.toUpperCase()}<Icon name="arrow" size={14} /></span>}</span></button>{(unit.rights || unit.imageSourceUrl) && <div className="p-image-credit">{unit.rights && <span>{unit.rights}</span>}{safeExternalUrl(unit.imageSourceUrl) && <a href={safeExternalUrl(unit.imageSourceUrl)} target="_blank" rel="noreferrer">Original source<Icon name="external" size={10} /></a>}</div>}</div>)}</div>
    {!result ? <><div className="p-other-choices"><button disabled={busy} onClick={() => void onChoose('tie', reason)}>Equally good<kbd>3</kbd></button><button disabled={busy} onClick={() => void onChoose('neither', reason)}>Neither<kbd>4</kbd></button><button disabled={busy} onClick={() => void onChoose('skip', reason)}>Skip<kbd>S</kbd></button></div><label className="p-choice-reason"><span>What tipped the balance? <small>Optional</small></span><input maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="More practical, calmer colors, a more useful perspective…" /></label><div className="p-comparison-footnote"><span className="p-locked-dot" />Prediction is saved before your choice and hidden until you answer.</div></> : <div className="p-reveal" role="status"><div className="p-reveal-head"><span className="p-reveal-icon"><Icon name={result.correct === null ? 'check' : 'memory'} size={22} /></span><div><span className="p-eyebrow">PREDICTION REVEALED</span><h3>{result.correct === null ? result.comparison.choice === 'skip' ? 'Skipped. No preference assumed.' : result.comparison.choice === 'neither' ? 'Neither is useful. Signal recorded.' : 'A tie. Both choices count equally.' : Math.abs((probability ?? 0.5) - 0.5) < 0.005 ? 'Your model was undecided.' : result.correct ? 'Your model saw this one coming.' : 'A useful surprise for your model.'}</h3><p>Before your answer: <strong>{predicted}</strong> at <strong>{probability === undefined ? '—' : Math.round(Math.max(probability, 1 - probability) * 100)}%</strong>{pair.exposure.mode === 'test' ? ' · Held-out test. This answer does not train the model.' : ` · Prediction v${result.prediction.modelVersion} · Updated model v${result.modelVersion}`}</p></div></div><div className="p-probability-bar" aria-label={`Predicted probability of A: ${Math.round((probability || 0) * 100)} percent`}><span>A <b>{Math.round((probability ?? 0) * 100)}%</b></span><i><b style={{ width: `${(probability ?? 0) * 100}%` }} /></i><span>B <b>{Math.round((1 - (probability ?? 0)) * 100)}%</b></span></div><div className="p-reveal-actions">{onUndo && <button className="p-subtle-button" disabled={busy} onClick={() => void onUndo()}><Icon name="undo" size={14} />Undo this choice</button>}<button className="vr-button vr-button-primary" disabled={busy} onClick={onNext}>{nextLabel}<Icon name="arrow" size={15} /></button></div></div>}
  </div>;
}
