import { getDb, tx } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import { parseCsvFile, autoMap, IMPORT_FIELDS, parseBoolish, type ParsedCsv } from '../domain/csv.js';
import { moneyToCents } from '../shared/validate.js';
import { ORDER_SOURCES, ORDER_TRANSITIONS } from '../shared/constants.js';
import type { OrderStatus } from '../shared/types.js';
import * as customers from './customers.js';
import * as products from './products.js';
import * as orders from './orders.js';

/** In-memory parsed files, keyed by import job id. Main process only. */
const parsedCache = new Map<string, ParsedCsv>();

export type ImportKind = 'customers' | 'products' | 'orders';

export interface ImportAnalysis {
  jobId: string;
  kind: ImportKind;
  columns: string[];
  totalRows: number;
  sampleRows: Record<string, string>[];
  autoMapping: Record<string, string | null>;
  fields: { key: string; label: string; required: boolean; hint?: string }[];
}

export interface RowIssue {
  row: number;
  message: string;
}

export interface DuplicateHit {
  row: number;
  reason: string;
}

export interface ImportValidation {
  validRows: number;
  errors: RowIssue[];
  duplicates: DuplicateHit[];
}

export function analyzeImport(kind: ImportKind, filePath: string, filename: string): ImportAnalysis {
  if (!['customers', 'products', 'orders'].includes(kind)) {
    throw new AppError('VALIDATION', `Unknown import kind: ${kind}.`);
  }
  const parsed = parseCsvFile(filePath);
  const jobId = newId('imp');
  parsedCache.set(jobId, parsed);
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO import_jobs (id, kind, filename, status, total_rows, created_at) VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    .run(jobId, kind, filename, parsed.totalRows, now);
  return {
    jobId,
    kind,
    columns: parsed.columns,
    totalRows: parsed.totalRows,
    sampleRows: parsed.rows.slice(0, 5),
    autoMapping: autoMap(parsed.columns, kind),
    fields: IMPORT_FIELDS[kind],
  };
}

function mappedValue(row: Record<string, string>, mapping: Record<string, string | null>, key: string): string {
  const col = mapping[key];
  if (!col) return '';
  return (row[col] ?? '').trim();
}

function checkMapping(kind: ImportKind, mapping: Record<string, string | null>): void {
  for (const f of IMPORT_FIELDS[kind]) {
    if (f.required && !mapping[f.key]) {
      throw new AppError('VALIDATION', `Required field "${f.label}" is not mapped to a CSV column.`);
    }
  }
}

function dollarsToCents(raw: string, field: string, rowNum: number): number {
  if (raw === '') return 0;
  try {
    return moneyToCents(raw, field);
  } catch {
    throw new AppError('VALIDATION', `Row ${rowNum}: "${field}" is not a valid dollar amount ("${raw}").`);
  }
}

function validDate(raw: string, field: string, rowNum: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new AppError('VALIDATION', `Row ${rowNum}: "${field}" must be a date like 2026-11-04 ("${raw}").`);
  }
  return raw;
}

interface NormalizedCustomer {
  row: number;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  notes: string | null;
  tags: string[];
}

interface NormalizedProduct {
  row: number;
  name: string;
  sku: string | null;
  description: string | null;
  category: string | null;
  price_cents: number;
  active: boolean;
  marketplace_id: string | null;
}

interface NormalizedOrderRow {
  row: number;
  order_number: string | null;
  order_date: string;
  customer_name: string | null;
  customer_email: string | null;
  source: string;
  status: OrderStatus;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  requested_date: string | null;
  item_description: string;
  item_sku: string | null;
  item_quantity: number;
  item_unit_price_cents: number;
  item_discount_cents: number;
  item_tax_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  ship: Record<string, string | null>;
  internal_notes: string | null;
  customer_notes: string | null;
  tags: string[];
}

