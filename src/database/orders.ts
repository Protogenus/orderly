import { getDb, tx } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import { computeTotals, lineTotal, assertTransition, nextOrderNumber } from '../domain/orders.js';
import { getSetting, setSetting } from './settings.js';
import type {
  InboxBuckets,
  NewNoteInput,
  NewOrderInput,
  NewOrderItemInput,
  NewPaymentInput,
  Order,
  OrderFilters,
  OrderItem,
  OrderNote,
  OrderStatus,
  OrderStatusEvent,
  Payment,
  UpdateOrderInput,
} from '../shared/types.js';

function rowToOrder(r: any, items: OrderItem[]): Order {
  return {
    ...r,
    tags: JSON.parse(r.tags ?? '[]'),
    archived: r.archived === 1,
    // Derived, never stored: keeps balance consistent with paid_cents.
    balance_cents: (r.grand_total_cents ?? 0) - (r.paid_cents ?? 0),
    items,
  };
}

function loadItems(db: ReturnType<typeof getDb>, orderId: string): OrderItem[] {
  const rows = db
    .prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY position, rowid`)
    .all(orderId) as any[];
  return rows.map((r) => ({ ...r, requires_production: r.requires_production === 1 }));
}

function customerName(db: ReturnType<typeof getDb>, customerId: string | null): string | null {
  if (!customerId) return null;
  const row = db.prepare(`SELECT name FROM customers WHERE id = ?`).get(customerId) as { name: string } | undefined;
  return row?.name ?? null;
}

function buildOrder(db: ReturnType<typeof getDb>, orderId: string): Order {
  const row = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
  if (!row) throw new AppError('NOT_FOUND', 'Order not found.');
  const order = rowToOrder(row, loadItems(db, orderId));
  order.customer_name = customerName(db, row.customer_id);
  return order;
}

function totalsFor(items: NewOrderItemInput[], discount: number, shipping: number, tax: number, paid: number) {
  const t = computeTotals(
    {
      items: items.map((i) => ({
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        discount_cents: i.discount_cents ?? 0,
        tax_cents: i.tax_cents ?? 0,
      })),
      discount_cents: discount,
      shipping_cents: shipping,
      tax_cents: tax,
      paid_cents: paid,
    },
  );
  if (t.grand_total_cents < 0) throw new AppError('VALIDATION', 'Order total cannot be negative.');
  return t;
}

function insertItems(db: ReturnType<typeof getDb>, orderId: string, items: NewOrderItemInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO order_items (id, order_id, product_id, variant_id, description, sku, quantity,
      unit_price_cents, discount_cents, tax_cents, line_total_cents, requires_production, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  items.forEach((item, idx) => {
    const lt = lineTotal({
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      discount_cents: item.discount_cents ?? 0,
      tax_cents: item.tax_cents ?? 0,
    });
    stmt.run(
      newId('oit'),
      orderId,
      item.product_id ?? null,
      item.variant_id ?? null,
      item.description,
      item.sku ?? null,
      item.quantity,
      item.unit_price_cents,
      item.discount_cents ?? 0,
      item.tax_cents ?? 0,
      lt,
      item.requires_production ? 1 : 0,
      idx,
    );
  });
}

function recordStatus(db: ReturnType<typeof getDb>, orderId: string, from: OrderStatus | null, to: OrderStatus, note?: string | null): void {
  db.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId('osh'), orderId, from, to, note ?? null, nowIso());
}

export function createOrder(input: NewOrderInput): Order {
  if (input.items.length === 0) throw new AppError('VALIDATION', 'An order must have at least one item.');
  return tx((db) => {
    const prefix = getSetting('order_number_prefix') ?? 'ORD-';
    const next = parseInt(getSetting('order_number_next') ?? '1001', 10);
    const { order_number, next_counter } = nextOrderNumber(prefix, next);
    const totals = totalsFor(input.items, input.discount_cents ?? 0, input.shipping_cents ?? 0, input.tax_cents ?? 0, 0);
    const now = nowIso();
    const id = newId('ord');
    db.prepare(
      `INSERT INTO orders (id, order_number, order_date, customer_id, source, status, priority,
        requested_date, internal_notes, customer_notes, tags,
        subtotal_cents, discount_cents, shipping_cents, tax_cents, grand_total_cents, paid_cents, payment_status,
        ship_recipient, ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country, ship_method,
        archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run(
      id, order_number, input.order_date, input.customer_id ?? null, input.source ?? 'Manual',
      input.priority ?? 'normal', input.requested_date ?? null, input.internal_notes ?? null,
      input.customer_notes ?? null, JSON.stringify(input.tags ?? []),
      totals.subtotal_cents, totals.discount_cents, totals.shipping_cents, totals.tax_cents,
      totals.grand_total_cents, totals.payment_status,
      input.ship_recipient ?? null, input.ship_line1 ?? null, input.ship_line2 ?? null,
      input.ship_city ?? null, input.ship_state ?? null, input.ship_postal ?? null,
      input.ship_country ?? null, input.ship_method ?? null,
      now, now,
    );
    insertItems(db, id, input.items);
    recordStatus(db, id, null, 'draft', 'Order created.');
    setSetting('order_number_next', String(next_counter));
    return buildOrder(db, id);
  });
}

