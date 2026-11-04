import type Database from 'better-sqlite3';

/** Milestone 3: fulfillments, fulfillment items, shipments. */
export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fulfillments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'packing',
      package_notes TEXT,
      length_cm REAL,
      width_cm REAL,
      height_cm REAL,
      weight_kg REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_fulfillments_order ON fulfillments(order_id);
    CREATE INDEX IF NOT EXISTS idx_fulfillments_status ON fulfillments(status);

    CREATE TABLE IF NOT EXISTS fulfillment_items (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL REFERENCES fulfillments(id) ON DELETE CASCADE,
      order_item_id TEXT NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
      quantity_packed INTEGER NOT NULL,
      UNIQUE(fulfillment_id, order_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_fulfillment_items_fulfillment ON fulfillment_items(fulfillment_id);

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      fulfillment_id TEXT NOT NULL UNIQUE REFERENCES fulfillments(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      carrier TEXT,
      service TEXT,
      tracking_number TEXT,
      shipped_at TEXT,
      shipping_cost_cents INTEGER NOT NULL DEFAULT 0,
      package_summary TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shipments_order ON shipments(order_id);
    CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON shipments(tracking_number);
  `);
}

export const id = '003_fulfillment';
