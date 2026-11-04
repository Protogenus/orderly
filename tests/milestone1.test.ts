import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-m1-'));
  process.env.ORDERLY_DATA_DIR = dir;
});

afterEach(async () => {
  process.env.ORDERLY_DATA_DIR = '';
  const idx = await import('../src/database/index.js');
  idx.closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it('applies 001_foundation on a fresh database', async () => {
    const { openDatabase, getDb } = await import('../src/database/index.js');
    openDatabase();
    const db = getDb();
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    for (const t of ['application_settings', 'import_jobs', 'import_errors', 'integrations', 'integration_events', 'schema_migrations']) {
      expect(names).toContain(t);
    }
    const migs = db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[];
    expect(migs.map((m) => m.id)).toContain('001_foundation');
  });

  it('is idempotent across re-opens', async () => {
    const idx = await import('../src/database/index.js');
    idx.openDatabase();
    idx.closeDatabase();
    idx.openDatabase(); // re-open must not throw or duplicate
    const db = idx.getDb();
    const migs = db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[];
    expect(migs.filter((m) => m.id === '001_foundation')).toHaveLength(1);
  });

  it('seeds required default settings', async () => {
    const idx = await import('../src/database/index.js');
    idx.openDatabase();
    const { getSetting } = await import('../src/database/settings.js');
    expect(getSetting('order_number_prefix')).toBe('ORD-');
    expect(getSetting('order_number_next')).toBe('1001');
    expect(getSetting('default_currency')).toBe('USD');
    expect(getSetting('sample_data_enabled')).toBe('0');
  });
});

describe('settings', () => {
  it('round-trips get/set and upserts', async () => {
    const idx = await import('../src/database/index.js');
    idx.openDatabase();
    const { getSetting, setSetting, getAllSettings } = await import('../src/database/settings.js');
    setSetting('company_name', 'Acme Candles');
    expect(getSetting('company_name')).toBe('Acme Candles');
    setSetting('company_name', 'Acme Candles Co');
    expect(getSetting('company_name')).toBe('Acme Candles Co');
    expect(getAllSettings()['company_name']).toBe('Acme Candles Co');
    expect(getSetting('nope_missing')).toBeNull();
  });
});

describe('backup file validation', () => {
  it('accepts a real orderly db and rejects junk', async () => {
    const idx = await import('../src/database/index.js');
    idx.openDatabase();
    const src = join(dir, 'orderly.db');
    expect(existsSync(src)).toBe(true);

    const { validateBackupFile } = await import('../src/domain/backup.js');
    expect(() => validateBackupFile(src)).not.toThrow();

    const junk = join(dir, 'junk.db');
    copyFileSync(src, junk);
    // corrupt it: write garbage over the header
    const { writeFileSync } = await import('fs');
    writeFileSync(junk, Buffer.from('definitely not a database file'));
    expect(() => validateBackupFile(junk)).toThrow(/SQLite/i);

    const missing = join(dir, 'missing.db');
    expect(() => validateBackupFile(missing)).toThrow(/not found/i);
  });

  it('copyDatabaseFile produces a valid, restorable copy', async () => {
    const idx = await import('../src/database/index.js');
    idx.openDatabase();
    const { setSetting } = await import('../src/database/settings.js');
    setSetting('company_name', 'Backup Test Co');
    // Mirror the real backup flow: checkpoint WAL and close before copying.
    idx.getDb().pragma('wal_checkpoint(TRUNCATE)');
    idx.closeDatabase();
    const { copyDatabaseFile, validateBackupFile } = await import('../src/domain/backup.js');
    const dest = copyDatabaseFile(join(dir, 'orderly.db'), join(dir, 'backups'));
    expect(() => validateBackupFile(dest)).not.toThrow();
    // The copy is an independent, queryable database with our data.
    const Database = (await import('better-sqlite3')).default;
    const probe = new Database(dest, { readonly: true });
    const row = probe.prepare('SELECT value FROM application_settings WHERE key=?').get('company_name') as { value: string };
    expect(row.value).toBe('Backup Test Co');
    probe.close();
  });
});

describe('money', () => {
  it('formats cents without float drift', async () => {
    const { formatCents } = await import('../src/domain/money.js');
    expect(formatCents(1299)).toBe('$12.99');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-50)).toBe('-$0.50');
    expect(formatCents(100000)).toBe('$1,000.00');
  });
});

describe('validate', () => {
  it('moneyToCents parses user input exactly', async () => {
    const { moneyToCents } = await import('../src/shared/validate.js');
    expect(moneyToCents('12.50', 'price')).toBe(1250);
    expect(moneyToCents('12.5', 'price')).toBe(1250);
    expect(moneyToCents('$1,234.56', 'price')).toBe(123456);
    expect(moneyToCents(999, 'price')).toBe(999);
    expect(() => moneyToCents('12.555', 'price')).toThrow();
    expect(() => moneyToCents('abc', 'price')).toThrow();
  });
});