function normalizeCustomers(parsed: ParsedCsv, mapping: Record<string, string | null>): { valid: NormalizedCustomer[]; errors: RowIssue[] } {
  const valid: NormalizedCustomer[] = [];
  const errors: RowIssue[] = [];
  parsed.rows.forEach((r, i) => {
    const rowNum = i + 2; // +1 for 0-index, +1 for header
    try {
      const name = mappedValue(r, mapping, 'name');
      if (!name) throw new AppError('VALIDATION', `Row ${rowNum}: name is required.`);
      const email = mappedValue(r, mapping, 'email');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError('VALIDATION', `Row ${rowNum}: email "${email}" is invalid.`);
      }
      valid.push({
        row: rowNum,
        name,
        email: email ? email.toLowerCase() : null,
        phone: mappedValue(r, mapping, 'phone') || null,
        company: mappedValue(r, mapping, 'company') || null,
        notes: mappedValue(r, mapping, 'notes') || null,
        tags: mappedValue(r, mapping, 'tags').split(',').map((t) => t.trim()).filter(Boolean),
      });
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Invalid row.' });
    }
  });
  return { valid, errors };
}

function normalizeProducts(parsed: ParsedCsv, mapping: Record<string, string | null>): { valid: NormalizedProduct[]; errors: RowIssue[] } {
  const valid: NormalizedProduct[] = [];
  const errors: RowIssue[] = [];
  parsed.rows.forEach((r, i) => {
    const rowNum = i + 2;
    try {
      const name = mappedValue(r, mapping, 'name');
      if (!name) throw new AppError('VALIDATION', `Row ${rowNum}: product name is required.`);
      const priceRaw = mappedValue(r, mapping, 'price');
      if (!priceRaw) throw new AppError('VALIDATION', `Row ${rowNum}: price is required.`);
      const activeRaw = mappedValue(r, mapping, 'active');
      const active = activeRaw === '' ? true : parseBoolish(activeRaw);
      if (active === null) throw new AppError('VALIDATION', `Row ${rowNum}: active must be true/false (got "${activeRaw}").`);
      valid.push({
        row: rowNum,
        name,
        sku: mappedValue(r, mapping, 'sku') || null,
        description: mappedValue(r, mapping, 'description') || null,
        category: mappedValue(r, mapping, 'category') || null,
        price_cents: dollarsToCents(priceRaw, 'price', rowNum),
        active,
        marketplace_id: mappedValue(r, mapping, 'marketplace_id') || null,
      });
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Invalid row.' });
    }
  });
  return { valid, errors };
}

const ORDER_STATUSES: OrderStatus[] = ['draft', 'new', 'confirmed', 'awaiting_production', 'in_production', 'ready_to_fulfill', 'packing', 'shipped', 'delivered', 'completed', 'on_hold', 'canceled'];

