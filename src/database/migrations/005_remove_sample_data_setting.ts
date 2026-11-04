import type Database from 'better-sqlite3';

/** 005 — remove the vestigial sample_data_enabled setting (no sample-data feature exists). */
export const id = '005_remove_sample_data_setting';

export function up(db: Database.Database): void {
  db.prepare(`DELETE FROM application_settings WHERE key = 'sample_data_enabled'`).run();
}
