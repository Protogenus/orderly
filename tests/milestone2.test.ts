import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-m2-'));
  process.env.ORDERLY_DATA_DIR = dir;
});

afterEach(async () => {
  process.env.ORDERLY_DATA_DIR = '';
  const idx = await import('../src/database/index.js');
  idx.closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

async function db() {
  const idx = await import('../src/database/index.js');
  idx.openDatabase();
  return idx;
}

describe('customers', () => {
  it('creates, profiles, warns on duplicate email, soft-deletes', async () => {
    await db();
    const c = await import('../src/database/customers.js');
    const a = c.createCustomer({ name: 'Jane Doe', email: 'jane@example.com', tags: ['wholesale'] });
    expect(a.id.startsWith('cus_')).toBe(true);
    expect(a.tags).toEqual(['wholesale']);

    const b = c.createCustomer({ name: 'Jane D.', email: 'JANE@example.com' });
    const dups = c.findDuplicateEmails('jane@example.com', b.id);
    expect(dups.map((d) => d.id)).toContain(a.id);
    expect(c.findDuplicateEmails('jane@example.com', a.id).map((d) => d.id)).not.toContain(a.id);

    const profile = c.getCustomerProfile(a.id);
    expect(profile.order_count).toBe(0);
    expect(profile.total_sales_cents).toBe(0);

    const addr = c.addAddress(a.id, { kind: 'shipping', line1: '1 Main St', city: 'Austin', state: 'TX' });
    expect(addr.id.startsWith('adr_')).toBe(true);
    expect(c.listAddresses(a.id)).toHaveLength(1);

    c.deleteCustomer(a.id);
    expect(() => c.getCustomer(a.id)).toThrow(/not found/i);
    // soft delete: row still present
    const idx = await import('../src/database/index.js');
    const row = idx.getDb().prepare('SELECT deleted_at FROM customers WHERE id = ?').get(a.id) as { deleted_at: string };
    expect(row.deleted_at).toBeTruthy();
  });

  it('refuses to delete a customer with open orders', async () => {
    await db();
    const c = await import('../src/database/customers.js');
    const o = await import('../src/database/orders.js');
    const cus = c.createCustomer({ name: 'Open Orders Inc' });
    o.createOrder({
      customer_id: cus.id,
      order_date: '2026-11-04',
      items: [{ description: 'Candle', quantity: 2, unit_price_cents: 1500 }],
    });
    expect(() => c.deleteCustomer(cus.id)).toThrow(/open order/i);
  });
});

describe('products', () => {
  it('creates products with variants, categories, and soft delete', async () => {
    await db();
    const p = await import('../src/database/products.js');
    const cat = p.createCategory('Candles');
    expect(() => p.createCategory('Candles')).toThrow(/already exists/i);
    const prod = p.createProduct({ name: 'Soy Candle', sku: 'CAND-001', category_id: cat.id, base_price_cents: 1800 });
    expect(prod.id.startsWith('prd_')).toBe(true);
    const v = p.createVariant(prod.id, { name: 'Lavender 8oz', sku: 'CAND-001-LAV', price_cents: 2000, attributes: { scent: 'Lavender', size: '8oz' } });
    expect(v.attributes).toEqual({ scent: 'Lavender', size: '8oz' });
    const full = p.getProduct(prod.id);
    expect(full.variants).toHaveLength(1);
    expect(full.category_name).toBe('Candles');
    p.deleteProduct(prod.id);
    expect(p.listProducts()).toHaveLength(0);
    expect(p.listProducts({ activeOnly: false })).toHaveLength(0);
  });
});

describe('orders', () => {
  it('creates an order with correct cents totals and sequential numbering', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    const c = await import('../src/database/customers.js');
    const cus = c.createCustomer({ name: 'Buyer One' });
    const order = o.createOrder({
      customer_id: cus.id,
      order_date: '2026-11-04',
      source: 'Etsy',
      priority: 'high',
      items: [
        { description: 'Candle', quantity: 2, unit_price_cents: 1500, discount_cents: 100 },
        { description: 'Soap', quantity: 3, unit_price_cents: 800, tax_cents: 48 },
      ],
      shipping_cents: 595,
      tax_cents: 120,
    });
    expect(order.order_number).toBe('ORD-1001');
    // subtotal = (2*1500-100) + (3*800) = 2900 + 2400 = 5300
    expect(order.subtotal_cents).toBe(5300);
    // grand = 5300 + 120 + 595 = 6015
    expect(order.grand_total_cents).toBe(6015);
    expect(order.balance_cents).toBe(6015);
    expect(order.payment_status).toBe('unpaid');
    expect(order.items).toHaveLength(2);
    expect(order.items[0].line_total_cents).toBe(2900);
    expect(order.status).toBe('draft');
    expect(order.customer_name).toBe('Buyer One');

    const order2 = o.createOrder({
      order_date: '2026-11-04',
      items: [{ description: 'Widget', quantity: 1, unit_price_cents: 100 }],
    });
    expect(order2.order_number).toBe('ORD-1002');
  });

  it('rejects empty orders', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    expect(() => o.createOrder({ order_date: '2026-11-04', items: [] })).toThrow(/at least one item/i);
  });

  it('enforces the lifecycle and appends history', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    const order = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'X', quantity: 1, unit_price_cents: 100 }] });
    // draft -> shipped is illegal (must go through new/confirmed/...)
    expect(() => o.setOrderStatus(order.id, 'shipped')).toThrow(/cannot move/i);
    const moved = o.setOrderStatus(order.id, 'new', 'Reviewed.');
    expect(moved.status).toBe('new');
    const hist = o.getStatusHistory(order.id);
    expect(hist.map((h) => h.to_status)).toEqual(['draft', 'new']);
    expect(hist[1].from_status).toBe('draft');
    expect(hist[1].note).toBe('Reviewed.');
    // same-status set is a no-op (no duplicate history row)
    o.setOrderStatus(order.id, 'new');
    expect(o.getStatusHistory(order.id)).toHaveLength(2);
  });

  it('tracks payments and derives payment status', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    const order = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'X', quantity: 1, unit_price_cents: 1000 }] });
    let r = o.addPayment(order.id, { amount_cents: 400, paid_at: '2026-11-04', method: 'Card' });
    expect(r.order.paid_cents).toBe(400);
    expect(r.order.payment_status).toBe('partial');
    expect(r.order.balance_cents).toBe(600);
    r = o.addPayment(order.id, { amount_cents: 600, paid_at: '2026-11-04' });
    expect(r.order.payment_status).toBe('paid');
    expect(r.order.balance_cents).toBe(0);
    expect(o.listPayments(order.id)).toHaveLength(2);
  });

  it('duplicates, archives, cancels, and filters', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    const order = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'X', quantity: 1, unit_price_cents: 500 }] });
    const dup = o.duplicateOrder(order.id);
    expect(dup.order_number).not.toBe(order.order_number);
    expect(dup.status).toBe('draft');
    expect(dup.items).toHaveLength(1);

    o.setOrderStatus(order.id, 'new');
    const canceled = o.cancelOrder(order.id, 'Customer asked to cancel.');
    expect(canceled.status).toBe('canceled');

    const archived = o.archiveOrder(dup.id, true);
    expect(archived.archived).toBe(true);
    const listed = o.listOrders({});
    expect(listed.rows.map((r) => r.id)).not.toContain(dup.id);
    expect(o.listOrders({ include_archived: true }).total).toBe(2);

    const byStatus = o.listOrders({ statuses: ['canceled'] });
    expect(byStatus.rows.map((r) => r.id)).toContain(order.id);
  });

  it('computes inbox attention buckets from live data', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    // unreviewed
    const u = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'A', quantity: 1, unit_price_cents: 100 }] });
    o.setOrderStatus(u.id, 'new');
    // missing info (no customer, no shipping)
    const m = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'B', quantity: 1, unit_price_cents: 100 }] });
    o.setOrderStatus(m.id, 'new');
    o.setOrderStatus(m.id, 'confirmed');
    // overdue (requested date in the past)
    const od = o.createOrder({ order_date: '2026-10-01', requested_date: '2026-10-15', items: [{ description: 'C', quantity: 1, unit_price_cents: 100 }] });
    o.setOrderStatus(od.id, 'new');
    o.setOrderStatus(od.id, 'confirmed');

    const buckets = o.inboxBuckets();
    expect(buckets.unreviewed.map((x) => x.id)).toContain(u.id);
    expect(buckets.missing_info.map((x) => x.id)).toContain(m.id);
    expect(buckets.needs_attention.map((x) => x.id)).toContain(od.id);
    const overdue = o.listOrders({ overdue: true });
    expect(overdue.rows.map((x) => x.id)).toContain(od.id);
  });

  it('notes round-trip', async () => {
    await db();
    const o = await import('../src/database/orders.js');
    const order = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'X', quantity: 1, unit_price_cents: 100 }] });
    o.addNote(order.id, { kind: 'internal', body: 'Pack carefully.' });
    const notes = o.listNotes(order.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe('Pack carefully.');
  });
});

describe('lifecycle domain', () => {
  it('computeTotals never uses floats', async () => {
    const { computeTotals } = await import('../src/domain/orders.js');
    const t = computeTotals({
      items: [
        { quantity: 3, unit_price_cents: 1999, discount_cents: 0, tax_cents: 0 },
        { quantity: 1, unit_price_cents: 50, discount_cents: 10, tax_cents: 3 },
      ],
      discount_cents: 100,
      shipping_cents: 595,
      tax_cents: 0,
      paid_cents: 0,
    });
    // (3*1999) + (50-10) = 5997 + 40 = 6037 subtotal; grand = 6037 - 100 + 595 = 6532
    expect(t.subtotal_cents).toBe(6037);
    expect(t.grand_total_cents).toBe(6532);
    expect(Number.isInteger(t.grand_total_cents)).toBe(true);
  });
});