function normalizeOrders(parsed: ParsedCsv, mapping: Record<string, string | null>): { valid: NormalizedOrderRow[]; errors: RowIssue[] } {
  const valid: NormalizedOrderRow[] = [];
  const errors: RowIssue[] = [];
  parsed.rows.forEach((r, i) => {
    const rowNum = i + 2;
    try {
      const desc = mappedValue(r, mapping, 'item_description');
      if (!desc) throw new AppError('VALIDATION', `Row ${rowNum}: item description is required.`);
      const qtyRaw = mappedValue(r, mapping, 'item_quantity');
      const qty = parseInt(qtyRaw, 10);
      if (!Number.isInteger(qty) || qty < 1) throw new AppError('VALIDATION', `Row ${rowNum}: item quantity must be a whole number ≥ 1 ("${qtyRaw}").`);
      const priceRaw = mappedValue(r, mapping, 'item_unit_price');
      if (!priceRaw) throw new AppError('VALIDATION', `Row ${rowNum}: item unit price is required.`);
      const dateRaw = mappedValue(r, mapping, 'order_date');
      if (!dateRaw) throw new AppError('VALIDATION', `Row ${rowNum}: order date is required.`);
      const statusRaw = mappedValue(r, mapping, 'status').toLowerCase().replace(/[\s-]+/g, '_') || 'new';
      if (!ORDER_STATUSES.includes(statusRaw as OrderStatus)) {
        throw new AppError('VALIDATION', `Row ${rowNum}: status "${mappedValue(r, mapping, 'status')}" is not a valid order status.`);
      }
      const sourceRaw = mappedValue(r, mapping, 'source') || 'CSV Import';
      const priorityRaw = (mappedValue(r, mapping, 'priority').toLowerCase() || 'normal') as NormalizedOrderRow['priority'];
      if (!['low', 'normal', 'high', 'urgent'].includes(priorityRaw)) {
        throw new AppError('VALIDATION', `Row ${rowNum}: priority must be low/normal/high/urgent.`);
      }
      const email = mappedValue(r, mapping, 'customer_email');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new AppError('VALIDATION', `Row ${rowNum}: customer email "${email}" is invalid.`);
      }
      const reqRaw = mappedValue(r, mapping, 'requested_date');
      valid.push({
        row: rowNum,
        order_number: mappedValue(r, mapping, 'order_number') || null,
        order_date: validDate(dateRaw, 'order date', rowNum),
        customer_name: mappedValue(r, mapping, 'customer_name') || null,
        customer_email: email ? email.toLowerCase() : null,
        source: (ORDER_SOURCES as readonly string[]).includes(sourceRaw) ? sourceRaw : 'CSV Import',
        status: statusRaw as OrderStatus,
        priority: priorityRaw,
        requested_date: reqRaw ? validDate(reqRaw, 'requested date', rowNum) : null,
        item_description: desc,
        item_sku: mappedValue(r, mapping, 'item_sku') || null,
        item_quantity: qty,
        item_unit_price_cents: dollarsToCents(priceRaw, 'item unit price', rowNum),
        item_discount_cents: dollarsToCents(mappedValue(r, mapping, 'item_discount'), 'item discount', rowNum),
        item_tax_cents: dollarsToCents(mappedValue(r, mapping, 'item_tax'), 'item tax', rowNum),
        discount_cents: dollarsToCents(mappedValue(r, mapping, 'discount'), 'order discount', rowNum),
        shipping_cents: dollarsToCents(mappedValue(r, mapping, 'shipping'), 'shipping', rowNum),
        tax_cents: dollarsToCents(mappedValue(r, mapping, 'tax'), 'order tax', rowNum),
        ship: {
          recipient: mappedValue(r, mapping, 'ship_recipient') || null,
          line1: mappedValue(r, mapping, 'ship_line1') || null,
          city: mappedValue(r, mapping, 'ship_city') || null,
          state: mappedValue(r, mapping, 'ship_state') || null,
          postal: mappedValue(r, mapping, 'ship_postal') || null,
          country: mappedValue(r, mapping, 'ship_country') || null,
        },
        internal_notes: mappedValue(r, mapping, 'internal_notes') || null,
        customer_notes: mappedValue(r, mapping, 'customer_notes') || null,
        tags: mappedValue(r, mapping, 'tags').split(',').map((t) => t.trim()).filter(Boolean),
      });
    } catch (e) {
      errors.push({ row: rowNum, message: e instanceof Error ? e.message : 'Invalid row.' });
    }
  });
  return { valid, errors };
}

