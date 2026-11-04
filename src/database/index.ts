import Database from 'better-sqlite3';
import { app } from 'electron';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from './migrations.js';

let db: Database.Database | null = null;
let dbPath = '';

/** Resolve the data directory. ORDERLY_DATA_DIR env override is for tests/dev. */
export function dataDir(): string {
  const override = process.env.ORDERLY_DATA_DIR;
  if (override) return override;
  return join(app.getPath('userData'), 'data');
}

export function getDbPath(): string {
  return dbPath;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database is not open.');
  return db;
}

export function openDatabase(): Database.Database {
  if (db) return db;
  const dir = dataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  dbPath = join(dir, 'orderly.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = '';
  }
}

/** Run fn inside a transaction; rolls back on throw. */
export function tx<T>(fn: (db: Database.Database) => T): T {
  const database = getDb();
  const run = database.transaction(fn);
  return run(database);
}