const UPDATABLE = [
  'customer_id', 'order_date', 'source', 'priority', 'requested_date', 'internal_notes',
  'customer_notes', 'tags', 'discount_cents', 'shipping_cents', 'tax_cents',
  'ship_recipient', 'ship_line1', 'ship_line2', 'ship_city', 'ship_state',
  'ship_postal', 'ship_country', 'ship_method',
] as const;

export function updateOrder(id: string, patch: UpdateOrderInput): Order {
  return tx((db) => {
    const existing = buildOrder(db, id);
    if (existing.status === 'canceled' || existing.status === 'completed') {
      throw new AppError('CONFLICT', `A ${existing.status} order cannot be edited. Duplicate it to create a new order.`);
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    for (const col of UPDATABLE) {
      const v = (patch as any)[col];
      if (v !== undefined) {
        fields.push(`${col} = ?`);
        params.push(col === 'tags' ? JSON.stringify(v) : v);
      }
    }
    const items = patch.items ?? existing.items.map((i) => ({
      product_id: i.product_id,
      variant_id: i.variant_id,
      description: i.description,
      sku: i.sku,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      discount_cents: i.discount_cents,
      tax_cents: i.tax_cents,
      requires_production: i.requires_production,
    }));
    if (items.length === 0) throw new AppError('VALIDATION', 'An order must have at least one item.');
    const totals = totalsFor(
      items,
      (patch.discount_cents ?? existing.discount_cents),
      (patch.shipping_cents ?? existing.shipping_cents),
      (patch.tax_cents ?? existing.tax_cents),
      existing.paid_cents,
    );
    fields.push('subtotal_cents = ?', 'discount_cents = ?', 'shipping_cents = ?', 'tax_cents = ?',
      'grand_total_cents = ?', 'payment_status = ?', 'updated_at = ?');
    params.push(totals.subtotal_cents, totals.discount_cents, totals.shipping_cents, totals.tax_cents,
      totals.grand_total_cents, totals.payment_status, nowIso(), id);
    db.prepare(`UPDATE orders SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    if (patch.items !== undefined) {
      db.prepare(`DELETE FROM order_items WHERE order_id = ?`).run(id);
      insertItems(db, id, patch.items);
    }
    return buildOrder(db, id);
  });
}

export function setOrderStatus(id: string, to: OrderStatus, note?: string | null): Order {
  return tx((db) => {
    const order = buildOrder(db, id);
    assertTransition(order.status, to);
    if (order.status !== to) {
      db.prepare(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`).run(to, nowIso(), id);
      recordStatus(db, id, order.status, to, note);
    }
    return buildOrder(db, id);
  });
}

