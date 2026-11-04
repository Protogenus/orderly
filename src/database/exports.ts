import { getDb } from './index.js';
import { toCsv } from '../domain/csv.js';
import { AppError } from '../domain/errors.js';

export type ExportKind = 'orders' | 'customers' | 'products';

function dollars(cents: number | null): string {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

export function buildExportCsv(kind: ExportKind): { filename: string; csv: string } {
  const db = getDb();
  if (kind === 'orders') {
    const rows = db.prepare(
      `SELECT o.order_number, o.order_date, o.source, o.status, o.priority, o.requested_date,
              c.name AS customer_name, c.email AS customer_email,
              oi.description AS item_description, oi.sku AS item_sku, oi.quantity AS item_quantity,
              oi.unit_price_cents, oi.discount_cents AS item_discount_cents, oi.tax_cents AS item_tax_cents,
              o.discount_cents, o.shipping_cents, o.tax_cents, o.grand_total_cents, o.paid_cents,
              o.ship_recipient, o.ship_line1, o.ship_line2, o.ship_city, o.ship_state, o.ship_postal, o.ship_country,
              o.internal_notes, o.customer_notes
         FROM orders o
         LEFT JOIN customers c ON c.id = o.customer_id
         LEFT JOIN order_items oi ON oi.order_id = o.id
        WHERE o.archived = 0
        ORDER BY o.order_date, o.order_number, oi.position`,
    ).all() as any[];
    const headers = ['order_number','order_date','source','status','priority','requested_date','customer_name','customer_email','item_description','item_sku','item_quantity','item_unit_price','item_discount','item_tax','discount','shipping','tax','grand_total','paid','ship_recipient','ship_line1','ship_line2','ship_city','ship_state','ship_postal','ship_country','internal_notes','customer_notes'];
    const data = rows.map((r) => [
      r.order_number, r.order_date, r.source, r.status, r.priority, r.requested_date ?? '',
      r.customer_name ?? '', r.customer_email ?? '',
      r.item_description ?? '', r.item_sku ?? '', r.item_quantity ?? '',
      dollars(r.unit_price_cents), dollars(r.item_discount_cents), dollars(r.item_tax_cents),
      dollars(r.discount_cents), dollars(r.shipping_cents), dollars(r.tax_cents),
      dollars(r.grand_total_cents), dollars(r.paid_cents),
      r.ship_recipient ?? '', r.ship_line1 ?? '', r.ship_line2 ?? '', r.ship_city ?? '', r.ship_state ?? '', r.ship_postal ?? '', r.ship_country ?? '',
      r.internal_notes ?? '', r.customer_notes ?? '',
    ]);
    return { filename: 'orderly-orders.csv', csv: toCsv(headers, data) };
  }
  if (kind === 'customers') {
    const rows = db.prepare(
      `SELECT name, email, phone, company, notes, tags, created_at FROM customers WHERE deleted_at IS NULL ORDER BY name`,
    ).all() as any[];
    const headers = ['name','email','phone','company','notes','tags','created_at'];
    const data = rows.map((r) => [
      r.name, r.email ?? '', r.phone ?? '', r.company ?? '', r.notes ?? '',
      (JSON.parse(r.tags ?? '[]') as string[]).join(', '), r.created_at,
    ]);
    return { filename: 'orderly-customers.csv', csv: toCsv(headers, data) };
  }
  if (kind === 'products') {
    const rows = db.prepare(
      `SELECT p.name, p.sku, p.description, c.name AS category, p.base_price_cents, p.active, p.marketplace_id
         FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE p.deleted_at IS NULL ORDER BY p.name`,
    ).all() as any[];
    const headers = ['name','sku','description','category','price','active','marketplace_id'];
    const data = rows.map((r) => [
      r.name, r.sku ?? '', r.description ?? '', r.category ?? '',
      dollars(r.base_price_cents), r.active === 1 ? 'true' : 'false', r.marketplace_id ?? '',
    ]);
    return { filename: 'orderly-products.csv', csv: toCsv(headers, data) };
  }
  throw new AppError('VALIDATION', `Unknown export kind: ${kind}.`);
}