export function validateImport(jobId: string, mapping: Record<string, string | null>): ImportValidation {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(jobId) as any;
  if (!job) throw new AppError('NOT_FOUND', 'Import job not found.');
  const parsed = parsedCache.get(jobId);
  if (!parsed) throw new AppError('NOT_FOUND', 'Import file is no longer available. Start the import again.');
  const kind = job.kind as ImportKind;
  checkMapping(kind, mapping);

  let valid: { row: number }[] = [];
  const errors: RowIssue[] = [];
  if (kind === 'customers') {
    const n = normalizeCustomers(parsed, mapping);
    valid = n.valid;
    errors.push(...n.errors);
  } else if (kind === 'products') {
    const n = normalizeProducts(parsed, mapping);
    valid = n.valid;
    errors.push(...n.errors);
  } else {
    const n = normalizeOrders(parsed, mapping);
    valid = n.valid;
    errors.push(...n.errors);
  }

  // Duplicate detection against live records.
  const duplicates: DuplicateHit[] = [];
  const validRows = new Set(valid.map((v) => v.row));
  if (kind === 'customers') {
    for (const v of valid as NormalizedCustomer[]) {
      if (!v.email) continue;
      const hit = db.prepare(`SELECT id FROM customers WHERE LOWER(email) = ? AND deleted_at IS NULL`).get(v.email) as any;
      if (hit) {
        duplicates.push({ row: v.row, reason: `Email ${v.email} already exists.` });
        validRows.delete(v.row);
      }
    }
  } else if (kind === 'products') {
    for (const v of valid as NormalizedProduct[]) {
      if (!v.sku) continue;
      const hit = db.prepare(`SELECT id FROM products WHERE sku = ? AND deleted_at IS NULL`).get(v.sku) as any;
      if (hit) {
        duplicates.push({ row: v.row, reason: `SKU ${v.sku} already exists.` });
        validRows.delete(v.row);
      }
    }
  } else {
    const seenNumbers = new Set<string>();
    for (const v of valid as NormalizedOrderRow[]) {
      if (!v.order_number) continue;
      if (seenNumbers.has(v.order_number)) continue;
      seenNumbers.add(v.order_number);
      const hit = db.prepare(`SELECT id FROM orders WHERE order_number = ?`).get(v.order_number) as any;
      if (hit) {
        // Mark every row sharing this order number as duplicate.
        for (const w of valid as NormalizedOrderRow[]) {
          if (w.order_number === v.order_number) {
            duplicates.push({ row: w.row, reason: `Order ${v.order_number} already exists.` });
            validRows.delete(w.row);
          }
        }
      }
    }
  }

  // Cache the normalized rows for apply.
  (parsed as ParsedCsv & { _normalized?: unknown })._normalized = { kind, valid: valid.filter((v) => validRows.has(v.row)) };

  db.prepare(`UPDATE import_jobs SET status = 'pending' WHERE id = ?`).run(jobId);
  return { validRows: validRows.size, errors, duplicates };
}

export interface ApplyResult {
  imported: number;
  skipped: number;
  errors: RowIssue[];
}

export function applyImport(jobId: string): ApplyResult {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(jobId) as any;
  if (!job) throw new AppError('NOT_FOUND', 'Import job not found.');
  const parsed = parsedCache.get(jobId) as (ParsedCsv & { _normalized?: { kind: ImportKind; valid: { row: number }[] } }) | undefined;
  if (!parsed?._normalized) throw new AppError('VALIDATION', 'Validate the import before applying it.');
  const { kind, valid } = parsed._normalized;

  db.prepare(`UPDATE import_jobs SET status = 'running' WHERE id = ?`).run(jobId);
  const errors: RowIssue[] = [];
  let imported = 0;

  try {
    tx(() => {
      if (kind === 'customers') {
        for (const v of valid as NormalizedCustomer[]) {
          customers.createCustomer({ name: v.name, email: v.email, phone: v.phone, company: v.company, notes: v.notes, tags: v.tags });
          imported++;
        }
      } else if (kind === 'products') {
        const catCache = new Map<string, string>();
        for (const v of valid as NormalizedProduct[]) {
          let categoryId: string | null = null;
          if (v.category) {
            if (!catCache.has(v.category)) {
              const existing = db.prepare(`SELECT id FROM product_categories WHERE name = ?`).get(v.category) as { id: string } | undefined;
              catCache.set(v.category, existing ? existing.id : products.createCategory(v.category).id);
            }
            categoryId = catCache.get(v.category)!;
          }
          products.createProduct({
            name: v.name, sku: v.sku, description: v.description, category_id: categoryId,
            base_price_cents: v.price_cents, active: v.active, marketplace_id: v.marketplace_id,
          });
          imported++;
        }
      } else {
        imported = applyOrderRows(valid as NormalizedOrderRow[]);
      }
    });
    db.prepare(`UPDATE import_jobs SET status = 'completed', imported_rows = ?, finished_at = ? WHERE id = ?`)
      .run(imported, nowIso(), jobId);
  } catch (e) {
    // Transaction rolled back: nothing was partially written.
    const message = e instanceof Error ? e.message : 'Import failed.';
    db.prepare(`INSERT INTO import_errors (id, import_job_id, row_number, message) VALUES (?, ?, ?, ?)`)
      .run(newId('ime'), jobId, 0, message);
    db.prepare(`UPDATE import_jobs SET status = 'failed', finished_at = ? WHERE id = ?`).run(nowIso(), jobId);
    errors.push({ row: 0, message });
    imported = 0;
  } finally {
    parsedCache.delete(jobId);
  }

  const job2 = db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(jobId) as any;
  return { imported, skipped: job.total_rows - imported - errors.length, errors };
}