export function cancelOrder(id: string, note?: string | null): Order {
  return tx((db) => {
    const order = buildOrder(db, id);
    if (order.status === 'completed' || order.status === 'delivered') {
      throw new AppError('CONFLICT', 'A delivered or completed order cannot be canceled. Use a return instead.');
    }
    assertTransition(order.status, 'canceled');
    db.prepare(`UPDATE orders SET status = 'canceled', updated_at = ? WHERE id = ?`).run(nowIso(), id);
    recordStatus(db, id, order.status, 'canceled', note ?? 'Order canceled.');
    return buildOrder(db, id);
  });
}

export function archiveOrder(id: string, archived: boolean): Order {
  return tx((db) => {
    buildOrder(db, id);
    db.prepare(`UPDATE orders SET archived = ?, updated_at = ? WHERE id = ?`).run(archived ? 1 : 0, nowIso(), id);
    return buildOrder(db, id);
  });
}

export function duplicateOrder(id: string): Order {
  return tx((db) => {
    const src = buildOrder(db, id);
    const input: NewOrderInput = {
      customer_id: src.customer_id,
      order_date: new Date().toISOString().slice(0, 10),
      source: src.source,
      priority: src.priority,
      requested_date: src.requested_date,
      internal_notes: src.internal_notes,
      customer_notes: src.customer_notes,
      tags: src.tags,
      discount_cents: src.discount_cents,
      shipping_cents: src.shipping_cents,
      tax_cents: src.tax_cents,
      ship_recipient: src.ship_recipient,
      ship_line1: src.ship_line1,
      ship_line2: src.ship_line2,
      ship_city: src.ship_city,
      ship_state: src.ship_state,
      ship_postal: src.ship_postal,
      ship_country: src.ship_country,
      ship_method: src.ship_method,
      items: src.items.map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id,
        description: i.description,
        sku: i.sku,
        quantity: i.quantity,
        unit_price_cents: i.unit_price_cents,
        discount_cents: i.discount_cents,
        tax_cents: i.tax_cents,
        requires_production: i.requires_production,
      })),
    };
    return createOrder(input);
  });
}

export function listOrders(f: OrderFilters = {}): { rows: (Order & { item_count: number })[]; total: number } {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (!f.include_archived) where.push(`o.archived = 0`);
  if (f.statuses?.length) {
    where.push(`o.status IN (${f.statuses.map(() => '?').join(',')})`);
    params.push(...f.statuses);
  }
  if (f.customer_id) {
    where.push(`o.customer_id = ?`);
    params.push(f.customer_id);
  }
  if (f.source) {
    where.push(`o.source = ?`);
    params.push(f.source);
  }
  if (f.overdue) {
    where.push(`o.requested_date IS NOT NULL AND date(o.requested_date) < date('now') AND o.status NOT IN ('completed','canceled','delivered')`);
  }
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    where.push(`(o.order_number LIKE ? OR c.name LIKE ? OR o.internal_notes LIKE ?)`);
    params.push(q, q, q);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereSql}`).get(...params) as { n: number }).n;
  const sortCol = { order_date: 'o.order_date', order_number: 'o.order_number', grand_total_cents: 'o.grand_total_cents', requested_date: 'o.requested_date', updated_at: 'o.updated_at' }[f.sort ?? 'order_date'];
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(f.limit ?? 100, 500);
  const offset = f.offset ?? 0;
  const rows = db
    .prepare(
      `SELECT o.*, c.name AS customer_name, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
         ${whereSql} ORDER BY ${sortCol} ${dir} LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as any[];
  return {
    total,
    rows: rows.map((r) => ({ ...rowToOrder(r, []), customer_name: r.customer_name ?? null, item_count: r.item_count })),
  };
}

export function getOrder(id: string): Order {
  return tx((db) => buildOrder(db, id));
}

export function getStatusHistory(orderId: string): OrderStatusEvent[] {
  return getDb()
    .prepare(`SELECT * FROM order_status_history WHERE order_id = ? ORDER BY created_at`)
    .all(orderId) as OrderStatusEvent[];
}

