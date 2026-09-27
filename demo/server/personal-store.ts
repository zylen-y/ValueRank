import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { demoRoot } from './config.ts';
import type { PersonalComparison, PersonalDataset, PersonalExposure, PersonalModel, PersonalObservation, PersonalPrediction, PersonalProfileFact, PersonalSearchSession, PersonalSource, PersonalUnit } from '../src/domain/personal.ts';
import type { PersonalEvaluationRun } from '../src/domain/personal-evaluation.ts';

const tables = ['sources', 'units', 'sessions', 'datasets', 'exposures', 'predictions', 'comparisons', 'facts', 'observations', 'models', 'evaluation_runs'] as const;
type Table = typeof tables[number];
interface RecordTypes { sources: PersonalSource; units: PersonalUnit; sessions: PersonalSearchSession; datasets: PersonalDataset; exposures: PersonalExposure; predictions: PersonalPrediction; comparisons: PersonalComparison; facts: PersonalProfileFact; observations: PersonalObservation; models: PersonalModel; evaluation_runs: PersonalEvaluationRun }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Separate entity tables preserve immutable revisions rather than rewriting one workspace blob. */
export function createPersonalStore(path = resolve(demoRoot, '.data/personal.sqlite')) {
  if (path !== ':memory:') mkdirSync(resolve(path, '..'), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=3000;');
  db.exec(`CREATE TABLE IF NOT EXISTS personal_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources(id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS units(id TEXT NOT NULL, version INTEGER NOT NULL, hash TEXT NOT NULL, domain TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS feature_vectors(unit_id TEXT NOT NULL, unit_version INTEGER NOT NULL, schema_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(unit_id,unit_version), FOREIGN KEY(unit_id,unit_version) REFERENCES units(id,version) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS datasets(id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS dataset_items(dataset_id TEXT NOT NULL, dataset_version INTEGER NOT NULL, unit_id TEXT NOT NULL, unit_version INTEGER NOT NULL, partition TEXT NOT NULL, PRIMARY KEY(dataset_id,dataset_version,unit_id), FOREIGN KEY(dataset_id,dataset_version) REFERENCES datasets(id,version) ON DELETE CASCADE, FOREIGN KEY(unit_id,unit_version) REFERENCES units(id,version) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS exposures(id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, mode TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS predictions(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY, exposure_id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS models(id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,version));
    CREATE TABLE IF NOT EXISTS undo_events(id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    INSERT OR IGNORE INTO personal_migrations(version,applied_at) VALUES(1,datetime('now'));
    CREATE TABLE IF NOT EXISTS evaluation_runs(id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, domain TEXT NOT NULL, schema_id TEXT NOT NULL, payload TEXT NOT NULL);
    INSERT OR IGNORE INTO personal_migrations(version,applied_at) VALUES(2,datetime('now'));`);
  let inTransaction = false;
  function transaction<T>(fn: () => T): T {
    if (inTransaction) return fn();
    db.exec('BEGIN IMMEDIATE'); inTransaction = true;
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
    finally { inTransaction = false; }
  }
  function all<T extends Table>(table: T): RecordTypes[T][] {
    return (db.prepare(`SELECT payload FROM ${table} ORDER BY rowid`).all() as { payload: string }[]).map(row => JSON.parse(row.payload) as RecordTypes[T]);
  }
  function get<T extends Table>(table: T, id: string, version?: number): RecordTypes[T] | undefined {
    const versioned = ['sources', 'units', 'datasets', 'models'].includes(table);
    const row = versioned ? (version === undefined ? db.prepare(`SELECT payload FROM ${table} WHERE id=? ORDER BY version DESC LIMIT 1`).get(id) : db.prepare(`SELECT payload FROM ${table} WHERE id=? AND version=?`).get(id, version)) : db.prepare(`SELECT payload FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse((row as { payload: string }).payload) as RecordTypes[T] : undefined;
  }
  function saveSource(source: PersonalSource) {
    const existing = get('sources', source.id, source.version);
    if (existing && hash(existing) !== hash(source)) throw new Error('Source revisions are immutable. Use a new version.');
    db.prepare('INSERT OR IGNORE INTO sources(id,version,hash,payload) VALUES(?,?,?,?)').run(source.id, source.version, hash(source), JSON.stringify(source));
  }
  function saveUnit(unit: PersonalUnit) {
    const existing = get('units', unit.id, unit.version);
    if (existing && hash(existing) !== hash(unit)) throw new Error('Information unit revisions are immutable. Use a new version.');
    db.prepare('INSERT OR IGNORE INTO units(id,version,hash,domain,payload) VALUES(?,?,?,?,?)').run(unit.id, unit.version, hash(unit), unit.domain, JSON.stringify(unit));
    db.prepare('INSERT OR IGNORE INTO feature_vectors(unit_id,unit_version,schema_id,payload) VALUES(?,?,?,?)').run(unit.id, unit.version, unit.features.schemaId, JSON.stringify(unit.features));
  }
  function saveDataset(dataset: PersonalDataset) {
    db.prepare('INSERT INTO datasets(id,version,payload) VALUES(?,?,?)').run(dataset.id, dataset.version, JSON.stringify(dataset));
    for (const ref of dataset.itemRefs) db.prepare('INSERT INTO dataset_items(dataset_id,dataset_version,unit_id,unit_version,partition) VALUES(?,?,?,?,?)').run(dataset.id, dataset.version, ref.id, ref.version, ref.partition);
  }
  function saveExposure(exposure: PersonalExposure, prediction: PersonalPrediction) {
    db.prepare('INSERT INTO exposures(id,dataset_id,mode,payload) VALUES(?,?,?,?)').run(exposure.id, exposure.datasetId, exposure.mode, JSON.stringify(exposure));
    db.prepare('INSERT INTO predictions(id,payload) VALUES(?,?)').run(exposure.id, JSON.stringify(prediction));
  }
  function saveComparison(comparison: PersonalComparison) {
    db.prepare('INSERT INTO comparisons(id,exposure_id,payload) VALUES(?,?,?)').run(comparison.id, comparison.exposureId, JSON.stringify(comparison));
  }
  function undoComparison(comparison: PersonalComparison, id: string, at: string) {
    db.prepare('INSERT INTO undo_events(id,comparison_id,created_at) VALUES(?,?,?)').run(id, comparison.id, at);
    db.prepare('UPDATE comparisons SET payload=? WHERE id=?').run(JSON.stringify({ ...comparison, undone: true }), comparison.id);
  }
  function saveModel(model: PersonalModel) { db.prepare('INSERT INTO models(id,version,payload) VALUES(?,?,?)').run(model.id, model.version, JSON.stringify(model)); }
  function saveEvaluationRun(run: PersonalEvaluationRun) {
    const existing = get('evaluation_runs', run.id);
    if (existing && hash(existing) !== hash(run)) throw new Error('Evaluation runs are frozen. Start a new run instead of changing its model or test set.');
    db.prepare('INSERT OR IGNORE INTO evaluation_runs(id,dataset_id,domain,schema_id,payload) VALUES(?,?,?,?,?)').run(run.id, run.datasetId, run.domain, run.featureSchemaId, JSON.stringify(run));
  }
  function invalidateEvaluationRuns(domain: string, schemaId: string, at: string, scopeId?: string) {
    for (const run of all('evaluation_runs')) {
      if (run.domain !== domain || run.featureSchemaId !== schemaId || run.context.scopeId !== scopeId) continue;
      // Erase parameter snapshots derived from deleted labels, retaining only
      // the protocol and version identifiers needed to explain excluded history.
      const invalidated: PersonalEvaluationRun = { ...run, frozenModel: null, status: 'invalidated', invalidatedAt: at, invalidationReason: 'training-data-deleted' };
      db.prepare('UPDATE evaluation_runs SET payload=? WHERE id=?').run(JSON.stringify(invalidated), run.id);
    }
  }
  function invalidateEvaluationRun(id: string, at: string, reason: 'test-data-deleted' | 'test-entity-exposed') {
    const run = get('evaluation_runs', id);
    if (!run || run.status !== 'active') return;
    // Test invalidation does not erase training-derived weights: preserve the
    // frozen audit snapshot, but prevent its results from counting as valid.
    const invalidated: PersonalEvaluationRun = { ...run, status: 'invalidated', invalidatedAt: at, invalidationReason: reason };
    db.prepare('UPDATE evaluation_runs SET payload=? WHERE id=?').run(JSON.stringify(invalidated), id);
  }
  function save<T extends 'sessions' | 'facts' | 'observations'>(table: T, value: RecordTypes[T]) {
    db.prepare(`INSERT INTO ${table}(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload`).run(value.id, JSON.stringify(value));
  }
  function remove(table: Table, id: string) { db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id); }
  function removeUndo(comparisonId: string) { db.prepare('DELETE FROM undo_events WHERE comparison_id=?').run(comparisonId); }
  function removeVersion(table: 'units' | 'sources', id: string, version: number) { db.prepare(`DELETE FROM ${table} WHERE id=? AND version=?`).run(id, version); }
  function clear() {
    transaction(() => {
      db.exec('DELETE FROM undo_events; DELETE FROM dataset_items; DELETE FROM feature_vectors;');
      for (const table of [...tables].reverse()) db.exec(`DELETE FROM ${table}`);
    });
    if (!inTransaction) db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
  }
  return { all, get, transaction, saveSource, saveUnit, saveDataset, saveExposure, saveComparison, undoComparison, saveModel, saveEvaluationRun, invalidateEvaluationRuns, invalidateEvaluationRun, save, remove, removeUndo, removeVersion, clear, close: () => db.close() };
}
export type PersonalStore = ReturnType<typeof createPersonalStore>;
