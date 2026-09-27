import {readFileSync,writeFileSync,readdirSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const evidence=path.join(root,'evidence');
const raw=readdirSync(evidence).filter(f=>/-(outerwear|pants|shoes|skincare|makeup)-\d+\.json$/.test(f)).sort().map(f=>JSON.parse(readFileSync(path.join(evidence,f),'utf8')));
const categories={'002000':'Outerwear','003000':'Pants','103000':'Shoes','1000000008':'Skincare','1000000031':'Makeup'};
const sources=[
{id:'musinsa',label:'MUSINSA',homeUrl:'https://www.musinsa.com/',kind:'fashion',status:'collected',note:'Public NEW ranking snapshots, all genders/all ages, realtime filter. Three category groups. Listed best/discount prices can depend on coupons and variants; these are observed display prices, not checkout quotes. Collection is a bounded sample, not the entire marketplace.'},
{id:'oliveyoung-global',label:'OLIVE YOUNG Global',homeUrl:'https://global.oliveyoung.com/',kind:'beauty',status:'collected',note:'Public global-store Skincare/Makeup category pages, Most Popular order, USD display. This is the separate global storefront, not the Korean domestic catalog. Option ranges and ratings are preserved as displayed; some products span collections.'}
];
for(const source of sources){
  const map=new Map();
  for(const batch of raw){for(const original of batch.items){
    if(original.sourceId!==source.id)continue;
    const {rawVisibleText: _rawVisibleText,...item}=original;
    item.attributes.category=categories[item.attributes.categoryCode]||item.attributes.category;
    const key=item.externalId;
    const prev=map.get(key);
    if(prev){item.collectionIds=[...new Set([...prev.collectionIds,...item.collectionIds])];}
    map.set(key,item);
  }}
  const items=[...map.values()];
  const collectionIds=[...new Set(items.flatMap(i=>i.collectionIds))];
  const collections=collectionIds.map(id=>{const sample=items.find(i=>i.collectionIds.includes(id));const category=sample.attributes.category;
    return{id,title:`${source.label} · ${category}`,kind:source.kind,description:`${source.id==='musinsa'?'NEW ranking':'Most Popular'} ${category.toLowerCase()} products captured from the public ${source.label} browser listing; compare within this group. Observed prices are a dated snapshot.`};});
  source.checkedAt=items.map(i=>i.observedAt).sort().at(-1);
  for(const item of items){
    if(!item.title||!item.creator||!/^https:\/\//.test(item.url)||!/^https:\/\//.test(item.imageUrl||'')||!item.listingUrl||!item.observedAt)throw Error(`Invalid metadata ${item.externalId}`);
    if('price' in item.attributes && !Number.isFinite(item.attributes.price))throw Error(`Invalid price ${item.externalId}`);
  }
  const output={source,collections,items};
  writeFileSync(path.join(root,`${source.id}.json`),JSON.stringify(output,null,2)+'\n');
  console.log(source.id,items.length,collections.map(c=>`${c.id}: ${items.filter(i=>i.collectionIds.includes(c.id)).length}`).join(', '));
}
const blocked={source:{id:'oliveyoung-korea',label:'OLIVE YOUNG Korea',homeUrl:'https://www.oliveyoung.co.kr/',kind:'beauty',status:'blocked',checkedAt:statSync(path.join(evidence,'oliveyoung-access.png')).mtime.toISOString(),note:'The public ranking URL https://www.oliveyoung.co.kr/store/main/getBestList.do displayed a Cloudflare Verify you are human challenge in the browser. Collection stopped without solving or bypassing it. No domestic items were collected. The separately accessible global store has its own source ID and USD prices.'},collections:[],items:[]};
writeFileSync(path.join(root,'oliveyoung-korea.json'),JSON.stringify(blocked,null,2)+'\n');
