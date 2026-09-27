import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CATALOG_KINDS, CATALOG_LABELS, type CatalogKind, type CatalogCollectionSummary, type CatalogPage, type CatalogRankedItem, type CatalogSummary } from '../domain/catalog';
import type { ComparisonChoice, PersonalComparisonPrompt, PersonalComparisonResult, PersonalDataset } from '../domain/personal';
import PersonalComparison from './PersonalComparison';
import { PersonalDialog, PersonalError, PersonalIcon as Icon } from './PersonalShared';
import { domainLabel, personalRequest, relativeDate, safeExternalUrl } from './personal-utils';
import './personal.css';
import './catalog.css';

type Practice = { dataset: PersonalDataset; pair: PersonalComparisonPrompt; collectionSize: number; learningSetSize: number };
type Sort = 'personal' | 'source' | 'recent';
const KIND_MARK: Record<CatalogKind, string> = { music: '♫', youtube: '▷', instagram: '◎', pinterest: 'P', portraits: '◉', movies: '▣', series: '▥', anime: '✦', beauty: '◒', fashion: '⌁', books: '▤', papers: '↗' };
const KIND_ORDER: CatalogKind[] = ['movies', 'anime', 'portraits', 'instagram', 'pinterest', 'music', 'fashion', 'beauty', 'series', 'youtube', 'books', 'papers'];
const KIND_DESCRIPTION: Record<CatalogKind, string> = { music: 'Songs to discover, revisit, and put in your own order.', youtube: 'Find the next video worth your attention.', fashion: 'Compare the pieces you would actually wear.', beauty: 'Build your shortlist, one product at a time.', books: 'Find the book you would reach for next.', papers: 'Decide which research deserves a closer read.', instagram: 'Explore accounts that match your interests.', pinterest: 'Find the images that speak to your taste.', portraits: 'Compare photographs credited to their original source.', movies: 'Find the film you want to see next.', series: 'Discover a series worth coming back to.', anime: 'Explore animation across stories and styles.' };
function collectionDescription(collection: CatalogCollectionSummary) { return /browser|captured|https?:|public arxiv/i.test(collection.description) ? KIND_DESCRIPTION[collection.kind] : collection.description; }
function orderCollections(collections: CatalogCollectionSummary[]) {
  const groups = KIND_ORDER.map(kind => collections.filter(collection => collection.kind === kind));
  return Array.from({ length: Math.max(0, ...groups.map(group => group.length)) }, (_, index) => groups.flatMap(group => group[index] ? [group[index]] : [])).flat();
}
const number = (value: number) => value.toLocaleString();
const COLLECTION_PAGE_SIZE = 24;
const searchText = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
function collectionFromHash() { try { return decodeURIComponent(window.location.hash.split('/')[1] || ''); } catch { return ''; } }
async function catalogRequest<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/catalog${path}`, { signal, ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  let data: { error?: string };
  try { data = await response.json(); } catch { throw new Error('The library connection was interrupted. Please try again.'); }
  if (!response.ok) throw new Error(data.error || `Could not load the library (${response.status}).`);
  return data as T;
}
function Cover({ src, title = '', kind, eager = false }: { src?: string; title?: string; kind: CatalogKind; eager?: boolean }) {
  const [failed, setFailed] = useState(false);
  const url = safeExternalUrl(src);
  return url && !failed ? <img src={url} alt={title} loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <span className={`cl-cover-fallback cl-${kind}`}><span aria-hidden="true">{KIND_MARK[kind]}</span><small>{title || CATALOG_LABELS[kind]}</small></span>;
}
function CollectionTile({ collection, onOpen, index }: { collection: CatalogCollectionSummary; onOpen: () => void; index: number }) {
  return <button className={`cl-collection cl-${collection.kind}`} onClick={onOpen} style={{ '--cl-delay': `${Math.min(index, 8) * 35}ms` } as CSSProperties}>
    <div className="cl-collection-art"><span className="cl-collection-kind">{CATALOG_LABELS[collection.kind]}</span><div className="cl-cover-stack">{collection.previewImages.length ? collection.previewImages.slice(0, 3).map((src, i) => <div key={`${src}-${i}`}><Cover src={src} kind={collection.kind} /></div>) : <div className="cl-paper-art"><span>{KIND_MARK[collection.kind]}</span><i /><i /><i /></div>}</div><span className="cl-tile-arrow"><Icon name="arrow" size={16} /></span></div>
    <div className="cl-collection-copy"><h3>{collection.title}</h3><p>{collectionDescription(collection)}</p><span><b>{number(collection.count)}</b> items<span>Start ranking <Icon name="arrow" size={12} /></span></span></div>
  </button>;
}
function priceLabel(item: CatalogRankedItem) {
  const price = item.attributes.price ?? item.attributes.salePrice ?? item.attributes.priceKRW ?? item.attributes.discountedPrice;
  if (price === undefined || price === '') return undefined;
  if (typeof price === 'number') return `${item.attributes.currency === 'USD' ? '$' : item.attributes.currency && item.attributes.currency !== 'KRW' ? `${item.attributes.currency} ` : '₩'}${number(price)}`;
  return String(price);
}
function CatalogCard({ item, selected, onSelect, onInspect, priorRank, index }: { item: CatalogRankedItem; selected: boolean; onSelect: () => void; onInspect: () => void; priorRank?: number; index: number }) {
  const movement = priorRank === undefined ? 0 : priorRank - item.rank;
  return <article className={`cl-item cl-${item.kind} ${selected ? 'is-selected' : ''} ${movement > 0 ? 'cl-rank-up' : ''}`} style={{ '--cl-delay': `${Math.min(index, 12) * 20}ms` } as CSSProperties}>
    <div className="cl-item-image"><button className="cl-image-open" aria-label={`Inspect ${item.title}`} onClick={onInspect}><Cover src={item.imageUrl} title={item.title} kind={item.kind} eager={index < 4} /></button><span className="cl-rank">{String(item.rank).padStart(2, '0')}{movement !== 0 && <small className={movement > 0 ? 'up' : 'down'}>{movement > 0 ? '↑' : '↓'}{Math.abs(movement)}</small>}</span><button className="cl-select" aria-label={`${selected ? 'Deselect' : 'Select'} ${item.title}`} aria-pressed={selected} onClick={onSelect}>{selected ? <Icon name="check" size={13} /> : <span />}</button></div>
    <div className="cl-item-copy"><p className="cl-creator">{item.creator || domainLabel(item.url)}</p><button className="cl-item-title" onClick={onInspect}>{item.title}</button>{priceLabel(item) && <strong className="cl-price">{priceLabel(item)}</strong>}<div className="cl-item-foot"><span title={`Observed ${new Date(item.observedAt).toLocaleString()}`}>{domainLabel(item.url)}</span><a href={safeExternalUrl(item.url)} target="_blank" rel="noreferrer" aria-label={`Open original: ${item.title}`}>Open <Icon name="external" size={11} /></a></div></div>
  </article>;
}
export default function CatalogLibrary() {
  const [summary, setSummary] = useState<CatalogSummary | null>(null);
  const [collectionId, setCollectionId] = useState(collectionFromHash);
  const [kind, setKind] = useState<CatalogKind | 'all'>('all');
  const [collectionQuery, setCollectionQuery] = useState('');
  const [collectionLimit, setCollectionLimit] = useState(COLLECTION_PAGE_SIZE);
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>('personal');
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [inspect, setInspect] = useState<CatalogRankedItem | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [result, setResult] = useState<PersonalComparisonResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [priorRanks, setPriorRanks] = useState<Record<string, number>>({});
  const [reload, setReload] = useState(0);
  const pageRef = useRef<CatalogPage | null>(null);
  const refreshSummary = useCallback(async (signal?: AbortSignal) => { const next = await catalogRequest<CatalogSummary>('', undefined, signal); setSummary(next); }, []);
  useEffect(() => { const controller = new AbortController(); void refreshSummary(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load collections.'); }); return () => controller.abort(); }, [refreshSummary]);
  useEffect(() => { const change = () => { setCollectionId(collectionFromHash()); setOffset(0); setQuery(''); setSearch(''); setSelected([]); setNotice(''); setError(''); setPriorRanks({}); setPractice(null); setResult(null); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  useEffect(() => {
    if (!collectionId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ query: search, sort, offset: String(offset), limit: '24' });
    setLoading(true); setError('');
    void catalogRequest<CatalogPage>(`/collections/${encodeURIComponent(collectionId)}?${params}`, undefined, controller.signal).then(next => { setPage(next); pageRef.current = next; }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load this collection.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [collectionId, search, sort, offset, reload]);
  const openCollection = (id: string) => { window.location.hash = `library/${encodeURIComponent(id)}`; window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const visiblePage = page?.collection.id === collectionId ? page : null;
  const sources = summary?.sources.filter(source => !collectionId || visiblePage?.collection.sourceIds.includes(source.id)) || [];
  const orderedCollections = orderCollections(summary?.collections || []);
  const collectionTerms = searchText(collectionQuery.trim()).split(/\s+/).filter(Boolean);
  const matchesCollectionSearch = (value: string) => collectionTerms.every(term => searchText(value).includes(term));
  const collections = orderedCollections.filter(collection => (kind === 'all' || collection.kind === kind) && matchesCollectionSearch(`${collection.title} ${collection.description} ${CATALOG_LABELS[collection.kind]}`));
  const visibleCollections = collections.slice(0, collectionLimit);
  const heroCollections = KIND_ORDER.filter(value => value !== 'youtube' && value !== 'papers').flatMap(value => { const found = orderedCollections.find(collection => collection.kind === value && collection.previewImages.length); return found ? [found] : []; }).slice(0, 4);
  const blockedSources = summary?.sources.filter(source => source.status === 'blocked' && (kind === 'all' || source.kind === kind) && matchesCollectionSearch(`${source.label} ${source.note} ${CATALOG_LABELS[source.kind]}`)) || [];
  const changeKind = (next: CatalogKind | 'all') => { setKind(next); setCollectionLimit(COLLECTION_PAGE_SIZE); };
  const clearCollectionFilters = () => { setKind('all'); setCollectionQuery(''); setCollectionLimit(COLLECTION_PAGE_SIZE); };
  async function beginPractice() {
    if (busy || !visiblePage) return;
    setBusy(true); setError('');
    try { const next = await catalogRequest<Practice>(`/collections/${encodeURIComponent(collectionId)}/practice`, selected.length >= 2 ? { itemIds: selected } : {}); setPractice(next); setResult(null); setNotice(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not open a comparison.'); }
    finally { setBusy(false); }
  }
  async function choose(choice: ComparisonChoice, reason: string) {
    if (!practice || busy || result) return;
    setBusy(true); setError('');
    try {
      const next = await personalRequest<PersonalComparisonResult>('/choices', { exposureId: practice.pair.exposure.id, choice, reason: reason.trim() || undefined });
      setResult(next);
      setPriorRanks(Object.fromEntries((pageRef.current?.items || []).map(item => [item.id, item.rank])));
      if (choice === 'a' || choice === 'b' || choice === 'tie') { setSort('personal'); setOffset(0); }
      setReload(value => value + 1);
      setNotice(choice === 'a' || choice === 'b' || choice === 'tie' ? `Choice saved. Your collection has been reranked with model v${next.modelVersion}.` : choice === 'skip' ? 'Comparison skipped. No preference was assumed.' : 'Neither recorded. No directional preference was assumed.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save your choice.'); }
    finally { setBusy(false); }
  }
  async function nextPair() {
    if (!practice || busy) return;
    setBusy(true); setError('');
    try { const pair = await personalRequest<PersonalComparisonPrompt>('/pairs', { datasetId: practice.dataset.id, mode: 'learn' }); setPractice({ ...practice, pair }); setResult(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load the next comparison.'); }
    finally { setBusy(false); }
  }
  async function undo() {
    if (!result || busy) return;
    setBusy(true); setError('');
    try { await personalRequest(`/choices/${encodeURIComponent(result.comparison.id)}`, {}, 'DELETE'); setResult(null); setPractice(null); setReload(value => value + 1); setNotice('Choice undone. Your model was rebuilt from your remaining choices.'); setPriorRanks({}); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not undo this choice.'); }
    finally { setBusy(false); }
  }
  return <main className="cl-library">
    <PersonalError error={error} dismiss={() => setError('')} />
    {!collectionId ? <>
      <section className="cl-hero"><div><span className="cl-eyebrow"><i />THE WORLD, IN YOUR ORDER</span><h1>Good taste starts<br />with a choice.</h1><p>Real things to discover. A ranking that learns what matters to you.</p><div className="cl-hero-actions"><a href="#cl-collections" className="vr-button vr-button-primary">Find your first collection <Icon name="arrow" size={15} /></a><button className="cl-text-button" onClick={() => setShowSources(true)}>Where the data comes from <Icon name="external" size={13} /></button></div></div><div className="cl-hero-mosaic" aria-hidden="true">{heroCollections.map((collection, i) => <div className={`cl-mosaic-tile cl-mosaic-${i} cl-${collection.kind}`} key={collection.id}><Cover src={collection.previewImages[0]} kind={collection.kind} eager /><span>{CATALOG_LABELS[collection.kind]}</span></div>)}<span className="cl-mosaic-caption"><Icon name="compare" size={15} />Your choices set the order.</span></div></section>
      <div className="cl-library-stats"><div><strong>{summary ? number(summary.total) : '—'}</strong><span>real items</span></div><div><strong>{summary ? number(summary.collections.length) : '—'}</strong><span>collections</span></div><div><strong>{summary ? Object.values(summary.byKind).filter(count => count > 0).length : '—'}</strong><span>types of content</span></div><button onClick={() => setShowSources(true)}><span className="cl-status-dot" /><span>Source records included<small>{summary?.lastCollectedAt ? `Last collected ${relativeDate(summary.lastCollectedAt)}` : 'Opening local database'}</small></span><Icon name="arrow" size={16} /></button></div>
      <section id="cl-collections" className="cl-browse"><div className="cl-section-heading"><div><h2>Find your kind of interesting.</h2><p>Compare similar things. Make each collection yours.</p></div><span>{number(collections.length)} collections</span></div>
      <div className="cl-discovery-toolbar"><form className="cl-collection-search" role="search" onSubmit={event => event.preventDefault()}><Icon name="search" size={17} /><input type="search" value={collectionQuery} onChange={event => { setCollectionQuery(event.target.value); setCollectionLimit(COLLECTION_PAGE_SIZE); }} placeholder="Find a collection, topic, or category…" aria-label="Search collections" />{collectionQuery && <button type="button" onClick={() => { setCollectionQuery(''); setCollectionLimit(COLLECTION_PAGE_SIZE); }} aria-label="Clear collections search"><Icon name="close" size={15} /></button>}</form><span role="status">{summary ? `${number(collections.length)} ${collectionTerms.length || kind !== 'all' ? 'matching ' : ''}collections` : 'Loading collections…'}</span></div>
      <div className="cl-filters" aria-label="Collection category"><button className={kind === 'all' ? 'active' : ''} onClick={() => changeKind('all')} aria-pressed={kind === 'all'}>All collections</button>{CATALOG_KINDS.map(value => <button className={kind === value ? 'active' : ''} key={value} onClick={() => changeKind(value)} aria-pressed={kind === value}><span aria-hidden="true">{KIND_MARK[value]}</span>{CATALOG_LABELS[value]}<small>{number(summary?.byKind[value] || 0)}</small></button>)}</div>
      {!summary ? <div className="cl-empty"><span className="vr-spinner" /><p>Opening your library…</p>{error && <button className="vr-button vr-button-secondary" onClick={() => void refreshSummary().catch(e => setError(String(e)))}>Try again</button>}</div> : <div className="cl-collection-grid" id="cl-collection-results">{visibleCollections.map((collection, index) => <CollectionTile key={collection.id} collection={collection} onOpen={() => openCollection(collection.id)} index={index} />)}</div>}
      {summary && collections.length > 0 && <div className="cl-collection-pagination"><span>Showing {number(visibleCollections.length)} of {number(collections.length)} collections</span>{visibleCollections.length < collections.length && <button className="vr-button vr-button-secondary" aria-controls="cl-collection-results" onClick={() => setCollectionLimit(limit => limit + COLLECTION_PAGE_SIZE)}>Show {number(Math.min(COLLECTION_PAGE_SIZE, collections.length - visibleCollections.length))} more <Icon name="arrow" size={14} /></button>}</div>}
      {summary && !collections.length && <div className="cl-empty"><Icon name={collectionTerms.length ? 'search' : 'source'} size={30} /><h3>{collectionTerms.length ? 'No collections match your search.' : 'No collected collections in this category yet.'}</h3><p>{collectionTerms.length ? 'Try a different topic or clear the category filter.' : 'New collected items will appear here when they are imported.'}</p>{(collectionQuery || kind !== 'all') && <button className="vr-button vr-button-secondary" onClick={clearCollectionFilters}>Clear collection filters</button>}</div>}
      {blockedSources.length > 0 && <div className="cl-unavailable">{blockedSources.map(source => <div key={source.id}><span className="cl-unavailable-symbol">{KIND_MARK[source.kind]}</span><div><strong>{source.label}<span>Not collected</span></strong><p>{source.note}</p></div><button onClick={() => setShowSources(true)} aria-label={`Inspect ${source.label} collection status`}><Icon name="arrow" size={15} /></button></div>)}</div>}
      </section><div className="cl-loop-note"><span>01 <b>Explore a collection</b></span><i /><span>02 <b>Compare two items</b></span><i /><span>03 <b>See your order evolve</b></span></div>
    </> : <>
      <button className="cl-back" onClick={() => { window.location.hash = 'library'; }}><span>←</span>All collections</button>
      {visiblePage ? <><section className="cl-collection-heading"><div><span className="cl-eyebrow">{CATALOG_LABELS[visiblePage.collection.kind]}<span> / </span>{number(visiblePage.collection.count)} REAL ITEMS</span><h1>{visiblePage.collection.title}</h1><p>{collectionDescription(visiblePage.collection)}</p></div><button className="vr-button vr-button-primary cl-practice-button" onClick={() => void beginPractice()} disabled={busy || visiblePage.collection.count < 2}><Icon name="compare" size={17} />{busy ? 'Opening…' : selected.length >= 2 ? `Compare ${selected.length} selected` : 'Teach your ranking'}</button></section>
      <div className="cl-learning-strip"><span className="cl-learning-orbit"><Icon name="memory" size={19} /></span><div><strong>{visiblePage.trainingCount ? `${number(visiblePage.trainingCount)} choices shaping your order` : 'Your point of view starts here.'}</strong><p>{visiblePage.trainingCount ? `Personal model v${visiblePage.modelVersion} · Compare more items to refine it.` : 'Compare two items. Your choice updates the ranking across this collection.'}</p></div><details className="cl-model-details"><summary>How it ranks <Icon name="more" size={16} /></summary><div><strong>{visiblePage.rankingBasis}</strong><p>Ranking learns from collected text metadata such as titles, creators, and attributes. A local 56-feature metadata model learns pairwise preferences. It does not analyze image pixels or call Jev.</p><p>Before you give feedback, the collected item order is shown. Model scores are relative preferences, not verified quality or calibrated probabilities.</p></div></details></div>
      {notice && <div className="cl-feedback-notice" role="status"><Icon name="check" size={15} /><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss ranking update"><Icon name="close" size={13} /></button></div>}
      <div className="cl-toolbar"><form onSubmit={event => { event.preventDefault(); setSearch(query.trim()); setOffset(0); setPriorRanks({}); }}><Icon name="search" size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search this collection…" aria-label="Search this collection" />{query && <button type="button" aria-label="Clear collection search" onClick={() => { setQuery(''); setSearch(''); setOffset(0); setPriorRanks({}); }}><Icon name="close" size={13} /></button>}<button type="submit">Search</button></form><label><span>Order</span><select value={sort} onChange={event => { setSort(event.target.value as Sort); setOffset(0); setPriorRanks({}); }} aria-label="Ranking order"><option value="personal">For you</option><option value="source">Collection order</option><option value="recent">Recently collected</option></select></label><button className="cl-source-button" onClick={() => setShowSources(true)}><Icon name="source" size={15} />Sources</button></div>
      <div className="cl-results-label"><span>{loading ? 'Updating the order…' : `${number(visiblePage.total)} ${search ? 'matching ' : ''}items`}</span>{selected.length ? <button onClick={() => setSelected([])}>{selected.length} selected · Clear</button> : <span>Select items to make your own comparison set</span>}</div>
      <div className={`cl-item-grid ${loading ? 'cl-updating' : ''}`} aria-busy={loading}>{visiblePage.items.map((item, index) => <CatalogCard key={item.id} item={item} index={index} priorRank={priorRanks[item.id]} selected={selected.includes(item.id)} onInspect={() => setInspect(item)} onSelect={() => setSelected(previous => previous.includes(item.id) ? previous.filter(id => id !== item.id) : previous.length < 200 ? [...previous, item.id] : previous)} />)}</div>
      {!loading && !visiblePage.items.length && <div className="cl-empty"><Icon name="search" size={27} /><h3>No items match this search.</h3><p>Try a title, creator, brand, or topic.</p></div>}
      <div className="cl-pagination"><span>{visiblePage.total ? `${number(offset + 1)}–${number(Math.min(offset + visiblePage.items.length, visiblePage.total))} of ${number(visiblePage.total)}` : '0 items'}</span><div><button className="vr-button vr-button-secondary" disabled={loading || offset === 0} onClick={() => { setOffset(Math.max(0, offset - 24)); setPriorRanks({}); window.scrollTo({ top: 230, behavior: 'smooth' }); }}>Previous</button><button className="vr-button vr-button-secondary" disabled={loading || offset + 24 >= visiblePage.total} onClick={() => { setOffset(offset + 24); setPriorRanks({}); window.scrollTo({ top: 230, behavior: 'smooth' }); }}>Next <Icon name="arrow" size={13} /></button></div></div>
      {selected.length > 0 && <div className="cl-selection-bar"><span><b>{selected.length}</b> selected <small>up to 200</small></span><button className="vr-button vr-button-primary" disabled={selected.length < 2 || busy} onClick={() => void beginPractice()}>Compare selected <Icon name="compare" size={14} /></button><button className="cl-text-button" onClick={() => setSelected([])} aria-label="Clear selected items"><Icon name="close" size={17} /></button></div>}
      </> : <div className="cl-empty">{loading && <span className="vr-spinner" />}<p>{error ? 'This collection could not be opened.' : 'Opening the collection…'}</p>{error && <button className="vr-button vr-button-secondary" onClick={() => setReload(value => value + 1)}>Try again</button>}</div>}
    </>}
    {showSources && <PersonalDialog title="Collected from the real web" onClose={() => setShowSources(false)} wide><div className="cl-provenance"><p>Every item links to its original page and records where and when it was observed. Counts describe this local snapshot, not a live inventory.</p><a className="vr-button vr-button-secondary" href="/api/catalog/export" download="valuerank-catalog.json"><Icon name="download" size={14} />Download catalog JSON</a><div className="cl-source-list">{sources.map(source => <article key={source.id}><div><span className={`cl-source-status ${source.status}`} /><strong>{source.label}</strong><span>{number(source.count)} items</span></div><p>{source.note}</p><footer><span>{source.status === 'blocked' ? source.count > 0 ? 'Refresh blocked' : 'Not collected' : source.status === 'partial' ? 'Partial collection' : 'Collected'} · Checked {relativeDate(source.checkedAt)}</span><a href={safeExternalUrl(source.homeUrl)} target="_blank" rel="noreferrer">Visit source <Icon name="external" size={12} /></a></footer></article>)}</div><p className="cl-source-footnote">Metadata and observed thumbnail URLs are stored locally. Images remain on the source hosts. Prices, availability, and source rankings can change.</p></div></PersonalDialog>}
    {inspect && <PersonalDialog title="Item & source record" onClose={() => setInspect(null)} wide><div className={`cl-inspect cl-${inspect.kind}`}><div className="cl-inspect-image"><Cover src={inspect.imageUrl} title={inspect.title} kind={inspect.kind} eager /></div><div className="cl-inspect-copy"><span className="cl-eyebrow">{CATALOG_LABELS[inspect.kind]} / #{inspect.rank}</span><h2>{inspect.title}</h2>{inspect.creator && <p className="cl-inspect-creator">{inspect.creator}</p>}{inspect.description && <p>{inspect.description}</p>}{priceLabel(inspect) && <strong className="cl-price">{priceLabel(inspect)}</strong>}<dl>{Object.entries(inspect.attributes).filter(([key]) => !['description', 'title', 'imageUrl'].includes(key)).slice(0, 12).map(([key, value]) => <div key={key}><dt>{key.replace(/([A-Z])/g, ' $1')}</dt><dd>{String(value)}</dd></div>)}<div><dt>Observed</dt><dd>{new Date(inspect.observedAt).toLocaleString()}</dd></div><div><dt>Extraction</dt><dd>{inspect.extraction === 'browser-dom' ? 'Observed browser page' : 'Official API'}</dd></div><div><dt>Record</dt><dd>Version {inspect.version}</dd></div></dl><a className="vr-button vr-button-primary" href={safeExternalUrl(inspect.url)} target="_blank" rel="noreferrer">Open original item <Icon name="external" size={14} /></a><a className="cl-inspect-listing" href={safeExternalUrl(inspect.listingUrl)} target="_blank" rel="noreferrer">View collection source <Icon name="external" size={11} /></a></div></div></PersonalDialog>}
    {practice && <PersonalDialog title="Teach your ranking" onClose={() => { if (!busy) setPractice(null); }} wide><div className="cl-practice"><PersonalError error={error} dismiss={() => setError('')} /><div className="cl-practice-context"><span>{visiblePage?.collection.title || 'Your collection'}</span><span>{number(practice.learningSetSize)} items in this learning set{practice.learningSetSize < practice.collectionSize ? ` · ${number(practice.collectionSize)} in collection` : ''}</span></div><PersonalComparison key={practice.pair.exposure.id} pair={practice.pair} result={result} busy={busy} onChoose={choose} onNext={() => { if (practice.learningSetSize === 2) { setPractice(null); setSelected([]); } else void nextPair(); }} nextLabel={practice.learningSetSize === 2 ? 'Back to your ranking' : 'Next comparison'} onUndo={undo} />{result && <button className="cl-return-ranking" onClick={() => setPractice(null)}>See my updated ranking <Icon name="arrow" size={14} /></button>}<p className="cl-practice-note">Your choice trains the metadata model for this category. The whole collection is reranked. You can undo any choice.</p></div></PersonalDialog>}
  </main>;
}
