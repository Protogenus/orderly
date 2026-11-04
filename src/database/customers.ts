import { getDb, tx } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import type {
  Customer,
  CustomerAddress,
  CustomerProfile,
  NewAddressInput,
  NewCustomerInput,
  UpdateCustomerInput,
} from '../shared/types.js';

function rowToCustomer(r: any): Customer {
  return {
    ...r,
    tags: JSON.parse(r.tags ?? '[]'),
  };
}

export function listCustomers(search = '', includeDeleted = false): Customer[] {
  const db = getDb();
  let sql = `SELECT * FROM customers WHERE 1=1`;
  const params: unknown[] = [];
  if (!includeDeleted) sql += ` AND deleted_at IS NULL`;
  if (search.trim()) {
    sql += ` AND (name LIKE ? OR email LIKE ? OR company LIKE ? OR phone LIKE ?)`;
    const q = `%${search.trim()}%`;
    params.push(q, q, q, q);
  }
  sql += ` ORDER BY name COLLATE NOCASE`;
  return (db.prepare(sql).all(...params) as any[]).map(rowToCustomer);
}

export function getCustomer(id: string): Customer {
  const row = getDb().prepare(`SELECT * FROM customers WHERE id = ?`).get(id) as any;
  if (!row || row.deleted_at) throw new AppError('NOT_FOUND', 'Customer not found.');
  return rowToCustomer(row);
}

export function getCustomerProfile(id: string): CustomerProfile {
  const customer = getCustomer(id);
  const db = getDb();
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(grand_total_cents), 0) AS total,
              COALESCE(SUM(CASE WHEN status != 'canceled' THEN grand_total_cents - paid_cents ELSE 0 END), 0) AS outstanding
         FROM orders WHERE customer_id = ? AND archived = 0`,
    )
    .get(id) as { n: number; total: number; outstanding: number };
  const recent = db
    .prepare(
      `SELECT oi.description AS product_name, o.order_date AS purchased_at
         FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.customer_id = ? AND o.archived = 0
        ORDER BY o.order_date DESC LIMIT 8`,
    )
    .all(id) as { product_name: string; purchased_at: string }[];
  return {
    ...customer,
    order_count: stats.n,
    total_sales_cents: stats.total,
    average_order_cents: stats.n > 0 ? Math.round(stats.total / stats.n) : 0,
    outstanding_cents: stats.outstanding,
    recent_products: recent,
  };
}

/** Warn about accidental duplicates: customers sharing an email address. */
export function findDuplicateEmails(email: string, excludeId?: string): Customer[] {
  const db = getDb();
  const params: unknown[] = [email.toLowerCase()];
  let sql = `SELECT * FROM customers WHERE LOWER(email) = ? AND deleted_at IS NULL`;
  if (excludeId) {
    sql += ` AND id != ?`;
    params.push(excludeId);
  }
  return (db.prepare(sql).all(...params) as any[]).map(rowToCustomer);
}

export function createCustomer(input: NewCustomerInput): Customer {
  return tx((db) => {
    const now = nowIso();
    const c: Customer = {
      id: newId('cus'),
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      company: input.company ?? null,
      notes: input.notes ?? null,
      tags: input.tags ?? [],
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    db.prepare(
      `INSERT INTO customers (id, name, email, phone, company, notes, tags, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(c.id, c.name, c.email, c.phone, c.company, c.notes, JSON.stringify(c.tags), c.created_at, c.updated_at);
    return c;
  });
}

export function updateCustomer(id: string, patch: UpdateCustomerInput): Customer {
  return tx((db) => {
    getCustomer(id); // throws if missing
    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, v: unknown) => {
      fields.push(`${col} = ?`);
      params.push(v);
    };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.email !== undefined) set('email', patch.email);
    if (patch.phone !== undefined) set('phone', patch.phone);
    if (patch.company !== undefined) set('company', patch.company);
    if (patch.notes !== undefined) set('notes', patch.notes);
    if (patch.tags !== undefined) set('tags', JSON.stringify(patch.tags));
    set('updated_at', nowIso());
    params.push(id);
    db.prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    return getCustomer(id);
  });
}

/** Soft delete — order history keeps pointing at the record. */
export function deleteCustomer(id: string): void {
  tx((db) => {
    getCustomer(id);
    const open = db
      .prepare(`SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND archived = 0 AND status NOT IN ('completed','canceled')`)
      .get(id) as { n: number };
    if (open.n > 0) {
      throw new AppError(
        'CONFLICT',
        `This customer has ${open.n} open order(s). Archive or complete them before removing the customer.`,
      );
    }
    db.prepare(`UPDATE customers SET deleted_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), id);
  });
}

export function listAddresses(customerId: string): CustomerAddress[] {
  return getDb()
    .prepare(`SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY kind, created_at`)
    .all(customerId) as CustomerAddress[];
}

export function addAddress(customerId: string, input: NewAddressInput): CustomerAddress {
  return tx((db) => {
    getCustomer(customerId);
    const a: CustomerAddress = {
      id: newId('adr'),
      customer_id: customerId,
      kind: input.kind,
      label: input.label ?? null,
      recipient: input.recipient ?? null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state ?? null,
      postal_code: input.postal_code ?? null,
      country: input.country ?? 'US',
      created_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO customer_addresses (id, customer_id, kind, label, recipient, line1, line2, city, state, postal_code, country, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(a.id, a.customer_id, a.kind, a.label, a.recipient, a.line1, a.line2, a.city, a.state, a.postal_code, a.country, a.created_at);
    return a;
  });
}

export function deleteAddress(id: string): void {
  const r = getDb().prepare(`DELETE FROM customer_addresses WHERE id = ?`).run(id);
  if (r.changes === 0) throw new AppError('NOT_FOUND', 'Address not found.');
}
