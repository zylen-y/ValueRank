import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PersonalSearchSession } from '../src/domain/personal.ts';
import type { ResearchBriefContent } from '../src/domain/research.ts';
import { createResearchStore } from './research-store.ts';
import { createResearchService, researchBriefMarkdown } from './research-service.ts';
import { buildBriefSupportReview } from './research-brief-support.ts';
import { decisionMarkdown } from './research-decisions.ts';

const at = '2026-09-27T12:00:00.000Z';
const fixture = (): PersonalSearchSession => ({ id: 'session', query: 'Agent memory', status: 'completed', createdAt: at, updatedAt: at, context: { id: 'session', version: 1, query: 'Agent memory', goal: 'Choose a local memory store', answers: {} }, questions: [], answers: {}, sources: [{ id: 'source', version: 1, title: 'Source title', text: 'Exact retrieved text describing the option.', url: 'https://example.org/docs', publisher: 'example.org', retrievedAt: at, provenance: 'page-extraction' }], units: [{ id: 'card', version: 1, domain: 'content', modality: 'text', kind: 'tradeoff', title: 'A storage tradeoff', body: 'A source-backed information card describing an option.', sourceIds: ['source'], evidence: [{ sourceId: 'source', sourceVersion: 1, quote: 'Exact retrieved text describing the option.' }], concepts: ['memory'], limitations: ['Only one source.'], effortMinutes: 1, features: { schemaId: 'test', names: ['relevance'], values: [0.5], encoder: 'test', model: 'test', contextVersion: 1 }, prior: 0, createdAt: at }], events: [], answer: '', round: 1 });
const content = (id: string): ResearchBriefContent => ({ recommendation: { text: 'Consider this option conditionally.', evidenceIds: [id] }, reasons: [{ text: 'The supplied passage describes the option.', evidenceIds: [id] }], alternatives: [], tradeoffs: [], openQuestions: ['What does a competing source show?'], nextSteps: ['Run a small local comparison before committing.'] });
const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); cleanups.splice(0).reverse().forEach(cleanup => cleanup()); });
function setup(now?: () => number) {
  const store = createResearchStore(':memory:'); cleanups.push(() => store.close());
  const session = fixture();
  const generate = vi.fn();
  const verify = vi.fn().mockResolvedValue({ support: 0.91, model: 'mock-jev', tokens: 10 });
  const service = createResearchService(store, { getSession: id => id === session.id ? session : undefined, configuration: () => ({ gatewayKey: 'not-a-live-key', llmModel: 'fixture' }), generate, verify, now });
  const project = service.create({ title: 'Memory decision', goal: 'Choose memory for a language app', constraints: 'Two days' });
  const save = () => service.save(project.id, { sessionId: session.id, unitId: 'card', unitVersion: 1 });
  return { store, service, session, project, save, generate, verify };
}

