import {execFile} from 'node:child_process';import {promisify}from'node:util';import {readFileSync,writeFileSync,existsSync}from'node:fs';import{resolve,dirname}from'node:path';import{createHash}from'node:crypto';
const exec=promisify(execFile),dir=dirname(new URL(import.meta.url).pathname),extract=readFileSync(resolve(dir,'commons-extract.js'),'utf8');
const artists=['IU_(singer)','Jennie_Kim','Jisoo','Kim_Tae-hyung','Jung_Kook','Park_Seo-joon','Kim_Soo-hyun','Song_Hye-kyo','Lee_Min-ho','Bae_Suzy','Han_So-hee','Cha_Eun-woo','Tom_Holland_(actor)','Zendaya','Emma_Watson','Timothée_Chalamet','Taylor_Swift','Ariana_Grande','Dua_Lipa','Billie_Eilish','Florence_Pugh','Margot_Robbie','Ryan_Gosling','Ryan_Reynolds','Anne_Hathaway','Emma_Stone'];
const report=[],selected=[],results=[];
async function browser(session,args,input){return (await exec('npx',['--yes','agent-browser','--session',session,...args],{encoding:'utf8',input,maxBuffer:15*1024*1024,timeout:60000})).stdout;}
// execFile's options do not accept stdin input, so pass the already-read DOM extractor as one literal CLI argument.
async function visit(url,session){const file=resolve(dir,'evidence','commons-'+createHash('sha256').update(url).digest('hex').slice(0,16)+'.json');if(existsSync(file))return JSON.parse(readFileSync(file,'utf8'));await browser(session,['open',url]);const page=JSON.parse(JSON.parse(await browser(session,['eval',extract])));writeFileSync(file,JSON.stringify(page,null,2)+'\n');return page;}
async function worker(session){while(artists.length){const artist=artists.shift(),url='https://commons.wikimedia.org/wiki/Category:'+encodeURIComponent(artist);try{const page=await visit(url,session);let files=[]; const categoryQueue=[{page,depth:0}], categorySeen=new Set();
 const photoFile=f=>f.url&&/\.(jpe?g|png|webp)$/i.test(decodeURIComponent(f.url))&&!/logo|signature|album|cover|poster|banner|flag|icon|meme|collage|woman_of|woman of/i.test(decodeURIComponent(f.url));
 for(let ci=0;ci<categoryQueue.length&&categorySeen.size<12&&files.length<24;ci++){
 const current=categoryQueue[ci]; const child=current.page||await visit(current.url,session); if(categorySeen.has(child.url))continue;categorySeen.add(child.url);
 files.push(...child.files.filter(photoFile).map(f=>({...f,childUrl:child.url})));
 if(current.depth<4){const score=label=>/portrait photographs/i.test(label)?100:/portrait/i.test(label)?90:/202[3-6]/.test(label)?80:/by year/.test(label)?70:/by decade/.test(label)?60:/2020s/.test(label)?55:/photographs/i.test(label)?50:/202[0-2]/.test(label)?40:0;
 const subs=child.subcategories.filter(s=>score(s.label)>0).sort((a,b)=>score(b.label)-score(a.label)||b.label.localeCompare(a.label)).slice(0,4); for(const sub of subs)categoryQueue.push({url:sub.url,depth:current.depth+1}); }
 }
 files.sort((a,b)=>{const year=x=>Math.max(...(decodeURIComponent(x.url).match(/20[012]\d/g)||['0']).map(Number));return year(b)-year(a)});
 // Gallery order is source order. Keep at most 12 distinct file pages per named public-figure category, never manufacture photo labels.
 const unique=[...new Map(files.filter(f=>f.url&&/\.(jpe?g|png|webp)$/i.test(decodeURIComponent(f.url))).map(f=>[f.url,f])).values()].slice(0,12);
 for(const f of unique){if(selected.some(x=>x.url===f.url))continue;selected.push({...f,category:page.title.split('\n')[0].replace(/^Category:/,''),listingUrl:f.childUrl||page.url});try{const detail=await visit(f.url,session);if(detail.imageUrl&&detail.licenseShort.length)results.push({...detail,listingUrl:f.childUrl||page.url,category:page.title.split('\n')[0].replace(/^Category:/,'')});}catch(error){report.push({url:f.url,error:error.message.slice(0,200)});}writeFileSync(resolve(dir,'commons-celebrities-v2-raw.json'),JSON.stringify(results,null,2)+'\n');}
 report.push({url,artist,listed:files.length,selected:unique.length,acceptedTotal:results.length});console.log(JSON.stringify(report.at(-1)));}catch(error){report.push({url,error:error.message.slice(0,200)});console.log(JSON.stringify(report.at(-1)));}writeFileSync(resolve(dir,'commons-celebrities-v2-report.json'),JSON.stringify({report,selected},null,2)+'\n');}}
await Promise.all(['expand-portraits-v2a','expand-portraits-v2b','expand-portraits-v2c'].map(worker));
for(const session of ['expand-portraits-v2a','expand-portraits-v2b','expand-portraits-v2c'])await browser(session,['close']);
