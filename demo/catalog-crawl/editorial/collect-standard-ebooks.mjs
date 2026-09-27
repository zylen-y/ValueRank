import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const out=path.dirname(fileURLToPath(import.meta.url));mkdirSync(path.join(out,'evidence'),{recursive:true});
function browser(...args){return execFileSync('npx',['--yes','agent-browser','--session','catalog-editorial',...args],{encoding:'utf8',timeout:90000,maxBuffer:30*1024*1024});}
const extract=String.raw`(() => {
const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
return {url:location.href,title:document.title,heading:text(document.querySelector('h1')),next:document.querySelector('a[rel=next]')?.href,items:Array.from(document.querySelectorAll('li[typeof="schema:Book"]')).map(e=>{
const a=e.querySelector('p > a[property="schema:url"]');const details=text(e.querySelector('.details'));const subjects=Array.from(e.querySelectorAll('.tags a')).map(text).join(', ');const stats=details.match(/([\d,]+) words\s*•\s*([\d.]+) reading ease/);const image=e.querySelector('img');const attrs={subjects};if(stats){attrs.wordCount=Number(stats[1].replace(/,/g,''));attrs.readingEase=Number(stats[2]);}const translated=Array.from(e.querySelectorAll('.details p')).find(p=>text(p).startsWith('Translated by'));if(translated)attrs.translation=text(translated);
return {externalId:e.getAttribute('about').replace('/ebooks/',''),title:text(a),url:a?.href,creator:Array.from(e.querySelectorAll('.author')).map(text).join(', '),description:details.slice(0,280),imageUrl:image?.src,attributes:attrs};}).filter(i=>i.title&&i.url)};
})()`;
const topics=[['philosophy','Philosophy & reflection',2],['nonfiction','Nonfiction & ideas',2],['science-fiction','Science fiction',3],['mystery','Mystery & detective fiction',3]];
const byId=new Map(),collections=[],pages=[];let failed=false;
sourceTopics:
for(const [slug,title,limit] of topics){const collectionId='standard-ebooks-'+slug;collections.push({id:collectionId,title,kind:'books',description:`Books listed in Standard Ebooks' ${slug} subject catalog. Comparable metadata includes length and reading ease.`});let url=`https://standardebooks.org/subjects/${slug}?per-page=48&sort=popularity&view=list`;
for(let page=1;page<=limit;page++){
try{browser('open',url);const parsed=JSON.parse(browser('eval',extract));const observedAt=new Date().toISOString();if(!parsed.items.length)throw Error('No recognized public book cards; stopped source without bypass.');const items=parsed.items.map(item=>({...item,sourceId:'standard-ebooks',kind:'books',collectionIds:[collectionId],observedAt,listingUrl:parsed.url,extraction:'browser-dom'}));
writeFileSync(path.join(out,'evidence',`standard-ebooks-${slug}-${page}.json`),JSON.stringify({url:parsed.url,title:parsed.title,heading:parsed.heading,observedAt,itemCount:items.length,items},null,2)+'\n');if(page===1){writeFileSync(path.join(out,'evidence',`standard-ebooks-${slug}-snapshot.txt`),browser('snapshot','-i'));}
for(const item of items){const old=byId.get(item.externalId);if(old)old.collectionIds=Array.from(new Set([...old.collectionIds,...item.collectionIds]));else byId.set(item.externalId,item);}
pages.push({url:parsed.url,observedAt,count:items.length});console.log(`${slug}/${page}: ${items.length} rows, ${byId.size} unique`);if(!parsed.next)break;url=parsed.next;
}catch(error){failed=true;pages.push({url,error:String(error.message).slice(0,1000)});console.log(`Stopped: ${String(error.message).slice(0,150)}`);break sourceTopics;}
await new Promise(r=>setTimeout(r,1800));
}}
const batch={source:{id:'standard-ebooks',label:'Standard Ebooks',homeUrl:'https://standardebooks.org',kind:'books',status:failed?'partial':'collected',checkedAt:new Date().toISOString(),note:'Public browser DOM metadata from subject pages, bounded pagination; cover URLs reference images actually present in the page. No ebook/fulltext or image binary downloads. Editions/translations remain distinct IDs.'},collections,items:[...byId.values()]};writeFileSync(path.join(out,'standard-ebooks.json'),JSON.stringify(batch,null,2)+'\n');writeFileSync(path.join(out,'standard-ebooks-crawl-report.json'),JSON.stringify({sourceId:'standard-ebooks',uniqueItems:byId.size,pages},null,2)+'\n');console.log(`SAVED ${byId.size} books`);
