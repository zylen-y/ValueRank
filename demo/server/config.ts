import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

export const demoRoot = resolve(import.meta.dirname, '..');
export function config() {
  let local: Record<string, string | undefined> = {};
  try { local = parseEnv(readFileSync(resolve(demoRoot, '.env.local'), 'utf8')); } catch { /* optional local credentials */ }
  const value = (name: string) => local[name]?.trim() || process.env[name]?.trim() || '';
  return {
    gatewayKey: value('AI_GATEWAY_API_KEY'),
    typesafeKey: value('TYPESAFE_API_KEY'),
    llmModel: value('VALUERANK_LLM_MODEL') || 'openai/gpt-6-luna',
    jevModel: value('VALUERANK_JEV_MODEL') || 'jev-1.13.0',
  };
}
