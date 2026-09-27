import { z } from 'zod';

export type ResearchLanguage = 'en' | 'ko';

/** Generated UI choices must be labels, not serialized form state or executable snippets. */
export const plainChoiceSchema = z.string().trim().min(1).max(100).refine(value => {
  if (/[\r\n]|```|~~~/.test(value)) return false;
  if (/^[{]|[}]$|^\[\s*["'{[]/.test(value)) return false;
  if (/\b(?:id|label|value|question|options|selectedOptions|type|properties|required|additionalProperties)\s*:\s*["'{[]/i.test(value)) return false;
  if (/\bselectedOptions\s*(?::\s*)?\[/i.test(value)) return false;
  if (/=>|\b(?:const|let|var)\s+[\w$]+\s*=|\bfunction\s*[\w$]*\s*\(/.test(value)) return false;
  try { const parsed: unknown = JSON.parse(value); if (parsed !== null && typeof parsed === 'object') return false; }
  catch { /* An ordinary label is not JSON. */ }
  return true;
}, 'Use a plain readable option label, not serialized objects, arrays, or code.');

const proseOnly = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
const englishWords = (text: string) => text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
const ENGLISH_FUNCTION_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'what', 'how', 'why', 'which', 'with', 'for', 'to', 'of', 'is', 'are', 'can', 'should', 'would', 'your', 'you', 'that', 'this', 'it', 'in', 'on', 'as', 'from', 'be']);
const functionWordCount = (text: string) => englishWords(text).filter(word => ENGLISH_FUNCTION_WORDS.has(word)).length;

/** Resolve simple explicit output-language instructions before script heuristics. */
export function targetLanguage(query: string): ResearchLanguage {
  const text = proseOnly(query);
  const overrides: { index: number; language: ResearchLanguage }[] = [];
  const englishInstruction = /\b(?:answer|respond|reply|write|explain|summari[sz]e|output|return)(?:\s+(?:the|your|final|entire|whole|response|answer|result|prose|summary|brief|this|only))*\s+in\s+(English|Korean)\b/gi;
  for (const match of text.matchAll(englishInstruction)) {
    if (/\b(?:do not|don't|never|not)\s*$/i.test(text.slice(Math.max(0, match.index - 16), match.index))) continue;
    overrides.push({ index: match.index, language: match[1].toLowerCase() === 'korean' ? 'ko' : 'en' });
  }
  for (const match of text.matchAll(/(영어|영문|한국어|한글)(?:로|으로)\s*(?:만\s*)?(?:답변|답해|답하|응답|작성|설명|출력|써|말해|요약|정리)/g)) {
    overrides.push({ index: match.index, language: /^(영어|영문)$/.test(match[1]) ? 'en' : 'ko' });
  }
  if (overrides.length) return overrides.sort((a, b) => b.index - a.index)[0].language;
  const hangul = (text.match(/[\uac00-\ud7a3]/g) ?? []).length;
  if (!hangul) return 'en';
  // A Korean request can contain many English product names; they are not English prose.
  if (/(?:알려\s?줘|알려\s?주세요|설명해\s?줘|설명해\s?주세요|비교해\s?줘|비교해\s?주세요|정리해\s?줘|추천해\s?줘|답해\s?줘|해\s?주세요|해\s?줘)[.!?\s]*$/.test(text)) return 'ko';
  // Conversely, Korean proper names inside an English request do not switch its language.
  if (/^\s*(?:compare|explain|what|how|why|when|where|which|who|give|show|find|build|design|help|please|i|we)\b/i.test(text)) return 'en';
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  return functionWordCount(text) >= 3 && hangul < latin * 0.35 ? 'en' : 'ko';
}

/** Conservative mismatch guard for generated prose only. Do not apply to source quotations. */
export function languageAgreement(text: string, target: ResearchLanguage): boolean {
  const prose = proseOnly(text);
  const hangul = (prose.match(/[\uac00-\ud7a3]/g) ?? []).length;
  const latin = (prose.match(/[a-z]/gi) ?? []).length;
  if (target === 'en') return !(hangul >= 8 && hangul / Math.max(hangul + latin, 1) >= 0.3);
  // Uncertain short labels, technology names and code remain admissible.
  return !(englishWords(prose).length >= 8 && functionWordCount(prose) >= 2 && hangul / Math.max(hangul + latin, 1) < 0.08);
}

export function languageProseSchema(target: ResearchLanguage, min = 1, max = 2000) {
  return z.string().trim().min(min).max(max).refine(text => languageAgreement(text, target), `Write generated prose in ${target === 'ko' ? 'Korean' : 'English'}; preserve original source quotations separately.`);
}