describe('user decision journal and return visits', () => {
  it('freezes chosen support but compares return visits against the entire prior shortlist', () => {
    const { service, session, project, save, generate, verify } = setup();
    const chosen = save();
    session.units.push({ ...structuredClone(session.units[0]), id: 'unselected-card', title: 'An already available alternative' });
    const unselected = service.save(project.id, { sessionId: session.id, unitId: 'unselected-card', unitVersion: 1 });
    const record = service.decisions.record(project.id, { decision: 'Start with explicit records.', nextAction: 'Build a local comparison.', revisitTrigger: 'Revisit after observing repeated retrieval failures.', savedIds: [chosen.id] });
    expect(record.evidence).toHaveLength(1); expect(record.baseline).toHaveLength(2);
    expect(service.detail(project.id).decisionChanges).toMatchObject({ added: [], removed: [], contextChanged: false, newSourceUrls: [] });
    service.note(project.id, chosen.id, 'A later thought.');
    service.reorder(project.id, [unselected.id, chosen.id]);
    service.update(project.id, { title: 'Only a title change', goal: project.goal, constraints: project.constraints });
    expect(service.detail(project.id).decisionChanges).toMatchObject({ added: [], removed: [], contextChanged: false, notesChanged: [{ id: chosen.id }] });
    expect(service.decisions.get(project.id, record.id).evidence[0].note).toBe('');
    service.removeSave(project.id, unselected.id);
    session.units.push({ ...structuredClone(session.units[0]), id: 'new-card', title: 'A newly saved reading' });
    const added = service.save(project.id, { sessionId: session.id, unitId: 'new-card', unitVersion: 1 });
    service.update(project.id, { title: project.title, goal: 'Handle multiple organizations', constraints: 'Keep evidence inspectable' });
    expect(service.detail(project.id).decisionChanges).toMatchObject({ contextChanged: true, added: [{ id: added.id }], removed: [{ id: unselected.id }], newSourceUrls: [], changedSourceUrls: [] });
    expect(service.decisions.get(project.id, record.id).project.goal).toBe(project.goal);
    expect(generate).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });

  it('distinguishes newly captured identical text from changed source content', () => {
    const { service, session, project, save } = setup(); const initial = save();
    service.decisions.record(project.id, { decision: 'Keep a local baseline.', nextAction: 'Measure retrieval outcomes.', savedIds: [initial.id] });
    const source = session.sources[0]; const unit = session.units[0];
    const addCapture = (id: string, text: string) => {
      session.sources.push({ ...source, id, text, retrievedAt: '2026-09-28T00:00:00.000Z' });
      session.units.push({ ...structuredClone(unit), id: `${id}-card`, sourceIds: [id], evidence: [{ sourceId: id, sourceVersion: 1, quote: source.text }] });
      service.save(project.id, { sessionId: session.id, unitId: `${id}-card`, unitVersion: 1 });
    };
    addCapture('same-text-new-capture', source.text);
    expect(service.detail(project.id).decisionChanges).toMatchObject({ newSourceUrls: [], changedSourceUrls: [] });
    addCapture('changed-text', `${source.text} A newly documented limitation.`);
    expect(service.detail(project.id).decisionChanges).toMatchObject({ newSourceUrls: [], changedSourceUrls: [source.url] });
  });

  it('rejects cross-project or repeated support and rolls back the record when activity persistence fails', () => {
    const { service, store, project, save } = setup(); const saved = save();
    const other = service.create({ title: 'Other project', goal: 'Unrelated local decision' });
    const input = { decision: 'Use explicit records.', nextAction: 'Build the smallest trial.', savedIds: [saved.id] };
    expect(() => service.decisions.record(other.id, input)).toThrow('no longer in this project');
    expect(() => service.decisions.record(project.id, { ...input, savedIds: [saved.id, saved.id] })).toThrow('once');
    vi.spyOn(store, 'activity').mockImplementation(() => { throw new Error('write failed'); });
    expect(() => service.decisions.record(project.id, input)).toThrow('write failed');
    expect(store.all('research_decisions')).toHaveLength(0);
  });

  it('persists explicit records through reopen, exports frozen support, and deletes only the requested project record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'valuerank-decision-reopen-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'research.sqlite'); let store = createResearchStore(path); cleanups.push(() => store.close());
    const session = fixture(); const deps = { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: '' }) };
    let service = createResearchService(store, deps);
    const project = service.create({ title: 'My local call', goal: 'Choose a memory baseline' });
    const saved = service.save(project.id, { sessionId: session.id, unitId: 'card', unitVersion: 1 });
    const first = service.decisions.record(project.id, { decision: 'Try explicit profiles first.', nextAction: 'Run a small comparison.', savedIds: [saved.id] });
    const second = service.decisions.record(project.id, { decision: 'Keep evaluating the baseline.', nextAction: 'Inspect another source.' });
    store.close(); store = createResearchStore(path); service = createResearchService(store, deps);
    expect(service.detail(project.id).decisions.map(item => item.id)).toEqual([second.id, first.id]);
    const markdown = decisionMarkdown(service.decisions.get(project.id, first.id));
    expect(markdown).toContain('not AI verification or a training label'); expect(markdown).toContain(session.sources[0].url); expect(markdown).toContain(session.units[0].evidence[0].quote); expect(markdown).toContain('Only one source.');
    const other = service.create({ title: 'Other', goal: 'Unrelated decision' });
    expect(() => service.decisions.remove(other.id, first.id)).toThrow('not found');
    service.decisions.remove(project.id, second.id);
    expect(service.detail(project.id).decisionChanges?.decisionId).toBe(first.id);
    expect(service.exportData().decisions).toHaveLength(1);
    service.remove(project.id); expect(store.all('research_decisions')).toHaveLength(0);
  });
});

