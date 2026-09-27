import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname),evidence=path.join(root,'evidence');
const read=p=>{let r=JSON.parse(readFileSync(p,'utf8'));return typeof r==='string'?JSON.parse(r):r};
const files=readdirSync(evidence);
const clean=v=>Object.fromEntries(Object.entries(v).filter(([,x])=>x!==undefined&&x!==null&&x!==''));
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const specs=[
{id:'oliveyoung-global',label:'OLIVE YOUNG Global',homeUrl:'https://global.oliveyoung.com/',kind:'beauty',pattern:/^oliveyoung-\d+\.browser\.json$/,note:'Public global-store category lists across skincare, makeup, bath/body, hair, masks, sun care, tools and men’s care. Most Popular order and48items-per-page selected through visible controls; up to7pages per group. USD display prices and ranges are dated observations. This distinct global storefront is not the Korean domestic catalog.'},
{id:'musinsa',label:'MUSINSA',homeUrl:'https://www.musinsa.com/',kind:'fashion',pattern:/^musinsa-\d+\.browser\.json$/,note:'Public browser NEW ranking captures across10comparable category groups, all genders/all ages and realtime defaults. Sequential bounded scrolls, stopping at approximately700unique items or no-new-items. Real seller thumbnails and dated KRW display prices only; no checkout quote or full-marketplace coverage.'},
{id:'apple-music',label:'Apple Music',homeUrl:'https://music.apple.com/',kind:'music',pattern:/^apple-(?!country|chart).+\.browser\.json$/,note:'Browser-rendered tracks from30regional Daily Top100charts discovered through the public Apple Music chart directory. Metadata and observed artwork URLs only; no audio copied. Track identity is Apple song ID; overlap is deduplicated. Source chart positions are not personal preferences.'},
{id:'youtube',label:'YouTube',homeUrl:'https://www.youtube.com/',kind:'youtube',pattern:/^youtube-(?!.*first).*\.browser\.json$/,note:'Bounded public channel video grids across education, science, culture, cooking, architecture, language learning, consumer technology and startups. Actual DOM title, thumbnail, duration and observation-time view/age strings only. No video bytes or transcripts copied; not an exhaustive YouTube index.'}
];
const report=[];
for(const spec of specs){
 const map=new Map(),collections=new Map();let checkedAt='';
 for(const file of files.filter(f=>spec.pattern.test(f))){
  const raw=read(path.join(evidence,file));
  if(spec.kind==='fashion'||spec.kind==='beauty'){
   const collectionId=spec.id+'-'+raw.category;
   collections.set(collectionId,{id:collectionId,title:`${spec.label} · ${raw.name}`,kind:spec.kind,description:`Public ${spec.kind==='fashion'?'NEW ranking':'Most Popular'} ${raw.name.toLowerCase()} product cards observed in the browser. Compare products within this category. ${spec.kind==='fashion'?'KRW':'USD'} prices are capture-time display values.`});
   for(const original of raw.items){
    const item={...original};delete item.rawVisibleText;
    checkedAt=checkedAt>item.observedAt?checkedAt:item.observedAt;
    const old=map.get(item.externalId);if(old){item.collectionIds=[...new Set([...old.collectionIds,...item.collectionIds])];}
    map.set(item.externalId,item);
   }
  }else{
   if(!raw.records)continue;
   const collectionId='lifestyle-'+(spec.id==='apple-music'?'apple-'+slug(raw.collection.replace(/^Top 100: /,'')):file.replace(/^youtube-/,'youtube-').replace(/\.browser\.json$/,''));
   collections.set(collectionId,{id:collectionId,title:raw.collection,kind:spec.kind,description:spec.id==='apple-music'?`Daily chart tracks observed at ${raw.sourceUrl}. Public source chart order, not personal relevance.`:`${raw.topic||'Public channel'}: rendered video cards at ${raw.sourceUrl}. Bounded browser scrolling; source recency order, not a recommendation.`});
   checkedAt=checkedAt>raw.fetchedAt?checkedAt:raw.fetchedAt;
   for(const r of raw.records){
    const attributes=Object.fromEntries(Object.entries(clean(r.attributes||{})).map(([k,v])=>[k,typeof v==='boolean'?String(v):v]));
    if(typeof attributes.duration==='string'&&/^\d+(?::\d{2}){1,2}$/.test(attributes.duration))attributes.durationSeconds=attributes.duration.split(':').reduce((n,p)=>n*60+Number(p),0);
    if(attributes.chartPosition){attributes['chartPosition:'+raw.collection]=attributes.chartPosition;delete attributes.chartPosition;}
    if(raw.topic)attributes.topic=raw.topic;
    const item=clean({sourceId:spec.id,externalId:r.externalId,kind:spec.kind,collectionIds:[collectionId],title:r.title,url:r.canonicalUrl,creator:r.creator,description:spec.kind==='music'?`Album: ${r.attributes.album||'Not listed'}. Duration: ${r.attributes.duration||'Not listed'}.`:`${r.creator} video. Duration: ${r.attributes.duration||'Not listed'}.`,imageUrl:r.imageUrl,observedAt:raw.fetchedAt,listingUrl:raw.sourceUrl,attributes,extraction:'browser-dom'});
    const old=map.get(item.externalId||item.url);
    if(old){old.collectionIds=[...new Set([...old.collectionIds,...item.collectionIds])];Object.assign(old.attributes,item.attributes);if(!old.imageUrl&&item.imageUrl)old.imageUrl=item.imageUrl;}
    else map.set(item.externalId||item.url,item);
   }
  }
 }
 if(!map.size)continue;
 const source={...spec};delete source.pattern;source.checkedAt=checkedAt;source.status='collected';
 const batch={source,collections:[...collections.values()],items:[...map.values()]};
 const previousPath=path.resolve(root,'../../',(spec.kind==='fashion'||spec.kind==='beauty')?`shopping/${spec.id}.json`:`culture/${spec.id}.json`);
 const previous=read(previousPath),existing=new Set(previous.items.map(i=>i.externalId||i.url));
 for(const item of batch.items){if(!item.title||!item.url?.startsWith('https://')||item.collectionIds.length>30||Object.keys(item.attributes).length>50)throw Error('Invalid '+spec.id+' '+item.externalId);}
 writeFileSync(path.join(root,spec.id+'.json'),JSON.stringify(batch,null,2)+'\n');
 const summary={sourceId:spec.id,items:batch.items.length,newUnique:batch.items.filter(i=>!existing.has(i.externalId||i.url)).length,collections:batch.collections.length,imageUrls:batch.items.filter(i=>i.imageUrl).length};report.push(summary);console.log(summary);
}
writeFileSync(path.join(root,'normalized-report.json'),JSON.stringify(report,null,2)+'\n');
