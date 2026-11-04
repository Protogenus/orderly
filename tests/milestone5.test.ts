import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-m5-'));
  process.env.ORDERLY_DATA_DIR = dir;
});

afterEach(async () => {
  process.env.ORDERLY_DATA_DIR = '';
  const idx = await import('../src/database/index.js');
  idx.closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

async function setup() {
  const idx = await import('../src/database/index.js');
  idx.openDatabase();
  const imports = await import('../src/database/imports.js');
  const dashboard = await import('../src/database/dashboard.js');
  const reports = await import('../src/database/reports.js');
  const exportsMod = await import('../src/database/exports.js');
  const csv = await import('../src/domain/csv.js');
  const db = await import('../src/database/index.js');
  return { imports, dashboard, reports, exportsMod, csv, db };
}

function writeCsv(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content, 'utf-8');
  return p;
}

// ---------------- csv.ts ----------------

describe('csv parsing', () => {
  it('parses quoted commas, BOM, and rejects empty files', async () => {
    const { csv } = await setup();
    const p = writeCsv('a.csv', '\uFEFFname,email\n"Acme, Inc.",a@x.com\nBob,b@x.com\n');
    const parsed = csv.parseCsvFile(p);
    expect(parsed.columns).toEqual(['name', 'email']);
    expect(parsed.rows[0].name).toBe('Acme, Inc.');
    expect(parsed.totalRows).toBe(2);
    const bad = writeCsv('bad.csv', 'onlyheaders\n');
    expect(() => csv.parseCsvFile(bad)).toThrow(/no data rows/i);
  });

  it('auto-maps common header spellings', async () => {
    const { csv } = await setup();
    expect(csv.autoMap(['Customer Name', 'E-mail', 'Phone'], 'customers').name).toBe('Customer Name');
    expect(csv.autoMap(['Customer Name', 'E-mail', 'Phone'], 'customers').email).toBe('E-mail');
    expect(csv.autoMap(['x'], 'customers').name).toBeNull();
  });

  it('round-trips through toCsv escaping', async () => {
    const { csv } = await setup();
    const out = csv.toCsv(['a', 'b'], [['x, y', 'say "hi"'], ['plain', 3]]);
    expect(out).toContain('"x, y"');
    expect(out).toContain('"say ""hi"""');
  });
});

// ---------------- imports ----------------

describe('customer import', () => {
  it('validates, warns on duplicates, and imports cleanly', async () => {
    const { imports } = await setup();
    const p = writeCsv('cust.csv',
      'name,email,phone\nAlice,a@x.com,555\nBad Email,not-an-email,\nAlice 2,A@X.COM,\n');
    const a = imports.analyzeImport('customers', p, 'cust.csv');
    expect(a.totalRows).toBe(3);
    expect(a.autoMapping.name).toBe('name');
    const v = imports.validateImport(a.jobId, a.autoMapping);
    expect(v.errors).toHaveLength(1); // invalid email row
    expect(v.validRows).toBe(2);
    expect(v.duplicates).toHaveLength(0);
    const applied = imports.applyImport(a.jobId);
    expect(applied.imported).toBe(2);
    expect(applied.errors).toHaveLength(0);
    // Second import of the same file flags both emails as duplicates.
    const a2 = imports.analyzeImport('customers', p, 'cust.csv');
    const v2 = imports.validateImport(a2.jobId, a2.autoMapping);
    expect(v2.duplicates).toHaveLength(2);
    expect(v2.validRows).toBe(0);
  });

  it('rolls back the whole import when any row fails mid-apply', async () => {
    const { imports, db } = await setup();
    const orders = await import('../src/database/orders.js');
    const p = writeCsv('orders9.csv',
      'order_number,order_date,customer_name,item_description,item_quantity,item_unit_price\n' +
      'CSV-9,2026-11-01,Carol,Soap Bar,2,8.00\n');
    const a = imports.analyzeImport('orders', p, 'orders9.csv');
    const v = imports.validateImport(a.jobId, a.autoMapping);
    expect(v.validRows).toBe(1);
    // Seed a conflicting order number between validate and apply.
    const seed = orders.createOrder({
      order_date: '2026-11-01',
      items: [{ description: 'Seed', quantity: 1, unit_price_cents: 100 }],
    });
    db.getDb().prepare(`UPDATE orders SET order_number = ? WHERE id = ?`).run('CSV-9', seed.id);
    const applied = imports.applyImport(a.jobId);
    expect(applied.imported).toBe(0);
    expect(applied.errors.length).toBeGreaterThan(0);
    // Atomicity: neither the imported order nor its auto-created customer may exist.
    const all = orders.listOrders({});
    expect(all.rows).toHaveLength(1);
    const conn = db.getDb();
    const carol = (conn.prepare(`SELECT COUNT(*) AS n FROM customers WHERE name = 'Carol'`).get() as { n: number }).n;
    expect(carol).toBe(0);
    const job = conn.prepare(`SELECT status FROM import_jobs WHERE id = ?`).get(a.jobId) as { status: string };
    expect(job.status).toBe('failed');
  });
});

describe('product import', () => {
  it('creates categories on the fly and flags duplicate SKUs', async () => {
    const { imports } = await setup();
    const p = writeCsv('prod.csv',
      'name,sku,category,price,active\nWidget A,W-A,Gadgets,12.99,true\nWidget B,,Gadgets,5.00,\nWidget C,W-C,Tools,not-money,true\n');
    const a = imports.analyzeImport('products', p, 'prod.csv');
    const v = imports.validateImport(a.jobId, a.autoMapping);
    expect(v.errors).toHaveLength(1); // bad price
    expect(v.validRows).toBe(2);
    const applied = imports.applyImport(a.jobId);
    expect(applied.imported).toBe(2);
    const dbm = await import('../src/database/index.js');
    const db = dbm.getDb();
    const cats = db.prepare(`SELECT name FROM product_categories`).all() as { name: string }[];
    expect(cats.map((c) => c.name)).toContain('Gadgets');
    // Re-import same file: both SKUs now duplicate; category-empty SKU rows still import (no SKU to match).
    const a2 = imports.analyzeImport('products', p, 'prod.csv');
    const v2 = imports.validateImport(a2.jobId, a2.autoMapping);
    expect(v2.duplicates).toHaveLength(1);
    expect(v2.duplicates[0].reason).toContain('W-A');
  });
});

describe('order import', () => {
  it('groups multi-line orders, creates customers, and walks the lifecycle', async () => {
    const { imports } = await setup();
    const p = writeCsv('orders.csv',
      'order_number,order_date,customer_name,customer_email,source,status,item_description,item_quantity,item_unit_price,shipping\n' +
      'CSV-1,2026-11-01,Carol,c@x.com,Etsy,shipped,Soap Bar,2,8.00,3.50\n' +
      'CSV-1,2026-11-01,Carol,c@x.com,Etsy,shipped,Soap Dish,1,4.00,\n' +
      ',2026-11-02,Dave,,Manual,new,Single Item,1,10.00,\n');
    const a = imports.analyzeImport('orders', p, 'orders.csv');
    const v = imports.validateImport(a.jobId, a.autoMapping);
    expect(v.errors).toHaveLength(0);
    expect(v.validRows).toBe(3);
    const applied = imports.applyImport(a.jobId);
    expect(applied.imported).toBe(2);
    const orders = await import('../src/database/orders.js');
    const all = orders.listOrders({});
    expect(all.rows).toHaveLength(2);
    const csv1 = all.rows.find((o) => o.order_number === 'CSV-1')!;
    expect(csv1.status).toBe('shipped');
    // Totals: items 2*800 + 1*400 = 2000, shipping 350 → grand 2350.
    expect(csv1.grand_total_cents).toBe(2350);
    expect(csv1.source).toBe('Etsy');
    const hist = orders.getStatusHistory(csv1.id);
    expect(hist.map((h) => h.to_status)).toEqual(['draft', 'new', 'confirmed', 'ready_to_fulfill', 'packing', 'shipped']);
    const dave = all.rows.find((o) => o.order_number !== 'CSV-1')!;
    expect(dave.customer_name).toBe('Dave');
    expect(dave.status).toBe('new');
  });

  it('rejects bad rows without touching good ones', async () => {
    const { imports } = await setup();
    const p = writeCsv('orders2.csv',
      'order_date,customer_name,item_description,item_quantity,item_unit_price\n' +
      'not-a-date,Erin,Thing,1,5.00\n' +
      '2026-11-03,Frank,Widget,0,5.00\n' +
      '2026-11-03,Grace,Widget,2,7.50\n');
    const a = imports.analyzeImport('orders', p, 'orders.csv');
    const v = imports.validateImport(a.jobId, a.autoMapping);
    expect(v.errors).toHaveLength(2);
    expect(v.validRows).toBe(1);
    const applied = imports.applyImport(a.jobId);
    expect(applied.imported).toBe(1);
    const orders = await import('../src/database/orders.js');
    expect(orders.listOrders({}).rows).toHaveLength(1);
  });
});

// ---------------- dashboard ----------------

describe('dashboard', () => {
  it('computes stats matching direct queries', async () => {
    const { dashboard, db } = await setup();
    const orders = await import('../src/database/orders.js');
    const a = orders.createOrder({
      order_date: '2026-11-01',
      items: [{ description: 'x', quantity: 1, unit_price_cents: 100 }],
    });
    const b = orders.createOrder({
      order_date: '2026-11-01',
      items: [{ description: 'y', quantity: 1, unit_price_cents: 200 }],
      requested_date: '2000-01-01',
    });
    orders.setOrderStatus(a.id, 'new');
    orders.setOrderStatus(b.id, 'new');
    const stats = dashboard.getDashboardStats({ from: '2000-01-01', to: '2100-01-01' });
    expect(stats.open_orders).toBe(2);
    expect(stats.awaiting_processing).toBe(2);
    expect(stats.overdue_orders).toBe(1); // b's requested date is in the past
    expect(stats.recent_activity.length).toBeGreaterThan(0);
    const conn = db.getDb();
    const direct = (conn.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status = 'new'`).get() as { n: number }).n;
    expect(direct).toBe(2);
  });
});

// ---------------- reports ----------------

describe('reports', () => {
  it('sales, best sellers, AOV, and late orders match hand-computed values', async () => {
    const { reports } = await setup();
    const orders = await import('../src/database/orders.js');
    const a = orders.createOrder({
      customer_name: 'A', order_date: '2026-11-01',
      items: [{ description: 'Soap', quantity: 2, unit_price_cents: 800 }],
    });
    orders.createOrder({
      customer_name: 'B', order_date: '2026-11-01',
      items: [{ description: 'Soap', quantity: 1, unit_price_cents: 800 }, { description: 'Dish', quantity: 1, unit_price_cents: 400 }],
    });
    const c = orders.createOrder({
      customer_name: 'C', order_date: '2026-11-02', requested_date: '2020-05-05',
      items: [{ description: 'Dish', quantity: 3, unit_price_cents: 400 }],
    });
    const range = { from: '2026-11-01', to: '2026-11-02' };
    const sales = reports.runReport('sales_over_time', range);
    expect(sales.rows).toEqual([['2026-11-01', '28.00'], ['2026-11-02', '12.00']]);
    const best = reports.runReport('best_sellers', range);
    expect(best.rows[0][0]).toBe('Dish');
    expect(best.rows[0][2]).toBe(4);
    const aov = reports.runReport('average_order_value', range);
    expect(aov.rows.find((r) => r[0] === 'Average order value ($)')![1]).toBe('13.33');
    const late = reports.runReport('late_orders', { from: '2000-01-01', to: '2100-01-01' });
    expect(late.rows.some((r) => String(r[0]) === c.order_number)).toBe(true);
    // CSV export of the report is valid CSV.
    expect(sales.csv.split('\n')[0]).toBe('Date,Revenue ($)');
    const byStatus = reports.runReport('orders_by_status', range);
    expect(byStatus.rows.some((r) => r[0] === 'draft' && r[1] === 3)).toBe(true);
  });
});

// ---------------- exports ----------------

describe('exports', () => {
  it('order export re-parses with identical row count', async () => {
    const { exportsMod, csv } = await setup();
    const orders = await import('../src/database/orders.js');
    orders.createOrder({
      customer_name: 'A', order_date: '2026-11-01',
      items: [{ description: 'Soap', quantity: 2, unit_price_cents: 800 }],
    });
    const { csv: text } = exportsMod.buildExportCsv('orders');
    const p = writeCsv('export.csv', text);
    const parsed = csv.parseCsvFile(p);
    expect(parsed.totalRows).toBe(1);
    expect(parsed.rows[0].item_description).toBe('Soap');
    expect(parsed.rows[0].grand_total).toBe('16.00');
  });
});
