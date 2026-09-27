import { describe, expect, it } from 'vitest';
import { languageAgreement, languageProseSchema, plainChoiceSchema, targetLanguage } from './research-quality.ts';

describe('plain clarification choices', () => {
  it.each([
    "{id: 'explicit', label: 'Explicit user profile (e.g., native language, target level)', value: 'User-",
    'selectedOptions []}',
    "{id: 'mem0', label: 'Mem0 (vector-based, drop-in API, implicit consolidation)', value: 'Mem0",
    '["Mem0", "Letta"]', '[{id: "local"', '{"label":"Local"}', '[]',
    'label: "Local"', 'const answer = "local"', '() => "local"', '```json', 'A\nB',
  ])('rejects malformed label %s', value => {
    expect(plainChoiceSchema.safeParse(value).success).toBe(false);
  });
  it.each(['Mem0 (local)', 'RAG + SQLite', 'C++ / C#', '$20 max', 'No', 'React 19 / Next.js 16', 'S3 (JSON files)', 'Prefer Markdown over JSON', '한국어 콘텐츠', '`Postgres`', 'true'])('preserves readable technical choice %s', value => {
    expect(plainChoiceSchema.parse(`  ${value}  `)).toBe(value);
  });
});

describe('stable query output language', () => {
  it.each([
    ['I know React and basic RAG. Compare local memory frameworks for a two-day prototype.', 'en'],
    ['Compare 네이버 and 카카오 for an English-language web app.', 'en'],
    ['Explain Korean grammar for beginners. Use Korean sources.', 'en'],
    ['React, Vercel AI Gateway, OpenRouter를 사용해서 로컬 데모를 만드는 방법을 알려줘.', 'ko'],
    ['React와 Next.js의 차이점을 비교해줘. Please answer in English.', 'en'],
    ['한국어로 답변해줘. Compare local agent memory frameworks.', 'ko'],
    ['Answer in Korean. Actually, respond in English.', 'en'],
    ["Don't answer in Korean; answer in English.", 'en'],
    ['한국어 내용을 영어로 작성해줘.', 'en'],
    ['Show an article titled `Answer in Korean`.', 'en'],
    ['RAG와 SQLite, Mem0의 장점과 단점', 'ko'],
  ] as const)('resolves %s', (query, language) => {
    expect(targetLanguage(query)).toBe(language);
  });
  it('rejects the observed Korean R01 prose for the frozen English query', () => {
    expect(languageAgreement('AgentMemory의 로컬 우선 아키텍처 및 기능', 'en')).toBe(false);
    expect(languageAgreement('AgentMemory는 세션 간 연속성, 지속 가능한 선호도 저장, 로컬/오프라인 친화적 에이전트 런타임에 적합합니다.', 'en')).toBe(false);
  });
  it('flags substantial English drift but preserves names and mixed technical Korean', () => {
    expect(languageAgreement('This framework provides a local memory store for your application and can be configured with a separate database.', 'ko')).toBe(false);
    expect(languageAgreement('React / Next.js / Mem0', 'ko')).toBe(true);
    expect(languageAgreement('React와 Next.js를 사용하면 로컬 SQLite 프로필을 만들어 기억을 관리할 수 있습니다.', 'ko')).toBe(true);
    expect(languageAgreement('Compare 네이버 and 카카오 for a local web application.', 'en')).toBe(true);
  });
  it('keeps code outside the prose heuristic and applies the wrapper only to prose strings', () => {
    expect(languageAgreement('한국어 설명입니다.\n```ts\nconst longEnglishExplanation = "This is a long code example with several words inside a literal";\n```', 'ko')).toBe(true);
    expect(languageProseSchema('ko').safeParse({ quote: 'Original source text' }).success).toBe(false);
    expect(languageProseSchema('ko', 5, 200).parse('기존 문서를 확인하세요.')).toBe('기존 문서를 확인하세요.');
    expect(languageProseSchema('ko').safeParse('This framework provides a local memory store for your application and can be configured with a separate database.').success).toBe(false);
  });
});
