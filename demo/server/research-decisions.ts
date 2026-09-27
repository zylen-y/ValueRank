import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ResearchDecision, ResearchDecisionBaseline, ResearchDecisionChanges, ResearchProject, ResearchSave } from '../src/domain/research.ts';
import type { ResearchStore } from './research-store.ts';
import { PersonalError } from './personal-service.ts';

const inputSchema = z.object({
  decision: z.string().trim().min(3).max(1000),
  nextAction: z.string().trim().min(3).max(700),
  revisitTrigger: z.string().trim().max(700).default(''),
  savedIds: z.array(z.string()).max(8).default([]),
}).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function baseline(saved: ResearchSave[]): ResearchDecisionBaseline[] {
  return saved.map(item => ({ savedId: item.id, title: item.unit.title, unitId: item.unit.id, unitVersion: item.unit.version, noteHash: hash(item.note), sources: item.sources.map(source => ({ id: source.id, version: source.version, url: source.url, textHash: hash(source.text) })) }));
}

export function decisionChanges(record: ResearchDecision, project: ResearchProject, saved: ResearchSave[]): ResearchDecisionChanges {
  const current = baseline(saved);
  const before = new Map(record.baseline.map(item => [item.savedId, item]));
  const now = new Map(current.map(item => [item.savedId, item]));
  const sourceHashes = new Map<string, Set<string>>();
  for (const source of record.baseline.flatMap(item => item.sources)) {
    const versions = sourceHashes.get(source.url) ?? new Set<string>(); versions.add(source.textHash); sourceHashes.set(source.url, versions);
  }
  const changed = new Set<string>(); const added = new Set<string>();
  for (const source of current.flatMap(item => item.sources)) {
    const versions = sourceHashes.get(source.url);
    if (!versions) added.add(source.url);
    else if (!versions.has(source.textHash)) changed.add(source.url);
  }
  return {
    decisionId: record.id,
    contextChanged: project.goal !== record.project.goal || project.constraints !== record.project.constraints,
    added: current.filter(item => !before.has(item.savedId)).map(item => ({ id: item.savedId, title: item.title })),
    removed: record.baseline.filter(item => !now.has(item.savedId)).map(item => ({ id: item.savedId, title: item.title })),
    notesChanged: current.filter(item => before.has(item.savedId) && before.get(item.savedId)!.noteHash !== item.noteHash).map(item => ({ id: item.savedId, title: item.title })),
    newSourceUrls: [...added], changedSourceUrls: [...changed],
  };
}

export function createDecisionJournal(store: ResearchStore, dependencies: { get: (id: string) => ResearchProject; saved: (id: string) => ResearchSave[]; now: () => string }) {
  function list(projectId: string) { return store.all('research_decisions').filter(item => item.projectId === projectId).reverse(); }
  function get(projectId: string, id: string) {
    dependencies.get(projectId);
    const record = store.get('research_decisions', id);
    if (!record || record.projectId !== projectId) throw new PersonalError('Decision record not found.', 404);
    return record;
  }
  function record(projectId: string, input: unknown) {
    const parsed = inputSchema.parse(input);
    if (new Set(parsed.savedIds).size !== parsed.savedIds.length) throw new PersonalError('Choose each supporting card once.', 400);
    return store.transaction(() => {
      const project = dependencies.get(projectId); const allSaved = dependencies.saved(projectId);
      const selected = parsed.savedIds.map(id => allSaved.find(item => item.id === id));
      if (selected.some(item => !item)) throw new PersonalError('A selected card is no longer in this project. Reload before recording the decision.', 409);
      const decision: ResearchDecision = {
        id: randomUUID(), projectId, author: 'user', decision: parsed.decision, nextAction: parsed.nextAction, revisitTrigger: parsed.revisitTrigger,
        project: structuredClone(project), evidence: structuredClone(selected as ResearchSave[]), baseline: baseline(allSaved), createdAt: dependencies.now(),
      };
      store.decision(decision); store.activity(projectId, decision.createdAt); return decision;
    });
  }
  function remove(projectId: string, id: string) { get(projectId, id); store.transaction(() => { store.remove('research_decisions', id); store.activity(projectId, dependencies.now()); }); }
  return { list, get, record, remove };
}

export function decisionMarkdown(record: ResearchDecision) {
  return [
    `# ${record.project.title} — my decision`,
    `Recorded by you on ${record.createdAt}. This is your decision and proposed next action, not AI verification or a training label.`,
    `## Decision\n\n${record.decision}`, `## Next action\n\n${record.nextAction}`,
    `## Revisit when\n\n${record.revisitTrigger || 'No trigger was recorded.'}`,
    `## Context at the time\n\nGoal: ${record.project.goal}\n\nConstraints: ${record.project.constraints || 'None recorded'}\n\nContext version: ${record.project.version}`,
    `## Supporting evidence snapshots\n\n${record.evidence.length ? record.evidence.map((item, index) => `### ${index + 1}. ${item.unit.title}\n\n${item.unit.body}\n\nCard limitations: ${item.unit.limitations.join('; ') || 'None recorded; completeness is not established.'}\n\n${item.unit.evidence.map(reference => {
      const source = item.sources.find(source => source.id === reference.sourceId && source.version === reference.sourceVersion);
      return `> ${reference.quote.replaceAll('\n', '\n> ')}\n\n[${source?.title ?? 'Saved source'}](${source?.url ?? ''})\n\nSource version: ${reference.sourceVersion} · Published: ${source?.publishedAt ?? 'Not recorded'} · Retrieved: ${source?.retrievedAt ?? 'Not recorded'} · Capture: ${source?.provenance ?? 'Unknown'}\n\nSource limitations: ${source?.limitations?.join('; ') || 'None recorded; completeness is not established.'}`;
    }).join('\n\n')}${item.note ? `\n\nYour note at the time: ${item.note}` : ''}`).join('\n\n') : 'No supporting cards were selected.'}`,
  ].join('\n\n') + '\n';
}
