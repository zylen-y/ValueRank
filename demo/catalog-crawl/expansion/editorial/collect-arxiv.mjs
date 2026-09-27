/** Public rendered listing metadata only; sequential, bounded pagination, resumable evidence. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(out, 'evidence'), { recursive: true });
if (existsSync(path.join(out, 'evidence', 'arxiv-rate-limit.txt'))) {
  console.error('The previous browser run reached an arXiv rate limit. Existing evidence is preserved; this collector will not retry the limited source.');
  process.exit(2);
}
const session = 'expand-editorial';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function browser(...args) { return execFileSync('npx', ['--yes', 'agent-browser', '--session', session, ...args], { encoding: 'utf8', timeout: 90000, maxBuffer: 30 * 1024 * 1024 }); }
const extract = String.raw`(() => {
  const text = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  return {url: location.href, title: document.title, heading: text(document.querySelector('h1')), next: document.querySelector('a.pagination-next')?.href,
    challenge: /verify you are human|access denied|captcha|just a moment/i.test(document.title),
    items: Array.from(document.querySelectorAll('li.arxiv-result')).map(e => {
      const a = e.querySelector('.list-title a'); const url = a?.href;
      const abstract = e.querySelector('.abstract-full')?.cloneNode(true); abstract?.querySelectorAll('a,script,.MathJax_Preview').forEach(n => n.remove());
      const title = text(e.querySelector('.title')); const creator = Array.from(e.querySelectorAll('.authors a')).map(text).join(', ');
      const attributes = {categories: Array.from(e.querySelectorAll('.tags .tag')).map(text).join(', '), submission: text(e.querySelector('p.is-size-7')), comments: text(e.querySelector('.comments')).slice(0, 240)};
      if (creator.length > 2000) attributes.creatorTruncated = 'true'; if (title.length > 500) attributes.titleTruncated = 'true';
      return {externalId: url?.split('/abs/')[1], title: title.slice(0, 500), url, creator: creator.slice(0, 2000), description: text(abstract).slice(0, 280), attributes};
    }).filter(i => i.title && i.url)
  };
})()`;
const topics = [
  ['computer-vision', 'Computer vision', 'computer vision'],
  ['reinforcement-learning-expanded', 'Reinforcement learning · extended', 'reinforcement learning'],
  ['natural-language-processing', 'Natural language processing', 'natural language processing'],
  ['robotics', 'Robotics & embodied systems', 'robotics'],
  ['recommendation-systems', 'Recommender systems', 'recommender systems'],
  ['information-retrieval', 'Information retrieval & search', 'information retrieval'],
  ['human-computer-interaction', 'Human–computer interaction', 'human computer interaction'],
  ['speech-recognition', 'Speech & audio learning', 'speech recognition'],
  ['generative-models', 'Generative models', 'generative models'],
  ['causal-inference', 'Causal inference', 'causal inference'],
  ['graph-neural-networks', 'Graph neural networks', 'graph neural networks'],
  ['quantum-computing', 'Quantum computing', 'quantum computing'],
  ['computational-biology', 'Computational biology', 'computational biology'],
  ['climate-science', 'Climate & environmental science', 'climate'],
  ['astrophysics', 'Astrophysics', 'astrophysics'],
  ['cybersecurity', 'Security & privacy', 'cybersecurity'],
  ['economics', 'Economics & markets', 'economics'],
  ['optimization', 'Optimization', 'optimization'],
  ['education', 'Education & learning science', 'education'],
  ['music-generation', 'Music computation & generation', 'music'],
  ['medical-imaging', 'Medical imaging', 'medical imaging'],
  ['distributed-systems', 'Distributed systems', 'distributed systems'],
  ['game-theory', 'Game theory', 'game theory'],
  ['programming-languages', 'Programming languages', 'programming languages'],
  ['materials-science', 'Materials science', 'materials science'],
  ['mathematics', 'Mathematics', 'mathematics'],
  ['neuroscience', 'Neuroscience', 'neuroscience'],
  ['language-learning-expanded', 'Language learning · extended', 'language learning'],
  ['ai-agents-expanded', 'AI agents · extended', 'AI agents'],
  ['visual-design', 'Visual design research', 'visual design'],
  ['statistics', 'Statistics', 'statistics'],
  ['cryptography', 'Cryptography', 'cryptography'],
  ['fairness', 'Fairness & responsible AI', 'fairness'],
  ['data-visualization', 'Data visualization', 'data visualization'],
  ['databases', 'Databases', 'databases'],
];
const oldIds = new Set(JSON.parse(readFileSync(path.join(out, '../../editorial/arxiv.json'), 'utf8')).items.map(i => i.externalId || i.url));
const byId = new Map(), collections = [], pages = []; let stopped = false;
const maxPages = Number(process.env.PAGES_PER_TOPIC || 4);
const targetAdditional = Number(process.env.TARGET_ADDITIONAL || 14500);
function save() {
  const items = [...byId.values()];
  const batch = {source: {id: 'arxiv', label: 'arXiv', homeUrl: 'https://arxiv.org', kind: 'papers', status: stopped ? 'partial' : 'collected', checkedAt: new Date().toISOString(), note: 'Public browser-rendered search results, sequential bounded pagination. Query cohorts are discovery groups, not verified research classifications. Metadata and brief excerpts only; no full papers downloaded. Some long author lists are explicitly marked truncated.'}, collections, items};
  writeFileSync(path.join(out, 'arxiv-expanded.json'), JSON.stringify(batch, null, 2) + '\n');
  writeFileSync(path.join(out, 'arxiv-report.json'), JSON.stringify({sourceId: 'arxiv', uniqueItems: items.length, additionalVsOriginal: items.filter(i => !oldIds.has(i.externalId || i.url)).length, collections: collections.length, pages}, null, 2) + '\n');
}
outer:
for (const [slug, title, query] of topics) {
  if ([...byId.keys()].filter(id => !oldIds.has(id)).length >= targetAdditional || byId.size >= 18500) break;
  const collectionId = 'arxiv-' + slug;
  const collection = {id: collectionId, title, kind: 'papers', description: `Public arXiv search for “${query}”, newest announcements first. Browser-collected search metadata; query relevance is not an expert subject classification.`};
  let url = `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all&abstracts=show&order=-announced_date_first&size=200&start=0`;
  for (let page = 1; page <= maxPages; page++) {
    const evidencePath = path.join(out, 'evidence', `arxiv-${slug}-${page}.json`);
    try {
      let evidence;
      if (existsSync(evidencePath)) evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
      else {
        browser('open', url);
        const parsed = JSON.parse(browser('eval', extract));
        if (parsed.challenge || !parsed.items.length) throw new Error(`Stopped: no public listing cards or challenge (${parsed.title}).`);
        evidence = {...parsed, observedAt: new Date().toISOString()};
        writeFileSync(evidencePath, JSON.stringify(evidence) + '\n');
        if (page === 1) writeFileSync(path.join(out, 'evidence', `arxiv-${slug}-snapshot.txt`), browser('snapshot', '-i'));
        await delay(1800);
      }
      if (!collections.some(c => c.id === collectionId)) collections.push(collection);
      for (const raw of evidence.items) {
        const item = {...raw, sourceId: 'arxiv', kind: 'papers', collectionIds: [collectionId], observedAt: evidence.observedAt, listingUrl: evidence.url, extraction: 'browser-dom'};
        const key = item.externalId || item.url; const prior = byId.get(key);
        if (prior) prior.collectionIds = [...new Set([...prior.collectionIds, collectionId])]; else byId.set(key, item);
      }
      pages.push({collectionId, url: evidence.url, observedAt: evidence.observedAt, count: evidence.items.length});
      console.log(`${slug}/${page}: ${evidence.items.length} cards; ${byId.size} unique; ${[...byId.keys()].filter(id => !oldIds.has(id)).length} additional`);
      save();
      if (!evidence.next || evidence.next === url) break;
      url = evidence.next;
    } catch (error) {
      stopped = true; pages.push({collectionId, url, error: String(error.message).slice(0, 1000)}); save();
      console.error(`Source stopped: ${String(error.message).slice(0, 300)}`); break outer;
    }
  }
}
save();
console.log(`SAVED ${byId.size} unique papers across ${collections.length} cohorts`);