describe('durable research workspace', () => {
  it('records durable research activity without changing context versions or dates', async () => {
    let clock = Date.parse(at);
    const { service, store, session, project, save, generate } = setup(() => clock);
    const tick = () => { clock += 1000; return new Date(clock).toISOString(); };
    tick(); const other = service.create({ title: 'More recent context', goal: 'An unrelated project' });
    expect(service.list()[0].id).toBe(other.id);
    let expected = tick(); service.link(project.id, session.id);
    expect(service.get(project.id)).toMatchObject({ version: 1, updatedAt: at, lastActivityAt: expected });
    expected = tick(); const item = save();
    expect(service.list()[0]).toMatchObject({ id: project.id, lastActivityAt: expected });
    expected = tick(); service.note(project.id, item.id, 'Record a local decision.');
    expect(service.detail(project.id).project.lastActivityAt).toBe(expected);
    expected = tick(); service.reorder(project.id, [item.id]);
    expect(service.get(project.id).lastActivityAt).toBe(expected);
    expected = tick();
    generate.mockImplementation(async () => { expected = tick(); return { value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 }; });
    service.startBrief(project.id); await service.waitForIdle();
    expect(service.get(project.id)).toMatchObject({ version: 1, updatedAt: at, lastActivityAt: expected });
    expect(service.detail(project.id).briefs[0].project).toMatchObject({ version: 1, updatedAt: at });
    expected = tick(); service.removeSave(project.id, item.id);
    expect(store.get('research_projects', project.id)?.lastActivityAt).toBe(expected);
    const reopenedService = createResearchService(store, { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: '' }) });
    expect(reopenedService.get(project.id).lastActivityAt).toBe(expected);
    const editedAt = tick(); service.update(project.id, { title: 'Edited', goal: 'A revised goal' });
    expect(service.get(project.id)).toMatchObject({ version: 2, updatedAt: editedAt, lastActivityAt: editedAt });
  });
  it('keeps activity updates atomic and reads legacy projects without a write migration', () => {
    let clock = Date.parse(at);
    const { service, store, project, save } = setup(() => clock);
    const legacy = { ...project }; delete (legacy as { lastActivityAt?: string }).lastActivityAt; store.project(legacy);
    expect(service.get(project.id).lastActivityAt).toBe(at);
    expect(store.get('research_projects', project.id)?.lastActivityAt).toBeUndefined();
    clock += 1000;
    vi.spyOn(store, 'activity').mockImplementation(() => { throw new Error('activity write failed'); });
    expect(save).toThrow('activity write failed');
    expect(service.detail(project.id).saved).toHaveLength(0);
    expect(service.get(project.id)).toMatchObject({ version: 1, lastActivityAt: at });
  });
  it('saves a card once with immutable evidence snapshots and keeps notes editable', () => {
    const { service, session, project, save } = setup();
    const item = save(); expect(save().id).toBe(item.id);
    session.units[0].body = 'Later replacement'; session.sources[0].text = 'Changed upstream';
    service.note(project.id, item.id, 'Try this on a small workload.');
    const saved = service.detail(project.id).saved;
    expect(saved).toHaveLength(1); expect(saved[0].unit.body).toContain('source-backed'); expect(saved[0].sources[0].text).toContain('Exact retrieved'); expect(saved[0].note).toContain('small workload');
  });
  it('rejects missing versions, unsupported evidence and cross-project mutations', () => {
    const { service, session, project, save } = setup(); const item = save();
    expect(() => service.save(project.id, { sessionId: session.id, unitId: 'card', unitVersion: 2 })).toThrow('Reload');
    const other = service.create({ title: 'Other', goal: 'A different decision' });
    expect(() => service.note(other.id, item.id, 'No')).toThrow('not found');
    expect(() => service.removeSave(other.id, item.id)).toThrow('not found');
    session.units[0].id = 'bad'; session.units[0].evidence[0].quote = 'Fabricated quotation';
    expect(() => service.save(project.id, { sessionId: session.id, unitId: 'bad', unitVersion: 1 })).toThrow('inspectable');
  });
  it('persists projects and shortlist across database reopen; deletion clears dependent snapshots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'valuerank-research-')); cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'research.sqlite'); const first = createResearchStore(path); const session = fixture();
    const a = createResearchService(first, { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: '' }) });
    const project = a.create({ title: 'Persistent', goal: 'Persist the shortlist' }); a.link(project.id, session.id); a.save(project.id, { sessionId: session.id, unitId: 'card', unitVersion: 1 }); first.close();
    const second = createResearchStore(path); cleanups.push(() => second.close());
    const b = createResearchService(second, { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: '' }) });
    expect(b.detail(project.id).saved).toHaveLength(1); expect(b.detail(project.id).sessionIds).toEqual(['session']);
    b.clear(); expect(b.exportData()).toEqual({ projects: [], saved: [], briefs: [], decisions: [], sessions: [] });
  });
  it('keeps project learning scope stable through editable goal revisions', () => {
    const { service, project, session } = setup(); session.context.scopeId = project.id; service.link(project.id, session.id);
    const revised = service.update(project.id, { title: 'Refined', goal: 'Prefer a local store now', constraints: '' });
    expect(revised.id).toBe(project.id); expect(revised.version).toBe(2); expect(service.projectForSession(session.id)).toBe(project.id);
    const other = service.create({ title: 'Other', goal: 'Something unrelated' }); expect(() => service.link(other.id, session.id)).toThrow('another project');
  });
  it('rejects saving from another scoped or linked project while preserving unscoped legacy saves', () => {
    const { service, project, session } = setup();
    const other = service.create({ title: 'Other', goal: 'A separate decision' });
    session.context.scopeId = project.id;
    expect(() => service.save(other.id, { sessionId: session.id, unitId: 'card', unitVersion: 1 })).toThrow('another project');
    delete session.context.scopeId;
    service.link(project.id, session.id);
    expect(() => service.save(other.id, { sessionId: session.id, unitId: 'card', unitVersion: 1 })).toThrow('another project');
    service.store.unlink(session.id);
    const legacy = service.save(other.id, { sessionId: session.id, unitId: 'card', unitVersion: 1 });
    expect(legacy.context.scopeId).toBeUndefined(); expect(legacy.projectId).toBe(other.id);
  });
  it('accepts existing whitespace-normalized evidence without changing the stored snapshots', () => {
    const { service, session, project, save } = setup();
    session.sources[0].text = 'Exact retrieved\n\ntext describing   the option.';
    const saved = save();
    expect(saved.unit.evidence[0].quote).toBe('Exact retrieved text describing the option.');
    expect(saved.sources[0].text).toBe(session.sources[0].text);
    expect(service.detail(project.id).saved).toHaveLength(1);
  });
  it('appends new saves after the surviving order when leading cards were removed', () => {
    const { service, session, project } = setup();
    const prototype = session.units[0];
    session.units = Array.from({ length: 6 }, (_, index) => ({ ...structuredClone(prototype), id: `card-${index}` }));
    const saved = session.units.slice(0, 5).map(unit => service.save(project.id, { sessionId: session.id, unitId: unit.id, unitVersion: 1 }));
    saved.slice(0, 3).forEach(item => service.removeSave(project.id, item.id));
    service.save(project.id, { sessionId: session.id, unitId: 'card-5', unitVersion: 1 });
    expect(service.detail(project.id).saved.map(item => item.unit.id)).toEqual(['card-3', 'card-4', 'card-5']);
  });
});

