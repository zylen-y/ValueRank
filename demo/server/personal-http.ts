import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { config, demoRoot } from './config.ts';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService, PersonalError } from './personal-service.ts';
import { createPersonalSearchService } from './personal-search.ts';
import { createMediaService } from './personal-media.ts';
import { designStarterPack } from './personal-seeds.ts';
import { importPersonalDataset } from './personal-import.ts';
import { createCatalogStore } from './catalog-store.ts';
import { createCatalogService } from './catalog-service.ts';
import { createCatalogHttp } from './catalog-http.ts';
import { seedCatalog } from './catalog-seed.ts';
import type { Profile } from '../src/domain/types.ts';

type Send = (response: ServerResponse, status: number, data: unknown) => void;
type ReadBody = (request: IncomingMessage, maxBytes?: number) => Promise<unknown>;
const idSchema = z.string().min(1).max(180);

export function createPersonalHttp(dependencies: { profile: () => Profile; legacyBusy: () => boolean; json: Send; body: ReadBody }) {
  const personal = createPersonalService(createPersonalStore(process.env.VALUERANK_PERSONAL_DB_PATH || undefined));
  const search = createPersonalSearchService({ store: personal, configuration: config, profile: dependencies.profile });
  const media = createMediaService(personal, {path:process.env.VALUERANK_MEDIA_DB_PATH || undefined});
  search.recoverInterrupted();
  const seedMarker = process.env.VALUERANK_PERSONAL_DB_PATH ? `${process.env.VALUERANK_PERSONAL_DB_PATH}.seeded` : resolve(demoRoot, '.data/personal-seeded-v1');
  if (!existsSync(seedMarker) && !process.env.VALUERANK_SKIP_SEEDS) {
    if (!personal.datasets().some(dataset => dataset.id === 'interface-instincts-v1')) personal.createDataset(designStarterPack());
    mkdirSync(resolve(demoRoot, '.data'), {recursive:true}); writeFileSync(seedMarker, 'Original interface pack initialized. Deletion does not automatically recreate it.\n');
  }
  const migrationMarker = `${seedMarker}.knowledge-migrated`;
  if (!existsSync(migrationMarker) && !process.env.VALUERANK_SKIP_SEEDS) {
    for (const value of dependencies.profile().knownConcepts) personal.setFact({kind:'knowledge',domain:'content',value});
    mkdirSync(resolve(demoRoot,'.data'),{recursive:true});writeFileSync(migrationMarker,'Existing reading-profile knowledge copied once. Memory is the editable source for new searches.\n');
  }
  const active = () => search.isRunning() || media.isRunning();
  const requireIdle = () => { if (active() || dependencies.legacyBusy()) throw new PersonalError('Wait for the current operation or cancel it before starting another one.', 409); };
  const catalogStore = createCatalogStore(process.env.VALUERANK_CATALOG_DB_PATH || (process.env.VALUERANK_PERSONAL_DB_PATH ? `${process.env.VALUERANK_PERSONAL_DB_PATH}.catalog.sqlite` : undefined));
  if (!process.env.VALUERANK_SKIP_CATALOG_SEEDS) seedCatalog(catalogStore);
  const catalog = createCatalogService(catalogStore, personal);
  const handleCatalog = createCatalogHttp(catalog, { json: dependencies.json, body: dependencies.body, requireIdle });
  const sessionPayload = (id: string) => {
    const session = personal.getSession(idSchema.parse(id));
    if (!session) throw new PersonalError('Search session not found.',404);
    const dataset=personal.datasets().find(candidate=>candidate.context.id===session.context.id&&candidate.context.version===session.context.version&&candidate.itemRefs.length===session.units.length&&session.units.every(unit=>candidate.itemRefs.some(ref=>ref.id===unit.id&&ref.version===unit.version)));
    return {session,ranking:personal.rank(session.units,session.context),dataset};
  };
  const {json,body} = dependencies;
  return { personal, media, search, catalog, isRunning: active,
    async handle(request: IncomingMessage,response:ServerResponse,path:string):Promise<boolean> {
      if (await handleCatalog(request, response, path)) return true;
      if (!path.startsWith('/api/personal')) return false;
      const pieces = path.slice('/api/personal'.length).split('/').filter(Boolean).map(decodeURIComponent);
      const [resource,id,action] = pieces; const method=request.method;
      if (!resource && method==='GET') { json(response,200,personal.snapshot()); return true; }
      if (resource==='export' && method==='GET') {
        response.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="valuerank-personal-data.json"','Cache-Control':'no-store'});
        response.end(JSON.stringify({...personal.exportData(),media:media.exportData()},null,2)); return true;
      }
      if (resource==='data' && method==='DELETE') { requireIdle(); personal.deleteData(); media.deleteData(); json(response,200,personal.snapshot()); return true; }
      if (resource==='assets' && id && method==='GET') {
        const asset=media.asset(id); if(!asset) throw new PersonalError('Image not found.',404);
        response.writeHead(200,{'Content-Type':asset.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});response.end(Buffer.from(asset.bytes));return true;
      }
      if(resource==='images') {
        if(method==='GET') { json(response,200,id?{job:media.get(id)??null}:{jobs:media.jobs()});return true; }
        if(method==='POST' && !id) { const input=await body(request,12_000_000);requireIdle();json(response,202,{job:media.start(input)});return true; }
        if(method==='POST' && id && action==='cancel') {await body(request);json(response,200,{job:media.cancel(id)});return true;}
      }
      if(resource==='sessions') {
        if(method==='GET') {json(response,200,id?sessionPayload(id):{sessions:personal.listSessions()});return true;}
        if(method==='POST'&&!id) {const input=z.object({query:z.string().trim().min(1).max(500)}).strict().parse(await body(request));requireIdle();json(response,202,{session:search.start(input.query)});return true;}
        if(method==='DELETE'&&id) {requireIdle();json(response,200,personal.deleteSession(id));return true;}
        if(method==='POST'&&id) {
          if(action==='cancel') {await body(request);json(response,200,search.cancel(id));return true;}
          if(action==='retry') {await body(request);requireIdle();json(response,202,{session:search.retry(id)});return true;}
          if(action==='clarify') {const input=z.object({answers:z.record(z.string(),z.string().max(500)).default({}),useProfile:z.boolean().optional()}).strict().parse(await body(request));requireIdle();json(response,202,{session:search.continue(id,input.answers)});return true;}
          if(action==='refine') {const input=z.object({text:z.string().max(700).optional(),instruction:z.string().max(700).optional(),research:z.boolean().optional()}).strict().parse(await body(request));requireIdle();json(response,202,{session:search.refine(id,{instruction:input.instruction??input.text??'',research:input.research})});return true;}
          if(action==='answer') {const input=z.object({unitIds:z.array(z.string()).min(1).max(6)}).strict().parse(await body(request));requireIdle();json(response,202,{session:search.synthesize(id,input.unitIds)});return true;}
          if(action==='dataset') {
            await body(request);requireIdle(); const {session}=sessionPayload(id);
            const existing=personal.datasets().find(dataset=>dataset.context.id===id);
            const unchanged=existing && existing.context.version===session.context.version && existing.itemRefs.length===session.units.length && session.units.every(unit=>existing.itemRefs.some(ref=>ref.id===unit.id&&ref.version===unit.version));
            const dataset=unchanged?existing:personal.createDataset({id:existing?.id,title:session.query,description:'Independent information cards from your saved web exploration. These cards are already visible, so this collection is for learning, not an unseen-item test.',domain:'content',prompt:`Which information is more valuable to you for: ${session.query}?`,context:session.context,units:session.units,provenance:'Live web excerpts, grounded LLM cards, Jev semantic judgments.',evaluation:false});
            json(response,201,{dataset});return true;
          }
        }
      }
      if(resource==='datasets') {
        if(method==='GET') {const dataset=id?personal.datasets().find(item=>item.id===id):undefined;if(id&&!dataset)throw new PersonalError('Dataset not found.',404);json(response,200,id?{dataset,units:dataset!.itemRefs.map(ref=>personal.store.get('units',ref.id,ref.version))}:{datasets:personal.datasets()});return true;}
        if(method==='POST'&&!id) {const input=await body(request,2_000_000);requireIdle();json(response,201,{dataset:importPersonalDataset(personal,input)});return true;}
        if(method==='DELETE'&&id) {
          requireIdle();const versions=personal.store.all('datasets').filter(item=>item.id===id);
          const hashes=versions.flatMap(dataset=>dataset.itemRefs.map(ref=>personal.store.get('units',ref.id,ref.version)?.imageUrl?.match(/^\/api\/personal\/assets\/([a-f0-9]{64})$/)?.[1])).filter((hash):hash is string=>Boolean(hash));
          const snapshot=personal.deleteDataset(id);
          const retained=personal.store.all('units').map(unit=>unit.imageUrl?.match(/^\/api\/personal\/assets\/([a-f0-9]{64})$/)?.[1]).filter((hash):hash is string=>Boolean(hash));
          media.removeDataset(id,hashes,retained);json(response,200,snapshot);return true;
        }
      }
      if(resource==='pairs'&&method==='POST') {
        const input=z.object({datasetId:z.string(),mode:z.enum(['learn','test','tournament']).optional(),unitIds:z.tuple([z.string(),z.string()]).optional()}).strict().parse(await body(request));
        json(response,201,personal.startComparison(input));return true;
      }
      if(resource==='choices') {
        if(method==='POST'&&!id) {const input=z.object({exposureId:z.string(),choice:z.enum(['a','b','tie','neither','skip']),reason:z.string().max(2000).optional()}).strict().parse(await body(request));json(response,201,personal.answer(input));return true;}
        if(method==='DELETE'&&id) {json(response,200,personal.undo(id));return true;}
      }
      if(resource==='observations'&&method==='POST') {
        const input=z.object({unitId:z.string(),unitVersion:z.number().int().optional(),kind:z.enum(['open','save','dwell','known']),context:z.object({id:z.string(),version:z.number(),query:z.string(),goal:z.string(),answers:z.record(z.string(),z.string())}).optional(),durationMs:z.number().min(0).max(86_400_000).optional()}).strict().parse(await body(request));if(input.kind==='known')requireIdle();json(response,201,{observation:personal.observe(input)});return true;
      }
      if(resource==='facts') {
        if(method==='POST'&&!id) {const input=z.object({kind:z.enum(['knowledge','preference','value']),value:z.string().max(1000),domain:z.string().max(100).optional()}).strict().parse(await body(request));requireIdle();json(response,201,{fact:personal.setFact(input)});return true;}
        if(method==='PUT'&&id) {const input=z.object({value:z.string().max(1000),kind:z.enum(['knowledge','preference','value']).optional(),domain:z.string().max(100).optional()}).strict().parse(await body(request));requireIdle();const fact=personal.getFacts().find(item=>item.id===id);if(!fact)throw new PersonalError('Profile fact not found.',404);json(response,200,{fact:personal.setFact({id,kind:input.kind??fact.kind,domain:input.domain??fact.domain,value:input.value})});return true;}
        if(method==='DELETE'&&id) {requireIdle();json(response,200,personal.deleteFact(id));return true;}
      }
      throw new PersonalError('Unknown personal-engine endpoint.',404);
    },
  };
}
