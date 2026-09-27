/** Sequential browser DOM collection of the Standard Ebooks public catalog. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const out = path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(out, 'evidence'), { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function browser(...args) { return execFileSync('npx', ['--yes', 'agent-browser', '--session', 'expand-editorial', ...args], {encoding: 'utf8', timeout: 90000, maxBuffer: 30 * 1024 * 1024}); }
const extract = String.raw`(() => {
  const text = e => (e?.textContent || '').replace(/\s+/g, ' ').trim();
  return {url: location.href, title: document.title, heading: text(document.querySelector('h1')), next: document.querySelector('a[rel=next]')?.href,
    challenge: /verify you are human|access denied|captcha|just a moment/i.test(document.title),
    items: Array.from(document.querySelectorAll('li[typeof="schema:Book"]')).map(e => {
      const a = e.querySelector('p > a[property="schema:url"]'); const details = text(e.querySelector('.details'));
      const subjects = Array.from(e.querySelectorAll('.tags a')).map(a => ({name: text(a), url: a.href, slug: a.pathname.split('/subjects/')[1]}));
      const stats = details.match(/([\d,]+) words\s*•\s*([\d.]+) reading ease/); const image = e.querySelector('img');
      const attributes = {subjects: subjects.map(s => s.name).join(', ')};
      if (stats) {attributes.wordCount = Number(stats[1].replace(/,/g, '')); attributes.readingEase = Number(stats[2]);}
      const translated = Array.from(e.querySelectorAll('.details p')).find(p => text(p).startsWith('Translated by'));
      if (translated) attributes.translation = text(translated).slice(0, 2000);
      return {externalId: e.getAttribute('about')?.replace('/ebooks/', ''), title: text(a).slice(0,500), url: a?.href, creator: Array.from(e.querySelectorAll('.author')).map(text).join(', ').slice(0,2000), description: details.slice(0,280), ...(image?.src ? {imageUrl: image.src} : {}), attributes, subjects};
    }).filter(i => i.title && i.url)
  };
})()`;
const baseCollection = {id: 'standard-ebooks-catalog', title: 'Classic books · full discovery shelf', kind: 'books', description: 'Standard Ebooks public-domain editions, collected from browser-rendered catalog cards. Editions and translations retain distinct source identities.'};
const byId = new Map(), collections = new Map([[baseCollection.id, baseCollection]]), pages = [];
const oldIds = new Set(JSON.parse(readFileSync(path.join(out, '../../editorial/standard-ebooks.json'), 'utf8')).items.map(i => i.externalId || i.url));
let url = 'https://standardebooks.org/ebooks?per-page=48&sort=popularity&view=list', stopped = false, exhausted = false;
function save() {
  const items = [...byId.values()];
  const batch = {source: {id: 'standard-ebooks', label: 'Standard Ebooks', homeUrl: 'https://standardebooks.org', kind: 'books', status: stopped ? 'partial' : 'collected', checkedAt: new Date().toISOString(), note: 'Public browser DOM catalog metadata only. Subject membership comes from source tags. Covers are observed remote URLs; no image binaries, ebook files, or full texts downloaded. Primarily classic public-domain literature; not a contemporary book catalog.'}, collections: [...collections.values()], items};
  writeFileSync(path.join(out, 'standard-ebooks-expanded.json'), JSON.stringify(batch, null, 2) + '\n');
  writeFileSync(path.join(out, 'standard-ebooks-report.json'), JSON.stringify({sourceId: 'standard-ebooks', uniqueItems: items.length, additionalVsOriginal: items.filter(i => !oldIds.has(i.externalId || i.url)).length, collections: collections.size, reachedLastPage: exhausted, pages}, null, 2) + '\n');
}
for (let page = 1; page <= Number(process.env.BOOK_MAX_PAGES || 50); page++) {
  try {
    const evidencePath = path.join(out, 'evidence', `standard-ebooks-catalog-${page}.json`); let evidence;
    if (existsSync(evidencePath)) evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    else {
      browser('open', url); const parsed = JSON.parse(browser('eval', extract));
      if (parsed.challenge || !parsed.items.length) throw new Error(`No public catalog cards or challenge (${parsed.title}); stopped without bypass.`);
      evidence = {...parsed, observedAt: new Date().toISOString()}; writeFileSync(evidencePath, JSON.stringify(evidence) + '\n');
      if (page === 1) writeFileSync(path.join(out, 'evidence', 'standard-ebooks-catalog-snapshot.txt'), browser('snapshot', '-i'));
      await delay(1600);
    }
    for (const {subjects, ...raw} of evidence.items) {
      const collectionIds = [baseCollection.id];
      for (const subject of subjects) {
        if (!subject.slug || !/^[a-z0-9-]+$/.test(subject.slug)) continue;
        const id = 'standard-ebooks-' + subject.slug; collectionIds.push(id);
        collections.set(id, {id, title: subject.name, kind: 'books', description: `Public-domain editions labeled “${subject.name}” by Standard Ebooks. Membership is taken directly from visible source catalog tags.`});
      }
      const item = {...raw, sourceId: 'standard-ebooks', kind: 'books', collectionIds, observedAt: evidence.observedAt, listingUrl: evidence.url, extraction: 'browser-dom'};
      byId.set(item.externalId || item.url, item);
    }
    pages.push({url: evidence.url, observedAt: evidence.observedAt, count: evidence.items.length});
    console.log(`books/${page}: ${evidence.items.length} cards; ${byId.size} unique; ${[...byId.keys()].filter(id => !oldIds.has(id)).length} additional`);
    if (!evidence.next || evidence.next === url) {exhausted = true; save(); break;}
    url = evidence.next; save();
  } catch (error) { stopped = true; pages.push({url, error: String(error.message).slice(0,1000)}); console.error(String(error.message).slice(0,300)); save(); break; }
}
save(); console.log(`SAVED ${byId.size} unique books; ${collections.size} cohorts`);