/** Group order rows into orders and insert them transactionally. Returns order count. */
function applyOrderRows(rows: NormalizedOrderRow[]): number {
  const db = getDb();
  // Group: explicit order_number groups rows; blank numbers = one order per row.
  const groups = new Map<string, NormalizedOrderRow[]>();
  let blankSeq = 0;
  for (const r of rows) {
    const key = r.order_number ?? `__blank_${blankSeq++}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const customerCache = new Map<string, string>();
  let count = 0;
  for (const group of groups.values()) {
    const first = group[0];
    // Resolve customer: match by email, else create, else null.
    let customerId: string | null = null;
    if (first.customer_email) {
      if (!customerCache.has(first.customer_email)) {
        const existing = db.prepare(`SELECT id FROM customers WHERE LOWER(email) = ? AND deleted_at IS NULL`).get(first.customer_email) as { id: string } | undefined;
        customerId = existing ? existing.id : customers.createCustomer({
          name: first.customer_name || first.customer_email,
          email: first.customer_email,
        }).id;
        customerCache.set(first.customer_email, customerId);
      } else {
        customerId = customerCache.get(first.customer_email)!;
      }
    } else if (first.customer_name) {
      customerId = customers.createCustomer({ name: first.customer_name }).id;
    }
    const created = orders.createOrder({
      customer_id: customerId,
      order_date: first.order_date,
      source: first.source,
      priority: first.priority,
      requested_date: first.requested_date,
      internal_notes: first.internal_notes,
      customer_notes: first.customer_notes,
      tags: first.tags,
      discount_cents: first.discount_cents,
      shipping_cents: first.shipping_cents,
      tax_cents: first.tax_cents,
      ship_recipient: first.ship.recipient,
      ship_line1: first.ship.line1,
      ship_city: first.ship.city,
      ship_state: first.ship.state,
      ship_postal: first.ship.postal,
      ship_country: first.ship.country,
      items: group.map((r) => ({
        description: r.item_description,
        sku: r.item_sku,
        quantity: r.item_quantity,
        unit_price_cents: r.item_unit_price_cents,
        discount_cents: r.item_discount_cents,
        tax_cents: r.item_tax_cents,
      })),
    });
    // If the CSV carried an explicit order number, keep it (duplicates were filtered at validate time).
    if (first.order_number && first.order_number !== created.order_number) {
      db.prepare(`UPDATE orders SET order_number = ? WHERE id = ?`).run(first.order_number, created.id);
    }
    // Imported orders land directly in their CSV status with a history entry.
    if (first.status !== 'draft') {
      // Walk the lifecycle legally to the target status so history stays truthful.
      for (const s of lifecyclePath(first.status)) {
        orders.setOrderStatus(created.id, s, 'Imported from CSV.');
      }
    }
    count++;
  }
  return count;
}

/** A legal lifecycle path from draft to the target status (shortest). */
function lifecyclePath(target: OrderStatus): OrderStatus[] {
  // BFS over the transition graph.
  const prev = new Map<OrderStatus, OrderStatus | null>([['draft', null]]);
  const queue: OrderStatus[] = ['draft'];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) break;
    for (const nxt of ORDER_TRANSITIONS[cur] ?? []) {
      if (!prev.has(nxt)) {
        prev.set(nxt, cur);
        queue.push(nxt);
      }
    }
  }
  if (!prev.has(target)) throw new AppError('VALIDATION', `Status "${target}" is not reachable by import.`);
  const path: OrderStatus[] = [];
  let cur: OrderStatus | null = target;
  while (cur && cur !== 'draft') {
    path.unshift(cur);
    cur = prev.get(cur) ?? null;
  }
  return path;
}

export function getImportJob(jobId: string) {
  const db = getDb();
  const job = db.prepare(`SELECT * FROM import_jobs WHERE id = ?`).get(jobId) as any;
  if (!job) throw new AppError('NOT_FOUND', 'Import job not found.');
  const errors = db.prepare(`SELECT * FROM import_errors WHERE import_job_id = ? ORDER BY row_number`).all(jobId);
  return { ...job, errors };
}