export function addNote(orderId: string, input: NewNoteInput): OrderNote {
  return tx((db) => {
    buildOrder(db, orderId);
    const note: OrderNote = { id: newId('ont'), order_id: orderId, kind: input.kind, body: input.body, created_at: nowIso() };
    db.prepare(`INSERT INTO order_notes (id, order_id, kind, body, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(note.id, note.order_id, note.kind, note.body, note.created_at);
    return note;
  });
}

export function listNotes(orderId: string): OrderNote[] {
  return getDb()
    .prepare(`SELECT * FROM order_notes WHERE order_id = ? ORDER BY created_at DESC`)
    .all(orderId) as OrderNote[];
}

export function addPayment(orderId: string, input: NewPaymentInput): { payment: Payment; order: Order } {
  return tx((db) => {
    const order = buildOrder(db, orderId);
    const payment: Payment = {
      id: newId('pay'),
      order_id: orderId,
      amount_cents: input.amount_cents,
      method: input.method ?? null,
      reference: input.reference ?? null,
      paid_at: input.paid_at,
      note: input.note ?? null,
      created_at: nowIso(),
    };
    db.prepare(`INSERT INTO payments (id, order_id, amount_cents, method, reference, paid_at, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(payment.id, payment.order_id, payment.amount_cents, payment.method, payment.reference, payment.paid_at, payment.note, payment.created_at);
    const paid = order.paid_cents + input.amount_cents;
    const totals = computeTotals(
      {
        items: order.items.map((i) => ({ quantity: i.quantity, unit_price_cents: i.unit_price_cents, discount_cents: i.discount_cents, tax_cents: i.tax_cents })),
        discount_cents: order.discount_cents,
        shipping_cents: order.shipping_cents,
        tax_cents: order.tax_cents,
        paid_cents: paid,
      },
    );
    db.prepare(`UPDATE orders SET paid_cents = ?, payment_status = ?, updated_at = ? WHERE id = ?`)
      .run(paid, totals.payment_status, nowIso(), orderId);
    return { payment, order: buildOrder(db, orderId) };
  });
}

export function listPayments(orderId: string): Payment[] {
  return getDb()
    .prepare(`SELECT * FROM payments WHERE order_id = ? ORDER BY paid_at DESC, created_at DESC`)
    .all(orderId) as Payment[];
}

/** Inbox attention buckets, all computed from live records. */
export function inboxBuckets(): InboxBuckets {
  const db = getDb();
  const base = `SELECT o.*, c.name AS customer_name, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
      FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
     WHERE o.archived = 0`;
  const map = (rows: any[]) =>
    rows.map((r) => ({ ...rowToOrder(r, []), customer_name: r.customer_name ?? null, item_count: r.item_count }));
  const open = `o.status NOT IN ('completed','canceled','delivered')`;
  return {
    unreviewed: map(db.prepare(`${base} AND o.status = 'new' ORDER BY o.created_at DESC`).all()),
    missing_info: map(
      db.prepare(`${base} AND ${open} AND (o.customer_id IS NULL OR o.ship_line1 IS NULL OR NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id = o.id)) ORDER BY o.updated_at DESC`).all(),
    ),
    payment_issues: map(
      db.prepare(`${base} AND ${open} AND o.payment_status IN ('unpaid','partial') AND o.grand_total_cents > 0 AND o.status NOT IN ('draft','new') ORDER BY o.order_date`).all(),
    ),
    approaching_due: map(
      db.prepare(`${base} AND ${open} AND o.requested_date IS NOT NULL AND date(o.requested_date) BETWEEN date('now') AND date('now','+3 days') ORDER BY o.requested_date`).all(),
    ),
    needs_attention: map(
      db.prepare(`${base} AND ${open} AND (o.priority IN ('high','urgent') OR (o.requested_date IS NOT NULL AND date(o.requested_date) < date('now'))) ORDER BY o.requested_date`).all(),
    ),
  };
}
