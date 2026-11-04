import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/** Validate that a file looks like an Orderly database. Throws a human-readable error. */
export function validateBackupFile(path: string): void {
  if (!existsSync(path)) throw new Error('File not found.');
  let probe: Database.Database | null = null;
  try {
    probe = new Database(path, { readonly: true });
    const row = probe
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`)
      .get();
    if (!row) throw new Error('This file is not an Orderly database (missing schema_migrations).');
  } catch (e) {
    if (e instanceof Error && /not an Orderly/.test(e.message)) throw e;
    throw new Error('This file is not a valid SQLite database.');
  } finally {
    probe?.close();
  }
}

export function backupFileName(when = new Date()): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `orderly-backup-${stamp}.db`;
}

/**
 * Copy a database file into destDir with a timestamped name.
 * The caller must checkpoint/close the live database before calling and reopen after.
 */
export function copyDatabaseFile(src: string, destDir: string): string {
  if (!existsSync(src)) throw new Error('Database file not found.');
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, backupFileName());
  copyFileSync(src, dest);
  return dest;
}
