# Orderly — Database Schema Overview (v0.1.0)

SQLite via better-sqlite3. Migrations `001`–`004`, transactional and idempotent. Money columns are
INTEGER cents; timestamps are ISO-8601 UTC TEXT. Foreign keys enforced (`PRAGMA foreign_keys = ON`).

## 001_foundation — app plumbing
- `settings(key TEXT PK, value TEXT)` — company info, currency, order-number prefix/counter,
  StagePoint inbox dir, last page, window state.
- `import_jobs(id, kind, filename, status, total_rows, imported_rows, created_at, finished_at)` —
  CSV import runs; statuses pending/running/completed/failed.
- `import_errors(id, import_job_id FK, row_number, message)` — per-row import failures.
- `integrations(id, provider, status, config_json, …)` — reserved; no providers connected.

## 002_core — customers, products, orders
- `customers(id, name, email, phone, company, notes, tags JSON, deleted_at, created_at, updated_at)`
  Indexes: name, email, deleted_at.
- `customer_addresses(id, customer_id FK, kind, label, recipient, line1, line2, city, state,
  postal_code, country)` — index on customer_id.
- `product_categories(id, name UNIQUE)`.
- `products(id, name, sku, description, category_id FK, base_price_cents, active, marketplace_id,
  image_path, deleted_at, …)` — indexes: name, sku, category_id, deleted_at.
- `product_variants(id, product_id FK, name, sku, price_cents, attributes JSON)` — index on product_id.
- `orders(id, order_number UNIQUE, order_date, customer_id FK, source, status, priority,
  requested_date, subtotal_cents, discount_cents, shipping_cents, tax_cents, grand_total_cents,
  paid_cents, ship_* address fields, internal_notes, customer_notes, tags JSON, archived,
  created_at, updated_at)` — indexes: order_number, customer_id, status, order_date,
  requested_date, archived.
- `order_items(id, order_id FK, position, product_id FK NULL, variant_id FK NULL, description, sku,
  quantity, unit_price_cents, discount_cents, tax_cents, line_total_cents, requires_production)` —
  product/variant links are nullable; description/SKU/price are snapshots. Index on order_id.
- `order_status_history(id, order_id FK, from_status, to_status, note, created_at)` — append-only;
  includes the initial creation entry. Index on order_id.
- `order_notes(id, order_id FK, kind, body, created_at)` — index on order_id.
- `payments(id, order_id FK, amount_cents, method, reference, paid_at, note)` — informational only.
  Index on order_id.

## 003_fulfillment — packing and shipping
- `fulfillments(id, order_id FK, status [packing|ready_to_ship|shipped], packed_at, …)` —
  one per packing session; partial fulfillment creates several. Index on order_id.
- `fulfillment_items(id, fulfillment_id FK, order_item_id FK, quantity)` — per-item packed quantities.
- `shipments(id, order_id FK, fulfillment_id FK NULL, carrier, service, tracking_number, shipped_at,
  delivered_at, cost_cents, …)` — multiple per order allowed. Index on order_id.

## 004_production_returns — handoff and returns
- `production_handoffs(id, order_id FK, status [draft|sent|acknowledged|completed|failed],
  envelope_json, ack_json, outbox_path, created_at, updated_at)` — persistent record of every
  StagePoint handoff; envelope validated against the contract schema before writing.
- `returns(id, order_id FK, status [requested|approved|awaiting_return|received|inspected|
  resolved|rejected], reason, refund_status, replacement_order_id FK NULL, created_at, updated_at)`.
- `return_items(id, return_id FK, order_item_id FK, quantity, condition_note)`.

## Conventions
- All primary keys: prefixed text ids (`ord_`, `cus_`, `prd_`, `itm_`, …).
- No `UPDATE` on `order_status_history`, `order_items` (items edited via order update which rewrites
  lines deliberately), or handoff envelopes — history is append-only.
- `orders.order_number` is UNIQUE; the prefix/counter in settings generates it.
- Backups copy the whole SQLite file after a WAL checkpoint with the DB closed; restore validates
  integrity (`PRAGMA integrity_check`) and schema version before replacing.
