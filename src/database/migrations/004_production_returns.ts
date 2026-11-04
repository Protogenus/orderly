import type Database from 'better-sqlite3';

/** Milestone 4: production handoffs (StagePoint contract) and returns. */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS production_handoffs (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'draft',
      items TEXT NOT NULL DEFAULT '[]',
      envelope_path TEXT,
      accepted_at TEXT,
      progress_note TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_handoffs_order ON production_handoffs(order_id);
    CREATE INDEX IF NOT EXISTS idx_handoffs_status ON production_handoffs(status);

    CREATE TABLE IF NOT EXISTS returns (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'requested',
      reason TEXT,
      refund_status TEXT,
      replacement_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      internal_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
    CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);

    CREATE TABLE IF NOT EXISTS return_items (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
  `);
}

export const id = '004_production_returns';