describe('decision brief generation', () => {
  it('constrains short input labels and resolves them strictly to immutable save IDs across replay', async () => {
    const { service, store, project, session, save, generate } = setup(); const first = save();
    session.units.push({ ...structuredClone(session.units[0]), id: 'card-two', title: 'A second option' });
    const second = service.save(project.id, { sessionId: session.id, unitId: 'card-two', unitVersion: 1 });
    const candidate = { ...content('E1'), reasons: [{ text: 'The second supplied passage gives a useful comparison.', evidenceIds: ['E2', 'E1'] }], alternatives: [{ title: 'The other saved option', assessment: { text: 'This alternative is represented in the supplied evidence.', evidenceIds: ['E2'] } }], tradeoffs: [{ text: 'The two supplied passages imply a limited comparison.', evidenceIds: ['E1', 'E2'] }] };
    generate.mockImplementation(async (schema, _instructions, input) => {
      expect(input.evidence.map((item: { evidenceId: string }) => item.evidenceId)).toEqual(['E1', 'E2']);
      expect(input.evidence[0]).toMatchObject({ evidenceId: 'E1', title: second.unit.title });
      expect(input.evidence.every((item: object) => !Object.hasOwn(item, 'id'))).toBe(true);
      expect(schema.safeParse(candidate).success).toBe(true);
      expect(schema.safeParse(content('E3')).success).toBe(false);
      expect(schema.safeParse(content(first.id)).success).toBe(false);
      return { value: candidate, model: 'fixture', tokens: 10, durationMs: 1 };
    });
    const started = service.startBrief(project.id, [second.id, first.id]); await service.waitForIdle();
    const stored = store.get('research_briefs', started.id)!;
    expect(stored.status).toBe('completed');
    expect(stored.content?.recommendation.evidenceIds).toEqual([second.id]);
    expect(stored.content?.reasons[0].evidenceIds).toEqual([first.id, second.id]);
    expect(stored.content?.alternatives[0].assessment.evidenceIds).toEqual([first.id]);
    expect(stored.content?.tradeoffs[0].evidenceIds).toEqual([second.id, first.id]);
    const replay = createResearchService(store, { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: '' }), generate });
    replay.recoverInterrupted();
    const replayed = replay.detail(project.id).briefs[0];
    expect(replayed.content).toEqual(stored.content); expect(generate).toHaveBeenCalledTimes(1);
    expect(researchBriefMarkdown(replayed)).toContain('Consider this option conditionally. [1]');
    expect(researchBriefMarkdown(replayed)).toContain('The second supplied passage gives a useful comparison. [2] [1]');
  });
  it.each(['E0', 'E2', 'e1', 'E1 ', '1', 'A storage tradeoff'])('rejects unknown or approximate generated citation %s without fuzzy recovery', async invalid => {
    const { service, project, save, generate } = setup(); save();
    generate.mockResolvedValue({ value: content(invalid), model: 'fixture', tokens: 10, durationMs: 1 });
    service.startBrief(project.id); await service.waitForIdle();
    expect(service.detail(project.id).briefs[0]).toMatchObject({ status: 'failed', tokens: 10 });
    expect(service.detail(project.id).briefs[0].content).toBeUndefined();
    expect(service.detail(project.id).briefs[0].error).toContain('outside your saved selection');
  });
  it('retains historical UUID citations and rejects a generated UUID even if it belongs to the selection', async () => {
    const { service, store, project, save, generate } = setup(); const item = save();
    store.brief({ id: 'historical', projectId: project.id, project, evidence: [item], status: 'completed', content: content(item.id), model: 'fixture', createdAt: at, completedAt: at });
    expect(researchBriefMarkdown(service.detail(project.id).briefs[0])).toContain('Consider this option conditionally. [1]');
    expect(researchBriefMarkdown(service.detail(project.id).briefs[0])).toContain('created before source-support checks');
    generate.mockResolvedValue({ value: content(item.id), model: 'fixture', tokens: 10, durationMs: 1 });
    service.startBrief(project.id); await service.waitForIdle();
    expect(service.detail(project.id).briefs[0].status).toBe('failed');
    expect(store.get('research_briefs', 'historical')?.content).toEqual(content(item.id));
  });
  it('exports frozen context and evidence limitations with distinct publication, retrieval and excerpt provenance', async () => {
    const { service, project, session, save, generate } = setup();
    session.sources[0].publishedAt = '2026-08-01'; session.sources[0].provenance = 'search-excerpt'; session.sources[0].limitations = ['Excerpt omits the implementation details.'];
    const item = save(); service.note(project.id, item.id, 'This fits my initial hypothesis.');
    generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    service.startBrief(project.id); await service.waitForIdle();
    service.update(project.id, { title: 'New title', goal: 'A later goal', constraints: 'A later constraint' });
    session.sources[0].publishedAt = '2099-01-01'; session.units[0].limitations = [];
    const markdown = researchBriefMarkdown(service.detail(project.id).briefs[0]);
    expect(markdown).toContain('Context version: 1'); expect(markdown).toContain('Constraints: Two days');
    expect(markdown).not.toContain('A later constraint'); expect(markdown).not.toContain('2099');
    expect(markdown).toContain('Only one source.'); expect(markdown).toContain('Excerpt omits the implementation details.');
    expect(markdown).toContain(`Published: 2026-08-01 · Retrieved: ${at}`);
    expect(markdown).toContain('Search excerpt (partial; not the full page)');
    expect(markdown).toContain('Saved card summary:'); expect(markdown).toContain('Stored source passage:');
    expect(markdown).toContain('Your note (opinion, not source evidence):');
  });
  it('records generation before transport and freezes evidence/project inputs through edits', async () => {
    const { service, project, save, generate, store } = setup(); const item = save();
    generate.mockImplementation(async () => { expect(store.all('research_briefs')[0].status).toBe('generating'); service.update(project.id, { title: 'Renamed', goal: 'A new goal' }); service.removeSave(project.id, item.id); return { value: content('E1'), model: 'fixture', tokens: 100, durationMs: 5 }; });
    const started = service.startBrief(project.id); expect(started.status).toBe('generating'); expect(() => service.startBrief(project.id)).toThrow('already');
    await service.waitForIdle(); const done = service.detail(project.id).briefs[0];
    expect(done.status).toBe('completed'); expect(done.project.title).toBe('Memory decision'); expect(done.evidence).toHaveLength(1);
    const markdown = researchBriefMarkdown(done); expect(markdown).toContain('https://example.org/docs'); expect(markdown).toContain('Exact retrieved text'); expect(markdown).toContain('condition');
  });
  it('rejects a hallucinated citation and preserves saved evidence for retry', async () => {
    const { service, project, save, generate } = setup(); save(); generate.mockResolvedValue({ value: content('made-up'), model: 'fixture', tokens: 100, durationMs: 5 });
    service.startBrief(project.id); await service.waitForIdle(); const detail = service.detail(project.id);
    expect(detail.briefs[0].status).toBe('failed'); expect(detail.briefs[0].content).toBeUndefined(); expect(detail.briefs[0].error).toContain('outside'); expect(detail.saved).toHaveLength(1);
    expect(detail.briefs[0]).toMatchObject({ model: 'fixture', tokens: 100, durationMs: 5 });
    expect(detail.briefs[0].candidate).toEqual(content('made-up'));
  });
  it('recovers interrupted generation without invoking a model or losing inputs', async () => {
    const { service, store, project, save, generate } = setup(); const item = save();
    store.brief({ id: 'interrupted', projectId: project.id, project, evidence: [item], status: 'generating', createdAt: at });
    service.recoverInterrupted(); expect(generate).not.toHaveBeenCalled(); expect(service.detail(project.id).briefs[0].status).toBe('failed');
    expect(() => researchBriefMarkdown(service.detail(project.id).briefs[0])).toThrow('not ready');
  });
  it('bounds selection and prevents deleting private inputs during an active generation', async () => {
    const { service, project, save, generate } = setup(); const item = save();
    expect(() => service.startBrief(project.id, [item.id, item.id])).toThrow('Choose');
    generate.mockImplementation((_schema, _instructions, _data, _settings, signal: AbortSignal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }));
    const brief = service.startBrief(project.id); await Promise.resolve();
    expect(() => service.clear()).toThrow('Stop'); expect(() => service.remove(project.id)).toThrow('Stop');
    service.cancel(brief.id); await service.waitForIdle(); expect(service.detail(project.id).briefs[0].status).toBe('cancelled');
  });
  it('does not invoke generation when cancelled before the scheduled task starts', async () => {
    const { service, project, save, generate } = setup(); save();
    const brief = service.startBrief(project.id); service.cancel(brief.id);
    await service.waitForIdle();
    expect(generate).not.toHaveBeenCalled(); expect(service.isRunning()).toBe(false);
    expect(service.detail(project.id).briefs[0].status).toBe('cancelled');
  });
  it('releases the active job and exposes an honest failed overlay if terminal persistence fails', async () => {
    const { service, project, save, generate, store } = setup(); save();
    generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 100, durationMs: 5 });
    const write = store.brief.bind(store);
    const persistence = vi.spyOn(store, 'brief').mockImplementation(value => { if (value.status !== 'generating') throw new Error('simulated local SQLite storage failure'); write(value); });
    const started = service.startBrief(project.id);
    await expect(service.waitForIdle()).resolves.toBeUndefined();
    expect(service.isRunning()).toBe(false);
    const failed = service.detail(project.id).briefs[0];
    expect(failed).toMatchObject({ id: started.id, status: 'failed', model: 'fixture', tokens: 100 });
    expect(failed.content).toBeUndefined(); expect(failed.error).toContain('could not be saved locally'); expect(failed.error).toContain('only until the server restarts');
    expect(service.exportData().briefs[0]).toEqual(failed);
    expect(store.get('research_briefs', started.id)?.status).toBe('generating');
    expect(() => researchBriefMarkdown(failed)).toThrow('not ready');
    persistence.mockRestore();
    service.startBrief(project.id); await service.waitForIdle();
    expect(service.detail(project.id).briefs[0].status).toBe('completed');
    service.remove(project.id);
    expect(service.exportData()).toEqual({ projects: [], saved: [], briefs: [], decisions: [], sessions: [] });
  });
  it('preserves failed generation usage and recovers interrupted disk records without replay', async () => {
    const { service, project, save, generate, store, session } = setup(); save();
    generate.mockRejectedValue(Object.assign(new Error('invalid generation'), { searchUsage: { model: 'fixture', tokens: 123, durationMs: 45 } }));
    service.startBrief(project.id); await service.waitForIdle();
    expect(service.detail(project.id).briefs[0]).toMatchObject({ status: 'failed', model: 'fixture', tokens: 123, durationMs: 45 });
    const original = store.brief.bind(store);
    const persistence = vi.spyOn(store, 'brief').mockImplementationOnce(original).mockImplementationOnce(() => { throw new Error('write failed'); });
    const interrupted = service.startBrief(project.id); await service.waitForIdle(); persistence.mockRestore();
    const recovered = createResearchService(store, { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: '' }), generate });
    const calls = generate.mock.calls.length; recovered.recoverInterrupted();
    expect(generate).toHaveBeenCalledTimes(calls);
    expect(recovered.detail(project.id).briefs.find(brief => brief.id === interrupted.id)).toMatchObject({ status: 'failed' });
    expect(recovered.detail(project.id).briefs.find(brief => brief.id === interrupted.id)?.error).toContain('no paid request was replayed');
  });
});

