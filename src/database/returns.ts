import { getDb, tx } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import { canTransitionReturn } from '../shared/constants.js';
import type { ReturnItemDetail, ReturnRecord, ReturnStatus } from '../shared/types.js';

type Db = ReturnType<typeof getDb>;

export interface NewReturnItemInput {
  order_item_id: string;
  quantity: number;
  reason?: string | null;
}

export interface NewReturnInput {
  reason?: string | null;
  internal_notes?: string | null;
  items: NewReturnItemInput[];
}

function itemsFor(db: Db, returnId: string): ReturnItemDetail[] {
  return db
    .prepare(
      `SELECT ri.*, oi.description, oi.sku, oi.quantity AS quantity_ordered
         FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.return_id = ?`,
    )
    .all(returnId) as ReturnItemDetail[];
}

function rowToReturn(db: Db, r: any): ReturnRecord {
  return { ...r, items: itemsFor(db, r.id) };
}

/** Quantity of an order item already tied up in non-rejected returns. */
function returnedQty(db: Db, orderItemId: string, excludeReturnId?: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(ri.quantity), 0) AS n FROM return_items ri
        JOIN returns r ON r.id = ri.return_id
       WHERE ri.order_item_id = ? AND r.status != 'rejected' ${excludeReturnId ? 'AND r.id != ?' : ''}`,
    )
    .get(orderItemId, ...(excludeReturnId ? [excludeReturnId] : [])) as { n: number };
  return row.n;
}

export function createReturn(orderId: string, input: NewReturnInput): ReturnRecord {
  return tx((db) => {
    const order = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(orderId) as any;
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    if (input.items.length === 0) throw new AppError('VALIDATION', 'A return must include at least one item.');
    const orderItems = new Map(
      (db.prepare(`SELECT id, quantity FROM order_items WHERE order_id = ?`).all(orderId) as { id: string; quantity: number }[]).map((i) => [i.id, i.quantity]),
    );
    for (const it of input.items) {
      const max = orderItems.get(it.order_item_id);
      if (max === undefined) throw new AppError('VALIDATION', 'A returned item does not belong to this order.');
      if (!Number.isInteger(it.quantity) || it.quantity < 1) {
        throw new AppError('VALIDATION', 'Return quantity must be a whole number of at least 1.');
      }
      const available = max - returnedQty(db, it.order_item_id);
      if (it.quantity > available) {
        throw new AppError('VALIDATION', `Only ${available} of that item can still be returned (ordered ${max}).`);
      }
    }
    const now = nowIso();
    const id = newId('ret');
    db.prepare(
      `INSERT INTO returns (id, order_id, status, reason, internal_notes, created_at, updated_at)
       VALUES (?, ?, 'requested', ?, ?, ?, ?)`,
    ).run(id, orderId, input.reason ?? null, input.internal_notes ?? null, now, now);
    const stmt = db.prepare(`INSERT INTO return_items (id, return_id, order_item_id, quantity, reason) VALUES (?, ?, ?, ?, ?)`);
    for (const it of input.items) {
      stmt.run(newId('rti'), id, it.order_item_id, it.quantity, it.reason ?? null);
    }
    return rowToReturn(db, db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id));
  });
}

export function getReturn(id: string): ReturnRecord {
  return tx((db) => {
    const row = db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id) as any;
    if (!row) throw new AppError('NOT_FOUND', 'Return not found.');
    return rowToReturn(db, row);
  });
}

export interface ReturnFilters {
  status?: ReturnStatus;
  search?: string;
}

export function listReturns(f: ReturnFilters = {}): (ReturnRecord & { order_number: string; customer_name: string | null })[] {
  const db = getDb();
  let sql = `SELECT r.*, o.order_number, c.name AS customer_name
               FROM returns r JOIN orders o ON o.id = r.order_id
               LEFT JOIN customers c ON c.id = o.customer_id WHERE 1=1`;
  const params: unknown[] = [];
  if (f.status) {
    sql += ` AND r.status = ?`;
    params.push(f.status);
  }
  if (f.search?.trim()) {
    sql += ` AND (o.order_number LIKE ? OR c.name LIKE ?)`;
    const q = `%${f.search.trim()}%`;
    params.push(q, q);
  }
  sql += ` ORDER BY r.created_at DESC LIMIT 200`;
  return tx((db2) => (db2.prepare(sql).all(...params) as any[]).map((r) => ({ ...rowToReturn(db2, r), order_number: r.order_number, customer_name: r.customer_name ?? null })));
}

export function updateReturnStatus(id: string, to: ReturnStatus): ReturnRecord {
  return tx((db) => {
    const row = db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id) as any;
    if (!row) throw new AppError('NOT_FOUND', 'Return not found.');
    const from = row.status as ReturnStatus;
    if (from !== to) {
      if (!canTransitionReturn(from, to)) {
        throw new AppError('ILLEGAL_TRANSITION', `Cannot move a return from "${from}" to "${to}".`);
      }
      db.prepare(`UPDATE returns SET status = ?, updated_at = ? WHERE id = ?`).run(to, nowIso(), id);
    }
    return rowToReturn(db, db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id));
  });
}

export interface UpdateReturnPatch {
  reason?: string | null;
  refund_status?: string | null;
  internal_notes?: string | null;
  replacement_order_id?: string | null;
}

export function updateReturn(id: string, patch: UpdateReturnPatch): ReturnRecord {
  return tx((db) => {
    const row = db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id) as any;
    if (!row) throw new AppError('NOT_FOUND', 'Return not found.');
    if (patch.replacement_order_id) {
      const target = db.prepare(`SELECT id FROM orders WHERE id = ?`).get(patch.replacement_order_id) as any;
      if (!target) throw new AppError('NOT_FOUND', 'Replacement order not found.');
      if (patch.replacement_order_id === row.order_id) {
        throw new AppError('VALIDATION', 'The replacement order cannot be the original order.');
      }
    }
    const fields: string[] = [];
    const params: unknown[] = [];
    if (patch.reason !== undefined) {
      fields.push('reason = ?');
      params.push(patch.reason);
    }
    if (patch.refund_status !== undefined) {
      fields.push('refund_status = ?');
      params.push(patch.refund_status);
    }
    if (patch.internal_notes !== undefined) {
      fields.push('internal_notes = ?');
      params.push(patch.internal_notes);
    }
    if (patch.replacement_order_id !== undefined) {
      fields.push('replacement_order_id = ?');
      params.push(patch.replacement_order_id);
    }
    fields.push('updated_at = ?');
    params.push(nowIso(), id);
    db.prepare(`UPDATE returns SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return rowToReturn(db, db.prepare(`SELECT * FROM returns WHERE id = ?`).get(id));
  });
}
