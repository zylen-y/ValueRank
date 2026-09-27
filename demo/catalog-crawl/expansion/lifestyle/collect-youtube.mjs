import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
const ab=(...args)=>execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle-video',...args],{encoding:'utf8',maxBuffer:32e6,timeout:60000});
const evaluate=js=>{let v=JSON.parse(execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle-video','eval','--stdin'],{input:js,encoding:'utf8',maxBuffer:32e6,timeout:60000}));return typeof v==='string'?JSON.parse(v):v};
const parser=readFileSync(path.resolve(root,'../../culture/youtube-dom.js'),'utf8');
const specs=[['TED','Ideas and talks'],['Vox','Explainers and society'],['veritasium','Science'],['kurzgesagt','Science animation'],['NatGeo','Nature and exploration'],['mkbhd','Consumer technology'],['theschooloflifetv','Philosophy and psychology'],['crashcourse','Education'],['epicurious','Food and cooking'],['Archdigest','Architecture and interiors'],['linguamarina','English learning'],['YCombinator','Startups and building']];
const reports=[];
ab('set','viewport','1280','800');
const selected=process.argv.slice(2);
for(const [handle,topic] of specs.filter(([handle])=>!selected.length||selected.includes(handle))){
 try{
 ab('open',`https://www.youtube.com/@${handle}/videos`);ab('wait','h3');
 const map=new Map();let unchanged=0,last=0,raw;const captures=[];
 for(let step=0;step<48;step++){
  raw=evaluate(parser);
  for(const record of raw.records){const old=map.get(record.externalId);if(!old||(!old.imageUrl&&record.imageUrl))map.set(record.externalId,record);}
  captures.push({step,visible:raw.records.length,unique:map.size,observedAt:raw.fetchedAt});
  unchanged=map.size===last?unchanged+1:0;last=map.size;
  if(map.size>=240||unchanged>=6)break;
  ab('scroll','down','1700');ab('wait','550');
 }
 const result={...raw,topic,captures,records:[...map.values()]};
 writeFileSync(path.join(root,'evidence',`youtube-${handle.toLowerCase()}.browser.json`),JSON.stringify(result,null,2)+'\n');
 const summary={handle,topic,url:raw.sourceUrl,count:map.size,images:result.records.filter(r=>r.imageUrl).length,captures:captures.length};reports.push(summary);
 console.log(handle,map.size,summary.images+'images');
 }catch(error){reports.push({handle,topic,error:String(error).slice(0,300)});console.log(handle,'unavailable');}
 writeFileSync(path.join(root,'youtube-report.json'),JSON.stringify(reports,null,2)+'\n');
}