describe('production-default brief source-support gate', () => {
  it('checkpoints the complete draft before checking every cited statement including alternative titles', async () => {
    const { service, store, project, save, generate, verify } = setup(); const saved = save();
    const draft = { ...content('E1'), alternatives: [{ title: 'Guaranteed two-day implementation', assessment: { text: 'This approach is ready for the proposed project.', evidenceIds: ['E1'] } }], tradeoffs: [{ text: 'This approach has the stated operational tradeoff.', evidenceIds: ['E1'] }] };
    generate.mockResolvedValue({ value: draft, model: 'fixture', tokens: 10, durationMs: 1 });
    verify.mockImplementation(async check => {
      const checkpoint = store.all('research_briefs')[0]; expect(checkpoint.draft).toBeDefined(); expect(checkpoint.content).toBeUndefined();
      expect(check.passages[0]).toMatchObject({ evidenceId: saved.id, quote: 'Exact retrieved text describing the option.' });
      return { support: check.section === 'alternative' ? 0.2 : 0.95, model: 'mock-jev', tokens: 3 };
    });
    service.startBrief(project.id); await service.waitForIdle();
    const brief = service.detail(project.id).briefs[0];
    expect(verify).toHaveBeenCalledTimes(6); expect(verify.mock.calls.find(([check]) => check.section === 'alternative')?.[0].statement).toContain('Guaranteed two-day implementation:');
    expect(brief.status).toBe('needs-review'); expect(brief.content).toBeUndefined(); expect(brief.draft?.alternatives).toHaveLength(1);
    expect(brief.sourceSupport).toMatchObject({ version: 'brief-all-prose-support-v2', threshold: 0.8, scope: 'all-generated-prose', status: 'needs-review' });
    expect(brief.sourceSupport?.checks.find(check => check.section === 'alternative')).toMatchObject({ status: 'needs-review', score: 0.2 });
    expect(() => researchBriefMarkdown(brief)).toThrow('not ready'); expect(service.exportData().briefs[0].draft).toEqual(brief.draft);
  });
  it.each(['open-question', 'next-step'])('quarantines unsupported premises in %s despite passing cited statements', async section => {
    const { service, project, save, generate, verify } = setup(); save();
    const draft = { ...content('E1'), openQuestions: ['Since this library guarantees a two-day deployment, which day should we launch?'], nextSteps: ['Enable its guaranteed end-to-end encrypted cloud synchronization for free.'] };
    generate.mockResolvedValue({ value: draft, model: 'fixture', tokens: 10, durationMs: 1 });
    verify.mockImplementation(async check => ({ support: check.section === section ? 0.1 : 0.99, model: 'mock-jev', tokens: 1 }));
    service.startBrief(project.id); await service.waitForIdle(); const brief = service.detail(project.id).briefs[0];
    expect(brief.status).toBe('needs-review'); expect(brief.content).toBeUndefined(); expect(brief.draft?.openQuestions).toEqual(draft.openQuestions);
    expect(brief.sourceSupport?.checks.find(check => check.section === section)).toMatchObject({ status: 'needs-review', passages: [{ quote: 'Exact retrieved text describing the option.' }] });
    expect(() => researchBriefMarkdown(brief)).toThrow('not ready');
  });
  it('screens free prose against all selected sources and deduplicates only identical passages', () => {
    const { save } = setup(); const first = save(); const second = structuredClone(first); second.id = 'second-card';
    second.sources[0].publisher = 'other-publisher.invalid'; second.sources[0].title = 'Other product';
    const duplicate = structuredClone(first); duplicate.id = 'third-card';
    const review = buildBriefSupportReview(content(first.id), [first, second, duplicate]);
    expect(review.checks.find(check => check.section === 'reason')?.passages).toHaveLength(1);
    const question = review.checks.find(check => check.section === 'open-question')!;
    expect(question.evidenceIds).toEqual([first.id, second.id, duplicate.id]); expect(question.passages).toHaveLength(2);
    expect(question.passages.map(passage => passage.publisher)).toEqual(['example.org', 'other-publisher.invalid']);
  });
  it('preserves oversized all-source reviews as unavailable instead of truncating or calling the verifier', async () => {
    const { service, store, project, save, generate, verify } = setup(); const saved = save();
    saved.unit.evidence[0].quote = 'x'.repeat(12_001); saved.sources[0].text = saved.unit.evidence[0].quote; store.save(saved);
    generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    service.startBrief(project.id); await service.waitForIdle(); const brief = service.detail(project.id).briefs[0];
    expect(verify).not.toHaveBeenCalled(); expect(brief.status).toBe('needs-review');
    expect(brief.sourceSupport?.checks.every(check => check.status === 'unavailable' && check.error?.includes('without truncation'))).toBe(true);
    expect(brief.sourceSupport?.checks[0].passages[0].quote).toHaveLength(12_001); expect(brief.draft).toBeDefined();
  });
  it('keeps at most two support checks in flight while covering every generated field', async () => {
    const { service, project, save, generate, verify } = setup(); save(); generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    const releases: (() => void)[] = []; let active = 0; let peak = 0;
    verify.mockImplementation(async () => { active++; peak = Math.max(peak, active); await new Promise<void>(resolve => releases.push(resolve)); active--; return { support: 0.95, model: 'mock-jev', tokens: 1 }; });
    service.startBrief(project.id); await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(2));
    expect(active).toBe(2); releases.shift()!(); await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(3));
    releases.shift()!(); await vi.waitFor(() => expect(verify).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach(release => release()); await service.waitForIdle();
    expect(peak).toBe(2); expect(active).toBe(0); expect(service.detail(project.id).briefs[0].status).toBe('completed');
  });
  it.each([0.79, NaN, undefined])('quarantines a low or invalid support result %s instead of publishing a completed brief', async score => {
    const { service, project, save, generate, verify } = setup(); save(); generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    verify.mockResolvedValue({ support: score, model: 'mock-jev', tokens: 1 });
    service.startBrief(project.id); await service.waitForIdle(); const brief = service.detail(project.id).briefs[0];
    expect(brief.status).toBe('needs-review'); expect(brief.draft).toBeDefined(); expect(brief.content).toBeUndefined();
    expect(() => researchBriefMarkdown(brief)).toThrow('not ready');
  });
  it('accepts only passing checks and labels the export as a fallible development policy', async () => {
    const { service, project, save, generate, verify } = setup(); save(); generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 }); verify.mockResolvedValue({ support: 0.8, model: 'mock-jev', tokens: 1 });
    service.startBrief(project.id); await service.waitForIdle(); const brief = service.detail(project.id).briefs[0];
    expect(brief.status).toBe('completed'); expect(brief.draft).toBeUndefined(); expect(brief.sourceSupport?.checks.every(check => check.status === 'passed')).toBe(true);
    expect(researchBriefMarkdown(brief)).toContain('fallible checks do not verify truth');
  });
  it('quarantines missing cited passages without asking the verifier to invent replacement evidence', async () => {
    const { service, store, project, save, generate, verify } = setup(); const saved = save(); store.save({ ...saved, sources: [] });
    generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    service.startBrief(project.id); await service.waitForIdle(); const brief = service.detail(project.id).briefs[0];
    expect(verify).not.toHaveBeenCalled(); expect(brief.status).toBe('needs-review');
    expect(brief.sourceSupport?.checks[0]).toMatchObject({ statement: 'Consider this option conditionally.', status: 'unavailable' });
    expect(brief.draft).toBeDefined();
  });
  it('uses the default production gate when no verifier is injected and fails closed without a key', async () => {
    const { store, project, save, generate, session } = setup(); save(); generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    const service = createResearchService(store, { getSession: () => session, configuration: () => ({ gatewayKey: '', llmModel: 'fixture' }), generate });
    const fetch = vi.spyOn(globalThis, 'fetch');
    service.startBrief(project.id); await service.waitForIdle(); const brief = service.detail(project.id).briefs[0];
    expect(brief.status).toBe('needs-review'); expect(brief.sourceSupport?.checks[0].error).toContain('existing OpenRouter'); expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves the unaccepted draft on cancellation and on interrupted-review recovery without replay', async () => {
    const { service, store, project, save, generate, verify } = setup(); const saved = save(); generate.mockResolvedValue({ value: content('E1'), model: 'fixture', tokens: 10, durationMs: 1 });
    verify.mockImplementation(async () => { service.cancel(store.all('research_briefs')[0].id); return { support: 0.99, model: 'mock-jev', tokens: 1 }; });
    service.startBrief(project.id); await service.waitForIdle(); const cancelled = service.detail(project.id).briefs[0];
    expect(cancelled.status).toBe('cancelled'); expect(cancelled.draft).toBeDefined(); expect(cancelled.content).toBeUndefined(); expect(() => researchBriefMarkdown(cancelled)).toThrow('not ready');
    const draft = content(saved.id); store.brief({ id: 'interrupted-review', projectId: project.id, project, evidence: [saved], draft, sourceSupport: buildBriefSupportReview(draft, [saved]), status: 'generating', createdAt: at });
    const calls = verify.mock.calls.length; service.recoverInterrupted();
    const recovered = service.detail(project.id).briefs.find(item => item.id === 'interrupted-review')!;
    expect(recovered).toMatchObject({ status: 'needs-review', draft }); expect(recovered.sourceSupport?.checks[0].status).toBe('unavailable'); expect(verify).toHaveBeenCalledTimes(calls);
  });
});
