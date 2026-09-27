import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { demoRoot } from './config.ts';
import type { ResearchBrief, ResearchDecision, ResearchProject, ResearchSave } from '../src/domain/research.ts';

type Records = { research_projects: ResearchProject; research_saves: ResearchSave; research_briefs: ResearchBrief; research_decisions: ResearchDecision };
type Table = keyof Records;

/** Local private project data. Test servers must derive this path from their isolated personal DB. */
export function createResearchStore(path = resolve(demoRoot, '.data/research.sqlite')) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS research_projects(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_saves(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE, unit_id TEXT NOT NULL, unit_version INTEGER NOT NULL, payload TEXT NOT NULL, UNIQUE(project_id, unit_id, unit_version));
    CREATE TABLE IF NOT EXISTS research_briefs(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_decisions(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_sessions(session_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE);
    CREATE INDEX IF NOT EXISTS research_saves_project ON research_saves(project_id);
    CREATE INDEX IF NOT EXISTS research_briefs_project ON research_briefs(project_id);
    CREATE INDEX IF NOT EXISTS research_decisions_project ON research_decisions(project_id);`);
  function all<T extends Table>(table: T): Records[T][] {
    return (db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all() as { payload: string }[]).map(row => JSON.parse(row.payload));
  }
  function get<T extends Table>(table: T, id: string): Records[T] | undefined {
    const row = db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) : undefined;
  }
  function project(value: ResearchProject) { db.prepare('INSERT INTO research_projects VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id, JSON.stringify(value)); }
  function activity(projectId: string, at: string) {
    const value = get('research_projects', projectId);
    if (!value) throw new Error('Research project not found.');
    project({ ...value, lastActivityAt: [value.updatedAt, value.lastActivityAt ?? value.updatedAt, at].sort().at(-1)! });
  }
  function save(value: ResearchSave) { db.prepare('INSERT INTO research_saves VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id, value.projectId, value.unit.id, value.unit.version, JSON.stringify(value)); }
  function brief(value: ResearchBrief) { db.prepare('INSERT INTO research_briefs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(value.id, value.projectId, JSON.stringify(value)); }
  function decision(value: ResearchDecision) { db.prepare('INSERT INTO research_decisions VALUES(?,?,?)').run(value.id, value.projectId, JSON.stringify(value)); }
  function link(sessionId: string, projectId: string) {
    const existing = projectForSession(sessionId);
    if (existing && existing !== projectId) throw new Error('An exploration already belongs to another project.');
    db.prepare('INSERT OR IGNORE INTO research_sessions VALUES(?,?)').run(sessionId, projectId);
  }
  function projectForSession(id: string) { return (db.prepare('SELECT project_id FROM research_sessions WHERE session_id=?').get(id) as { project_id: string } | undefined)?.project_id; }
  function sessions(projectId: string) { return (db.prepare('SELECT session_id FROM research_sessions WHERE project_id=? ORDER BY rowid DESC').all(projectId) as { session_id: string }[]).map(row => row.session_id); }
  function remove(table: Table, id: string) { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); }
  function transaction<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function clear() { db.exec('DELETE FROM research_projects; PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'); }
  function exportData() { return { projects: all('research_projects'), saved: all('research_saves'), briefs: all('research_briefs'), decisions: all('research_decisions'), sessions: db.prepare('SELECT session_id AS sessionId, project_id AS projectId FROM research_sessions').all() }; }
  return { all, get, project, activity, save, brief, decision, link, projectForSession, sessions, remove, transaction, clear, exportData, unlink: (sessionId: string) => db.prepare('DELETE FROM research_sessions WHERE session_id=?').run(sessionId), close: () => db.close() };
}
export type ResearchStore = ReturnType<typeof createResearchStore>;
