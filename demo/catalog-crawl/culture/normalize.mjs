import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => { let value=JSON.parse(readFileSync(join(root,'raw',name),'utf8')); return typeof value==='string'?JSON.parse(value):value; };
const specs = [
 {id:'apple-music',label:'Apple Music',homeUrl:'https://music.apple.com/',kind:'music',files:['apple-global','apple-korea'],note:'Public Apple Music chart DOM. Metadata and observed artwork URLs only; no audio copied. Chart positions describe the source chart, not personal preferences.'},
 {id:'youtube',label:'YouTube',homeUrl:'https://www.youtube.com/',kind:'youtube',files:['youtube-fireship','youtube-3blue1brown','youtube-freecodecamp','youtube-figma'],note:'Public video grids from Fireship, 3Blue1Brown, freeCodeCamp.org, and Figma. Bounded scrolling; metadata and observed thumbnail URLs only. No videos or transcripts copied. Relative age and view counts are observation-time display strings.'},
];
for(const spec of specs){
 const map=new Map(); const collections=[]; let checkedAt='';
 for(const file of spec.files){
  const raw=read(file+'.browser.json');
  const collectionId='culture-'+file;
  checkedAt=checkedAt>raw.fetchedAt?checkedAt:raw.fetchedAt;
  collections.push({id:collectionId,title:raw.collection,kind:spec.kind,description:`Browser-observed items from ${raw.sourceUrl}`});
  for(const r of raw.records){
   const attributes=Object.fromEntries(Object.entries(r.attributes||{}).filter(([,v])=>v!==undefined&&v!==null&&v!=='').map(([k,v])=>[k,typeof v==='boolean'?String(v):v]));
   if(typeof attributes.duration==='string' && /^\d+(?::\d{2}){1,2}$/.test(attributes.duration)){ attributes.durationSeconds=attributes.duration.split(':').reduce((total,part)=>total*60+Number(part),0); }
   if(attributes.chartPosition){attributes['chartPosition:'+raw.collection]=attributes.chartPosition;delete attributes.chartPosition;}
   const item={sourceId:spec.id,externalId:r.externalId,kind:spec.kind,collectionIds:[collectionId],title:r.title,url:r.canonicalUrl,creator:r.creator,description:spec.kind==='music'?`Album: ${r.attributes.album || 'Not listed'}. Duration: ${r.attributes.duration || 'Not listed'}.`:`${r.creator} video. Duration: ${r.attributes.duration||'Not listed'}.`,...(r.imageUrl?{imageUrl:r.imageUrl}:{}),observedAt:raw.fetchedAt,listingUrl:raw.sourceUrl,attributes,extraction:'browser-dom'};
   const old=map.get(item.externalId||item.url);
   if(old){old.collectionIds=Array.from(new Set([...old.collectionIds,...item.collectionIds]));Object.assign(old.attributes,item.attributes);if(!old.imageUrl&&item.imageUrl)old.imageUrl=item.imageUrl;}
   else map.set(item.externalId||item.url,item);
  }
 }
 const batch={source:{id:spec.id,label:spec.label,homeUrl:spec.homeUrl,kind:spec.kind,status:'collected',checkedAt,note:spec.note},collections,items:[...map.values()]};
 writeFileSync(join(root,spec.id+'.json'),JSON.stringify(batch,null,2)+'\n');
 console.log(spec.id,batch.items.length,'unique records;',batch.items.filter(i=>i.imageUrl).length,'observed image URLs');
}
for(const kind of ['instagram','pinterest']){
 const raw=read(kind+'-access.browser.json');
 const batch={source:{id:kind,label:kind==='instagram'?'Instagram':'Pinterest',homeUrl:`https://www.${kind}.com/`,kind,status:'blocked',checkedAt:raw.observedAt,note:kind==='instagram'?'The public @figma page displayed a signup/login overlay. Collection stopped at the access barrier; no guessed account records or private content were added.':'The public search page displayed a mandatory login dialog. Collection stopped at the access barrier; no hidden pin payloads or private content were extracted.'},collections:[],items:[]};
 writeFileSync(join(root,kind+'.json'),JSON.stringify(batch,null,2)+'\n');
}
