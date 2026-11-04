import type Database from 'better-sqlite3';
import { ALL_MIGRATIONS, type Migration } from './migrations/all.js';

function appliedIds(db: Database.Database): Set<string> {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const rows = db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

/** Apply pending migrations in order, each inside its own transaction. */
export function runMigrations(db: Database.Database): void {
  const applied = appliedIds(db);
  const pending: Migration[] = ALL_MIGRATIONS.filter((m) => !applied.has(m.id)).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const mark = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  for (const m of pending) {
    const run = db.transaction(() => {
      m.up(db);
      mark.run(m.id, new Date().toISOString());
    });
    run();
  }
}
