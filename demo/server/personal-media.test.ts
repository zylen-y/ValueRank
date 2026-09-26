import { describe, expect, it } from 'vitest';
import { createMediaService, decodeRaster, imageImportSchema } from './personal-media.ts';
import { VISUAL_FEATURE_NAMES } from '../src/domain/personal-media.ts';
import { createPersonalStore } from './personal-store.ts';
import { createPersonalService } from './personal-service.ts';
import type { CreatePersonalDataset, PersonalDataset, PersonalSource, PersonalUnit } from '../src/domain/personal.ts';

function png(index = 0, width = 400) {
  const buffer = Buffer.alloc(28); Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer); buffer.write('IHDR', 12); buffer.writeUInt32BE(width, 16); buffer.writeUInt32BE(400, 20); buffer[27] = index;
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
const input = () => ({ name: 'Visual choices', domain: 'design', question: 'Which image do you prefer?', items: Array.from({length: 6}, (_, i) => ({title:`Image ${i}`, dataUrl:png(i)})) });
const finish = async (media: ReturnType<typeof createMediaService>) => { for (let i = 0; i < 100 && media.isRunning(); i++) await new Promise(resolve => setTimeout(resolve, 2)); expect(media.isRunning()).toBe(false); };

describe('image imports and visual feature provenance', () => {
  it('rejects active, oversized, mismatched, and duplicate raster inputs before encoding', () => {
    expect(() => decodeRaster('data:image/svg+xml;base64,PHN2Zy8+')).toThrow();
    expect(() => decodeRaster(png(0, 20000))).toThrow(/Resize/);
    expect(() => decodeRaster(png().replace('image/png', 'image/jpeg'))).toThrow(/JPEG/);
    expect(imageImportSchema.safeParse({...input(),items:input().items.slice(0,2)}).success).toBe(false);
    const media = createMediaService({saveSource(){},saveUnit(){},createDataset(){throw new Error('Unexpected');}}, {path:':memory:'});
    expect(() => media.start({...input(), items:input().items.map(x=>({...x,dataUrl:png()}))})).toThrow(/duplicate/); media.close();
  });
  it('persists actual vision features, caches by bytes and encoder, and exports assets', async () => {
    const sources: PersonalSource[] = []; const units: PersonalUnit[] = []; let calls = 0;
    const media = createMediaService({saveSource:s=>sources.push(s), saveUnit:u=>units.push(u), createDataset: (data: CreatePersonalDataset) => ({...data,id:'pack',version:1,createdAt:new Date().toISOString(),context:{id:'c',version:1,query:'',goal:data.prompt,answers:{}},itemRefs:[]} as PersonalDataset)}, {path:':memory:', encode: async () => { calls++; return { description:'Visible colorful geometric forms.', features:Object.fromEntries(VISUAL_FEATURE_NAMES.map(name=>[name,.5])) as Record<typeof VISUAL_FEATURE_NAMES[number],number>, model:'vision-test',tokens:100}; }});
    const job = media.start(input()); await finish(media);
    expect(media.get(job.id)?.status).toBe('completed'); expect(calls).toBe(6); expect(sources).toHaveLength(6); expect(units[0].features.encoder).toBe('gateway-vision-observations-v1'); expect(units[0].entityId).toMatch(/^asset-/); expect(units[0].features.values).toHaveLength(16);
    const cached = media.start(input()); await finish(media); expect(calls).toBe(6); expect(media.get(cached.id)?.tokens).toBe(0);
    const exported = media.exportData(); expect(exported.assets).toHaveLength(6); expect(exported.encodings).toHaveLength(6);
    expect(media.asset(exported.assets[0].hash)?.mime).toBe('image/png'); expect(media.asset('../secret')).toBeUndefined();
    media.deleteData(); expect(media.exportData().assets).toHaveLength(0); expect(media.jobs()).toHaveLength(0); media.close();
  });
  it('does not publish a partial dataset or persist provider errors containing secrets', async () => {
    let published = false;
    const media = createMediaService({saveSource(){}, saveUnit(){},createDataset(){published=true;throw new Error('Unexpected');}}, {path:':memory:', encode: async () => { throw Object.assign(new Error('secret request header: token-value'),{statusCode:402}); }});
    const job = media.start(input()); await finish(media);
    expect(media.get(job.id)?.status).toBe('failed'); expect(media.get(job.id)?.error).not.toContain('token-value'); expect(published).toBe(false); media.close();
  });
  it('connects uploaded assets to real source, dataset, comparison, and model storage', async () => {
    const store=createPersonalStore(':memory:');const personal=createPersonalService(store);
    let index=0;
    const media=createMediaService(personal,{path:':memory:',encode:async()=>({description:'An uploaded image with visible geometry.',features:Object.fromEntries(VISUAL_FEATURE_NAMES.map(name=>[name,(index++%5)/5])) as Record<typeof VISUAL_FEATURE_NAMES[number],number>,model:'test-vision',tokens:10})});
    const job=media.start(input());await finish(media);const done=media.get(job.id)!;
    expect(done.status).toBe('completed');expect(personal.datasets()[0].itemRefs).toHaveLength(6);
    const pair=personal.startComparison({datasetId:done.datasetId!,mode:'learn'});
    const response=personal.answer({exposureId:pair.exposure.id,choice:'a'});
    expect(response.modelVersion).toBe(1);expect(personal.snapshot().trainingCount).toBe(1);
    expect(personal.exportData().sources.every(source=>source.provenance==='upload')).toBe(true);
    personal.deleteData();media.deleteData();expect(personal.snapshot().datasets).toHaveLength(0);media.close();store.close();
  });
});
