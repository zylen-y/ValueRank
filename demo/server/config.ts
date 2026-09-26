import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

export const demoRoot = resolve(import.meta.dirname, '..');
export function resolveConfig(local: Record<string, string | undefined>, environment: Record<string, string | undefined>) {
  const value = (name: string) => local[name]?.trim() || environment[name]?.trim() || '';
  const provider = value('VALUERANK_JEV_PROVIDER') || 'auto';
  if (!['auto', 'openrouter', 'typesafe'].includes(provider)) throw new Error('VALUERANK_JEV_PROVIDER must be auto, openrouter, or typesafe.');
  const jevProvider: 'typesafe' | 'openrouter' = provider === 'openrouter' || (provider === 'auto' && value('OPENROUTER_API_KEY')) ? 'openrouter' : 'typesafe';
  return {
    gatewayKey: value('AI_GATEWAY_API_KEY'),
    jevProvider,
    jevKey: value(jevProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'),
    llmModel: value('VALUERANK_LLM_MODEL') || 'xiaomi/mimo-v2.6-flash',
    jevModel: jevProvider === 'openrouter'
      ? value('VALUERANK_OPENROUTER_JEV_MODEL') || 'typesafe/jev-1.13'
      : value('VALUERANK_JEV_MODEL') || 'jev-1.13.0',
  };
}
export function config() {
  let local: Record<string, string | undefined> = {};
  try { local = parseEnv(readFileSync(resolve(demoRoot, '.env.local'), 'utf8')); } catch { /* optional local credentials */ }
  return resolveConfig(local, process.env);
}
