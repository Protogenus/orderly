import type Database from 'better-sqlite3';

/** Milestone 1: application settings, import jobs/errors, integrations. */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS application_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS import_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0,
      error_rows INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON import_jobs(status);

    CREATE TABLE IF NOT EXISTS import_errors (
      id TEXT PRIMARY KEY,
      import_job_id TEXT NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      message TEXT NOT NULL,
      raw_row TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_import_errors_job ON import_errors(import_job_id);

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'not_connected',
      config_json TEXT,
      last_sync_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integration_events (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_integration_events_integration ON integration_events(integration_id);
  `);

  const seed = db.prepare(
    `INSERT OR IGNORE INTO application_settings (key, value, updated_at) VALUES (?, ?, ?)`,
  );
  const now = new Date().toISOString();
  seed.run('company_name', '', now);
  seed.run('order_number_prefix', 'ORD-', now);
  seed.run('order_number_next', '1001', now);
  seed.run('default_currency', 'USD', now);
  seed.run('sample_data_enabled', '0', now);
}

export const id = '001_foundation';
