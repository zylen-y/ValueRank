import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname), repo=path.resolve(root,'../../..');
const ab=(...args)=>execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle',...args],{encoding:'utf8',maxBuffer:32e6,timeout:60000});
const evaluate=js=>JSON.parse(execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle','eval','--stdin'],{input:js,encoding:'utf8',maxBuffer:32e6,timeout:60000}));
const parser=readFileSync(path.join(repo,'catalog-crawl/shopping/extract-musinsa.js'),'utf8');
const categories=[['상의','Tops'],['가방','Bags'],['모자','Hats'],['소품','Accessories'],['원피스/스커트','Dresses and skirts'],['아우터','Outerwear'],['바지','Pants'],['신발','Shoes'],['스포츠/레저','Sports and leisure'],['속옷/홈웨어','Underwear and loungewear']];
const reports=[];
for(const [label,name] of categories){
 ab('open','https://www.musinsa.com/main/musinsa/ranking');
 const clicked=evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`);
 if(!clicked)throw Error('Missing visible category '+label);
 ab('wait','800');
 writeFileSync(path.join(root,'evidence',`musinsa-${name.replaceAll(' ','-')}.snapshot.txt`),ab('snapshot','-i'));
 const map=new Map(),captures=[];let unchanged=0,last=0,category;
 for(let step=0;step<38;step++){
  const raw=evaluate(parser);category=raw.category;
  for(const i of raw.items){i.attributes.category=name;if(!map.has(i.externalId))map.set(i.externalId,i);}
  captures.push({step,observedAt:raw.observedAt,listingUrl:raw.listingUrl,visibleCount:raw.items.length,uniqueCount:map.size,firstRank:raw.items[0]?.attributes.sourceRank,lastRank:raw.items.at(-1)?.attributes.sourceRank});
  unchanged=map.size===last?unchanged+1:0;last=map.size;
  if(map.size>=700||unchanged>=3)break;
  ab('scroll','down','2800');ab('wait','450');
 }
 const data={category,name,captures,items:[...map.values()]};
 writeFileSync(path.join(root,'evidence',`musinsa-${category}.browser.json`),JSON.stringify(data,null,2)+'\n');
 reports.push({category,name,count:map.size,captures:captures.length});
 writeFileSync(path.join(root,'musinsa-report.json'),JSON.stringify(reports,null,2)+'\n');
 console.log(name,map.size,'captures',captures.length);
}
