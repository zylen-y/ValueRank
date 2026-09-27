import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const out=path.dirname(fileURLToPath(import.meta.url));
mkdirSync(path.join(out,'evidence'),{recursive:true});
const session='catalog-editorial';
function browser(...args){return execFileSync('npx',['--yes','agent-browser','--session',session,...args],{encoding:'utf8',timeout:90000,maxBuffer:30*1024*1024});}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const arxivExtract=String.raw`(() => {
const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
return {url:location.href,title:document.title,heading:text(document.querySelector('h1')),items:Array.from(document.querySelectorAll('li.arxiv-result')).map(e=>{
const url=e.querySelector('.list-title a')?.href; const abstract=e.querySelector('.abstract-full')?.cloneNode(true);abstract?.querySelectorAll('a,script,.MathJax_Preview').forEach(n=>n.remove());
const categories=Array.from(e.querySelectorAll('.tags .tag')).map(text).join(', ');
return {externalId:url?.split('/abs/')[1],title:text(e.querySelector('.title')),url,creator:Array.from(e.querySelectorAll('.authors a')).map(text).join(', '),description:text(abstract).slice(0,280),attributes:{categories,submission:text(e.querySelector('p.is-size-7')),comments:text(e.querySelector('.comments')).slice(0,240)}};}).filter(i=>i.title&&i.url)};
})()`;
const booksExtract=String.raw`(() => {
const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
return {url:location.href,title:document.title,heading:text(document.querySelector('h1')),items:Array.from(document.querySelectorAll('li.searchResultItem')).map(e=>{
const a=e.querySelector('h3.booktitle a');const key=a?.pathname.match(/\/(works|books)\/(OL\d+[WM])/);const subjects=Array.from(e.querySelectorAll('.srw__subjects ol-chip')).map(text).join(', ');const details=text(e.querySelector('.resultDetails'));const image=e.querySelector('.bookcover img');const rating=e.querySelector('meta[itemprop="ratingValue"]')?.content;const ratingCount=e.querySelector('meta[itemprop="ratingCount"]')?.content;const year=details.match(/First published in (\d{4})/)?.[1];const editions=details.match(/(\d+) editions?/)?.[1];const attrs={subjects,details};if(year)attrs.firstPublished=Number(year);if(rating)attrs.rating=Number(rating);if(ratingCount)attrs.ratingCount=Number(ratingCount);if(editions)attrs.editions=Number(editions);
return {externalId:key?.[2],title:text(a),url:key?location.origin+'/'+key[1]+'/'+key[2]:a?.href,creator:Array.from(e.querySelectorAll('.bookauthor a')).map(text).join(', '),description:subjects.slice(0,280),...(image?.getAttribute('src')?.includes('covers.openlibrary.org')?{imageUrl:image.src}:{}),attributes:attrs};}).filter(i=>i.title&&i.url)};
})()`;
const specs=[
{id:'arxiv',label:'arXiv',homeUrl:'https://arxiv.org',kind:'papers',extract:arxivExtract,topics:[['reinforcement-learning','Reinforcement learning','reinforcement learning',1],['ai-agents','AI agents','AI agents',1],['language-learning','Language learning research','language learning',1]]},
{id:'open-library',label:'Open Library',homeUrl:'https://openlibrary.org',kind:'books',extract:booksExtract,topics:[['artificial-intelligence','Artificial intelligence','artificial intelligence',4],['machine-learning','Machine learning','machine learning',4],['design','Design and interfaces','design',4],['startup','Startups and building','startup',4],['language-learning','Language learning','language learning',4],['reinforcement-learning','Reinforcement learning','reinforcement learning',1]]}
];
for(const spec of specs.filter(spec => !process.env.SOURCE || spec.id === process.env.SOURCE)){
const byId=new Map(),collections=[],evidence=[];let failed=false;
sourceTopics:
for(const [slug,title,query,pages] of spec.topics){const collectionId=spec.id+'-'+slug;collections.push({id:collectionId,title,kind:spec.kind,description:`Public ${spec.label} search results for ${query}; metadata captured from browser-rendered result cards.`});
for(let page=1;page<=pages;page++){
const url=spec.id==='arxiv'?`https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all&abstracts=show&order=-announced_date_first&size=200&start=${(page-1)*200}`:`https://openlibrary.org/search?q=${encodeURIComponent(query)}&page=${page}`;
try{browser('open',url);const parsed=JSON.parse(browser('eval',spec.extract));const observedAt=new Date().toISOString();if(!parsed.items.length)throw Error('No recognized public result cards; stop this topic');
const itemRows=parsed.items.map(item=>({...item,sourceId:spec.id,kind:spec.kind,collectionIds:[collectionId],observedAt,listingUrl:parsed.url,extraction:'browser-dom'}));
writeFileSync(path.join(out,'evidence',`${spec.id}-${slug}-${page}.json`),JSON.stringify({url:parsed.url,pageTitle:parsed.title,heading:parsed.heading,observedAt,itemCount:itemRows.length,items:itemRows},null,2)+'\n');
if(page===1){const snapshot=browser('snapshot','-i');writeFileSync(path.join(out,'evidence',`${spec.id}-${slug}-snapshot.txt`),snapshot);}
for(const item of itemRows){const key=item.externalId||item.url;const old=byId.get(key);if(old){old.collectionIds=Array.from(new Set([...old.collectionIds,...item.collectionIds]));}else byId.set(key,item);}
evidence.push({url:parsed.url,observedAt,count:itemRows.length});console.log(`${spec.id}/${slug}/${page}: ${itemRows.length} rows, ${byId.size} unique`);
}catch(error){failed=true;evidence.push({url,error:String(error.message).slice(0,1000)});console.log(`${spec.id}/${slug}/${page}: failed ${String(error.message).slice(0,150)}`);break sourceTopics;}
await delay(1200);
}}
const batch={source:{id:spec.id,label:spec.label,homeUrl:spec.homeUrl,kind:spec.kind,status:failed?'partial':'collected',checkedAt:new Date().toISOString(),note:'Public browser DOM metadata only. No full texts or image binaries downloaded. Search cohorts reflect query relevance and source coverage, not exhaustive catalog membership.'},collections,items:[...byId.values()]};
writeFileSync(path.join(out,spec.id+'.json'),JSON.stringify(batch,null,2)+'\n');writeFileSync(path.join(out,spec.id+'-crawl-report.json'),JSON.stringify({sourceId:spec.id,uniqueItems:byId.size,pages:evidence},null,2)+'\n');
console.log(`SAVED ${spec.id}: ${byId.size} unique`);
}
