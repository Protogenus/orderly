import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { runMigrations } from './migrations.js';

let db: Database.Database | null = null;
let dbPath = '';

interface ElectronApp {
  getPath(name: string): string;
}

/**
 * Electron's app object when running inside the Electron runtime, undefined
 * under plain Node (unit tests, scripts).
 *
 * process.versions.electron is set only inside Electron. Checking it first
 * avoids requiring the 'electron' npm package under plain Node, where its
 * index.js has a download side effect: if node_modules/electron/dist/electron
 * is missing it spawns a full Electron binary download. On Windows the file
 * is dist/electron.exe so the check never matches and every require triggers
 * a ~110MB download per process — which is what crashed the vitest workers
 * in CI. A top-level `import { app } from 'electron'` would run that side
 * effect at module load; this lazy, guarded require does not.
 */
function electronApp(): ElectronApp | undefined {
  if (typeof process === 'undefined' || !process.versions?.electron) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron') as { app?: ElectronApp };
  return electron.app;
}

/** Resolve the data directory. ORDERLY_DATA_DIR env override is for tests/dev. */
export function dataDir(): string {
  const override = process.env.ORDERLY_DATA_DIR;
  if (override) return override;
  const app = electronApp();
  if (!app) throw new Error('dataDir() needs the Electron runtime or ORDERLY_DATA_DIR to be set.');
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
