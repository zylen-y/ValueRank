import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CreatePersonalDataset, PersonalUnit } from '../src/domain/personal.ts';
import { demoRoot } from './config.ts';

export const DESIGN_FEATURES = ['lightTheme', 'warmPalette', 'colorIntensity', 'serifType', 'roundedCorners', 'visualDensity', 'heroScale', 'asymmetry', 'editorialLayout', 'accentArea', 'cardGrid', 'outlineDetail'];
const palettes = [
  { name: 'Chalk', bg: '#f5f4f0', ink: '#242620', accent: '#416b51', warm: .6, intensity: .25 },
  { name: 'Ink', bg: '#14171c', ink: '#f4f3ee', accent: '#b8c9ff', warm: .1, intensity: .45 },
  { name: 'Clay', bg: '#eee3d6', ink: '#352621', accent: '#b25232', warm: 1, intensity: .65 },
  { name: 'Cobalt', bg: '#f1f4ff', ink: '#102048', accent: '#315cef', warm: .05, intensity: .9 },
  { name: 'Citrus', bg: '#f0f3e6', ink: '#263223', accent: '#839d31', warm: .65, intensity: .7 },
  { name: 'Nightfall', bg: '#231c25', ink: '#f9edf2', accent: '#e5a3b8', warm: .8, intensity: .5 },
];
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

