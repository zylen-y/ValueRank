import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const dir=dirname(new URL(import.meta.url).pathname); mkdirSync(resolve(dir,'evidence'),{recursive:true});
const extract=readFileSync(resolve(dir,'netflix-extract.js'),'utf8');
const seeds=[['https://www.netflix.com/browse/genre/7424','anime'],['https://www.netflix.com/browse/genre/83','series'],['https://www.netflix.com/browse/genre/34399','movies']];
const queue=seeds.map(([url,kind])=>({url,kind})); const seen=new Set(); const report=[]; const maxPages=Number(process.env.NETFLIX_MAX_PAGES||90);
function browser(args,input){return execFileSync('npx',['--yes','agent-browser','--session','expand-screen',...args],{encoding:'utf8',input,maxBuffer:25*1024*1024,timeout:60000});}
for(let cursor=0;cursor<queue.length && report.length<maxPages;cursor++){
 const {url,kind}=queue[cursor]; if(seen.has(url))continue; seen.add(url); const id=url.match(/genre\/(\d+)/)?.[1]; if(!id)continue;
 const file=resolve(dir,'evidence',`netflix-${id}.json`); let page;
 try{if(existsSync(file)){page=JSON.parse(readFileSync(file,'utf8'));}else{browser(['open',url]); page=JSON.parse(JSON.parse(browser(['eval','--stdin'],extract))); page.kind=kind;writeFileSync(file,JSON.stringify(page,null,2)+'\n');}
 const blocked=/sign in to|verify you are human|unusual activity|access denied/i.test(page.bodyIntro)&&page.cards.length===0;
 report.push({url,kind,heading:page.heading,cards:page.cards.length,blocked}); console.log(JSON.stringify(report.at(-1)));
 if(blocked)continue;
 for(const link of page.genres){ if(!seen.has(link.url) && !queue.some(q=>q.url===link.url) && /movie|film|series|tv|anime|animation|documentar/i.test(link.label)) {
 const linkKind=/anime|animation/i.test(link.label)?'anime':/series|tv/i.test(link.label)?'series':/movie|film/i.test(link.label)?'movies':kind;queue.push({url:link.url,kind:linkKind}); }
 }
 }catch(error){report.push({url,kind,error:error.message.slice(0,250)}); console.log(JSON.stringify(report.at(-1)));}
 writeFileSync(resolve(dir,'netflix-crawl-report.json'),JSON.stringify({pages:report,queue},null,2)+'\n');
}
browser(['screenshot',resolve(dir,'evidence/netflix-catalog.png')]);
