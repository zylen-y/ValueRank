import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
const ab=(...args)=>execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle-music',...args],{encoding:'utf8',maxBuffer:32e6,timeout:60000});
const evaluate=js=>JSON.parse(execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle-music','eval','--stdin'],{input:js,encoding:'utf8',maxBuffer:32e6,timeout:60000}));
const links=JSON.parse(readFileSync(path.join(root,'evidence/oliveyoung-category-links.browser.json'),'utf8'));
const titles=['All Bath & Body','All Hair','All Masks','All Sun Care','Makeup Brush & Tools','Men`s Care','All Skincare','All Makeup'];
const parser=readFileSync(path.resolve(root,'../../shopping/extract-oliveyoung-global.js'),'utf8'),report=[];
for(const title of titles){
 const link=links.find(l=>l.title===title);if(!link)continue;
 ab('open',link.url);ab('wait','.brand-info dd');
 const changed=evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='48');if(!button)return false;button.click();return true})()`);
 if(!changed)throw Error('No page-size control '+title);ab('wait','1100');
 const map=new Map(),captures=[];let raw;
 for(let page=0;page<7;page++){
  raw=evaluate(parser);for(const item of raw.items){item.attributes.category=title.replace(/^All /,'');if(!map.has(item.externalId))map.set(item.externalId,item);}
  captures.push({page:page+1,observedAt:raw.observedAt,listingUrl:raw.listingUrl,visibleCount:raw.items.length,uniqueCount:map.size});
  if(page===6)break;
  const hasMore=evaluate(`(()=>{const b=[...document.querySelectorAll('button.btn-page-more')].find(b=>b.offsetParent&&!b.disabled);if(!b)return false;b.scrollIntoView();b.click();return true})()`);
  if(!hasMore)break;ab('wait','1000');
 }
 writeFileSync(path.join(root,'evidence',`oliveyoung-${raw.category}.browser.json`),JSON.stringify({category:raw.category,name:title.replace(/^All /,''),captures,items:[...map.values()]},null,2)+'\n');
 report.push({category:raw.category,title,count:map.size,captures:captures.length});writeFileSync(path.join(root,'oliveyoung-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(title,map.size);
}