/** Original interface studies: the geometric parameters are known, not AI predictions. */
export function interfaceStudy(index: number) {
  const palette = palettes[index % palettes.length];
  const serif = Math.floor(index / 6) % 2 === 0;
  const round = Math.floor(index / 3) % 2 === 0;
  const dense = Math.floor(index / 12) % 2 === 1;
  const editorial = Math.floor(index / 2) % 2 === 0;
  const large = index % 3 !== 0;
  const asymmetry = index % 4 < 2;
  const accentArea = index % 5 < 2;
  const outlined = index % 3 === 1;
  const font = serif ? 'Georgia,serif' : 'Arial,sans-serif';
  const radius = round ? 20 : 2;
  const title = `${palette.name} / ${serif ? 'Editorial' : 'Modern'} ${String(index + 1).padStart(2, '0')}`;
  const featureValues = [index % 6 === 1 || index % 6 === 5 ? 0 : 1, palette.warm, palette.intensity, +serif, +round, dense ? .9 : .2, large ? 1 : .3, asymmetry ? .85 : .15, +editorial, accentArea ? .8 : .1, +!editorial, +outlined];
  const ink = palette.ink, accent = palette.accent;
  const text = (x: number, y: number, size: number, content: string, extra = '') => `<text x="${x}" y="${y}" fill="${ink}" font-family="${font}" font-size="${size}" ${extra}>${escape(content)}</text>`;
  const line = (x: number, y: number, w: number, opacity = .2) => `<rect x="${x}" y="${y}" width="${w}" height="5" rx="2.5" fill="${ink}" opacity="${opacity}"/>`;
  const abstract = (x: number, y: number, w: number, h: number) => `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${accent}" opacity=".16"/><circle cx="${x + w * .65}" cy="${y + h * .42}" r="${Math.min(w, h) * .32}" fill="${accent}"/><path d="M${x + w * .1} ${y + h * .8} L${x + w * .45} ${y + h * .2} L${x + w * .8} ${y + h * .8}Z" fill="${ink}" opacity=".8"/></g>`;
  let body = '';
  if (editorial) {
    body += text(42, 135, 10, 'SPACES FOR WHAT MATTERS', 'letter-spacing="2"');
    body += text(40, 198, large ? 53 : 40, 'Make room');
    body += text(40, 254, large ? 53 : 40, 'for the good.');
    body += line(42, 292, 205); body += line(42, 307, 167, .13);
    body += `<rect x="42" y="337" width="134" height="39" rx="${round ? 20 : 2}" fill="${accent}"/>${text(63, 362, 12, 'Explore collection')}`;
    body += abstract(asymmetry ? 327 : 350, 115, asymmetry ? 271 : 238, 282);
    body += `<path d="M42 433H598" stroke="${ink}" stroke-opacity=".17"/>`;
    body += text(42, 465, 11, 'Thoughtfully selected. Beautifully simple.');
    if (dense) for (let i = 0; i < 3; i++) { body += text(42 + i * 188, 505, 18, ['Ideas that last', 'A closer look', 'Find your rhythm'][i]); body += line(42 + i * 188, 525, 135); body += line(42 + i * 188, 540, 115, .13); }
  } else {
    const center = !asymmetry;
    body += text(center ? 320 : 42, 146, 10, 'A LITTLE MORE INTENTION', `${center ? 'text-anchor="middle"' : ''} letter-spacing="2"`);
    body += text(center ? 320 : 40, 203, large ? 45 : 34, 'Your next great thing.', center ? 'text-anchor="middle"' : '');
    body += text(center ? 320 : 42, 237, 13, 'A collection for curious minds.', center ? 'text-anchor="middle" opacity=".6"' : 'opacity=".6"');
    const count = dense ? 3 : 2, width = (556 - (count - 1) * 16) / count;
    for (let i = 0; i < count; i++) {
      const x = 42 + i * (width + 16);
      body += `<rect x="${x}" y="283" width="${width}" height="229" rx="${radius}" fill="${accentArea ? accent : ink}" fill-opacity="${accentArea ? .14 : .035}" stroke="${outlined ? ink : 'none'}" stroke-opacity=".2"/>`;
      body += abstract(x + 13, 297, width - 26, 135);
      body += text(x + 16, 463, 17, ['Find your focus', 'Better together', 'Keep exploring'][i]); body += line(x + 16, 481, width - 55, .17);
    }
  }
  return { title, features: featureValues, svg: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="580" viewBox="0 0 640 580"><rect width="640" height="580" fill="${palette.bg}"/><rect x="17" y="17" width="606" height="546" rx="${round ? 26 : 0}" fill="none" stroke="${ink}" stroke-opacity=".11"/>${text(42, 62, 21, serif ? 'forma.' : 'FORMA', 'font-weight="700"')}${text(404, 58, 10, 'COLLECTION')}${text(503, 58, 10, 'ABOUT')}<circle cx="588" cy="54" r="10" fill="${accent}"/>${body}</svg>` };
}

export function designStarterPack(): CreatePersonalDataset {
  const directory = resolve(demoRoot, 'public/arena'); mkdirSync(directory, { recursive: true });
  const createdAt = '2026-09-26T00:00:00.000Z';
  const units: PersonalUnit[] = Array.from({ length: 36 }, (_, index) => {
    const study = interfaceStudy(index); const id = `interface-study-${String(index + 1).padStart(2, '0')}`;
    writeFileSync(resolve(directory, `${id}.svg`), study.svg);
    return { id, version: 1, domain: 'interface-design', modality: 'image', kind: 'interface-study', title: study.title, body: 'An original interface study. Compare the typography, palette, shape, density, and layout that you would choose for your own product.', sourceIds: [], evidence: [], concepts: [], limitations: ['Authored interface study with known design parameters. No Jev or vision call produced these features.'], effortMinutes: 1, features: { schemaId: 'authored-interface-parameters-v1', names: [...DESIGN_FEATURES], values: study.features, encoder: 'original-svg-parameters-v1', model: 'authored', contextVersion: 1 }, prior: 0, createdAt, imageUrl: `/arena/${id}.svg`, entityId: id, rights: 'Original ValueRank interface study. CC0-1.0.' };
  });
  return { id: 'interface-instincts-v1', title: 'Interface instincts', description: '36 original interface studies. Teach your engine your visual taste, then test it on held-out designs. No API calls needed.', domain: 'interface-design', prompt: 'Which interface would you choose for a product you are building?', units, provenance: 'Original SVG studies by ValueRank, CC0-1.0. Features are known design parameters; choices are yours.' };
}
