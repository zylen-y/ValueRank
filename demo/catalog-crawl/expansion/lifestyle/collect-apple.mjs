import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname);
const ab=(...args)=>execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle-music',...args],{encoding:'utf8',maxBuffer:32e6,timeout:60000});
const evaluate=js=>{let v=JSON.parse(execFileSync('npx',['--yes','agent-browser','--session','expand-lifestyle-music','eval','--stdin'],{input:js,encoding:'utf8',maxBuffer:32e6,timeout:60000}));return typeof v==='string'?JSON.parse(v):v};
const links=JSON.parse(readFileSync(path.join(root,'evidence/apple-country-links.browser.json'),'utf8'));
const names=['USA','UK','Canada','Mexico','Australia','Japan','Spain','France','Germany','Russia','Argentina','Armenia','Austria','Azerbaijan','Bahrain','Belarus','Belgium','Bolivia','Botswana','Brazil','Bulgaria','Cambodia','Chile','China','Colombia','Czechia','Denmark','Egypt','Finland','Ghana'];
const parser=readFileSync(path.resolve(root,'../../culture/apple-dom.js'),'utf8');
const report=[];
for(const name of names){
 const link=links.find(l=>l.title==='Top 100: '+name);if(!link)continue;
 ab('open',link.url);ab('wait','[data-testid="track-list-item"]');
 const raw=evaluate(parser);
 if(raw.records.length===0)throw Error('No tracks '+name);
 writeFileSync(path.join(root,'evidence',`apple-${name.toLowerCase().replaceAll(' ','-')}.browser.json`),JSON.stringify(raw,null,2)+'\n');
 report.push({name,url:link.url,count:raw.records.length});writeFileSync(path.join(root,'apple-report.json'),JSON.stringify(report,null,2)+'\n');
 console.log(name,raw.records.length);ab('wait','650');
}
