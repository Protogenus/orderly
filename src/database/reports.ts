import { getDb } from './index.js';
import type { DateRange } from './dashboard.js';
import type { ReportId, ReportResult } from '../shared/types.js';

function esc(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns: string[], rows: (string | number)[][]): string {
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

const NON_CANCELED = `o.status != 'canceled' AND o.archived = 0`;

export function runReport(id: ReportId, range: DateRange): ReportResult {
  const db = getDb();
  const { from, to } = range;
  let columns: string[] = [];
  let rows: (string | number)[][] = [];
  let title = '';
  let note = '';

  switch (id) {
    case 'orders_over_time': {
      title = 'Orders over time';
      note = 'Count of orders placed per day, excluding canceled.';
      columns = ['Date', 'Orders'];
      rows = (
        db.prepare(
          `SELECT date(order_date) AS d, COUNT(*) AS n FROM orders o
            WHERE ${NON_CANCELED} AND date(order_date) BETWEEN date(?) AND date(?)
            GROUP BY d ORDER BY d`,
        ).all(from, to) as { d: string; n: number }[]
      ).map((r) => [r.d, r.n]);
      break;
    }
    case 'sales_over_time': {
      title = 'Revenue over time';
      note = 'Sum of order grand totals per day. This is REVENUE (what customers were charged), not profit — Orderly does not track costs.';
      columns = ['Date', 'Revenue ($)'];
      rows = (
        db.prepare(
          `SELECT date(order_date) AS d, SUM(grand_total_cents) AS t FROM orders o
            WHERE ${NON_CANCELED} AND date(order_date) BETWEEN date(?) AND date(?)
            GROUP BY d ORDER BY d`,
        ).all(from, to) as { d: string; t: number }[]
      ).map((r) => [r.d, money(r.t ?? 0)]);
      break;
    }
    case 'orders_by_status': {
      title = 'Orders by status';
      note = 'Current pipeline snapshot (all time, excluding archived).';
      columns = ['Status', 'Orders'];
      rows = (
        db.prepare(
          `SELECT status, COUNT(*) AS n FROM orders WHERE archived = 0 GROUP BY status ORDER BY n DESC`,
        ).all() as { status: string; n: number }[]
      ).map((r) => [r.status.replace(/_/g, ' '), r.n]);
      break;
    }
    case 'orders_by_channel': {
      title = 'Orders by sales channel';
      note = 'Order source distribution, excluding canceled.';
      columns = ['Channel', 'Orders', 'Revenue ($)'];
      rows = (
        db.prepare(
          `SELECT source, COUNT(*) AS n, SUM(grand_total_cents) AS t FROM orders o
            WHERE ${NON_CANCELED} AND date(order_date) BETWEEN date(?) AND date(?)
            GROUP BY source ORDER BY n DESC`,
        ).all(from, to) as { source: string; n: number; t: number }[]
      ).map((r) => [r.source, r.n, money(r.t ?? 0)]);
      break;
    }
    case 'best_sellers': {
      title = 'Best-selling products';
      note = 'Ranked by units sold from non-canceled orders.';
      columns = ['Product', 'SKU', 'Units sold', 'Revenue ($)'];
      rows = (
        db.prepare(
          `SELECT oi.description AS name, oi.sku, SUM(oi.quantity) AS q, SUM(oi.line_total_cents) AS t
             FROM order_items oi JOIN orders o ON o.id = oi.order_id
            WHERE ${NON_CANCELED} AND date(o.order_date) BETWEEN date(?) AND date(?)
            GROUP BY oi.description, oi.sku ORDER BY q DESC LIMIT 50`,
        ).all(from, to) as { name: string; sku: string | null; q: number; t: number }[]
      ).map((r) => [r.name, r.sku ?? '—', r.q, money(r.t ?? 0)]);
      break;
    }
    case 'average_order_value': {
      title = 'Average order value';
      note = 'Mean grand total of non-canceled orders. Revenue only — not profit.';
      columns = ['Metric', 'Value'];
      const r = db.prepare(
        `SELECT COUNT(*) AS n, SUM(grand_total_cents) AS t FROM orders o
          WHERE ${NON_CANCELED} AND date(order_date) BETWEEN date(?) AND date(?)`,
      ).get(from, to) as { n: number; t: number };
      rows = [
        ['Orders', r.n],
        ['Total revenue ($)', money(r.t ?? 0)],
        ['Average order value ($)', r.n > 0 ? money(Math.round((r.t ?? 0) / r.n)) : '0.00'],
      ];
      break;
    }
    case 'customer_history': {
      title = 'Customer purchase history';
      note = 'Per-customer totals from non-canceled orders.';
      columns = ['Customer', 'Orders', 'Total spent ($)', 'Outstanding ($)'];
      rows = (
        db.prepare(
          `SELECT c.name, COUNT(o.id) AS n, SUM(o.grand_total_cents) AS t,
                  SUM(CASE WHEN o.status NOT IN ('completed','canceled') THEN o.grand_total_cents - o.paid_cents ELSE 0 END) AS out
             FROM customers c JOIN orders o ON o.customer_id = c.id
            WHERE ${NON_CANCELED} AND date(o.order_date) BETWEEN date(?) AND date(?)
            GROUP BY c.id ORDER BY t DESC LIMIT 200`,
        ).all(from, to) as { name: string; n: number; t: number; out: number }[]
      ).map((r) => [r.name, r.n, money(r.t ?? 0), money(r.out ?? 0)]);
      break;
    }
    case 'fulfillment_performance': {
      title = 'Fulfillment performance';
      note = 'Days from order date to first shipment, per shipped order.';
      columns = ['Order', 'Order date', 'Shipped date', 'Days to ship'];
      rows = (
        db.prepare(
          `SELECT o.order_number, o.order_date, MIN(date(s.shipped_at)) AS shipped
             FROM orders o JOIN shipments s ON s.order_id = o.id
            WHERE o.archived = 0 AND s.shipped_at IS NOT NULL
              AND date(s.shipped_at) BETWEEN date(?) AND date(?)
            GROUP BY o.id ORDER BY shipped DESC LIMIT 200`,
        ).all(from, to) as { order_number: string; order_date: string; shipped: string }[]
      ).map((r) => {
        const days = Math.round((Date.parse(r.shipped) - Date.parse(r.order_date)) / 86400000);
        return [r.order_number, r.order_date, r.shipped, days];
      });
      break;
    }
    case 'late_orders': {
      title = 'Late orders';
      note = 'Orders past their requested date that are not completed/canceled, plus orders shipped after the requested date.';
      columns = ['Order', 'Customer', 'Requested', 'Status', 'Days late'];
      const today = new Date().toISOString().slice(0, 10);
      rows = (
        db.prepare(
          `SELECT o.order_number, c.name AS customer, o.requested_date, o.status
             FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
            WHERE o.archived = 0 AND o.requested_date IS NOT NULL
              AND date(o.requested_date) < date(?)
              AND o.status NOT IN ('completed','canceled','delivered')
            ORDER BY o.requested_date LIMIT 200`,
        ).all(today) as { order_number: string; customer: string | null; requested_date: string; status: string }[]
      ).map((r) => {
        const days = Math.round((Date.parse(today) - Date.parse(r.requested_date)) / 86400000);
        return [r.order_number, r.customer ?? '—', r.requested_date, r.status.replace(/_/g, ' '), days];
      });
      break;
    }
    case 'canceled_orders': {
      title = 'Canceled orders';
      note = 'Canceled orders in the period with their last status note.';
      columns = ['Order', 'Customer', 'Order date', 'Total ($)'];
      rows = (
        db.prepare(
          `SELECT o.order_number, c.name AS customer, o.order_date, o.grand_total_cents
             FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
            WHERE o.archived = 0 AND o.status = 'canceled'
              AND date(o.order_date) BETWEEN date(?) AND date(?)
            ORDER BY o.order_date DESC LIMIT 200`,
        ).all(from, to) as { order_number: string; customer: string | null; order_date: string; grand_total_cents: number }[]
      ).map((r) => [r.order_number, r.customer ?? '—', r.order_date, money(r.grand_total_cents)]);
      break;
    }
    case 'returns': {
      title = 'Returns';
      note = 'Return requests in the period by status.';
      columns = ['Order', 'Status', 'Items', 'Opened'];
      rows = (
        db.prepare(
          `SELECT o.order_number, r.status,
                  (SELECT SUM(quantity) FROM return_items ri WHERE ri.return_id = r.id) AS items,
                  date(r.created_at) AS opened
             FROM returns r JOIN orders o ON o.id = r.order_id
            WHERE date(r.created_at) BETWEEN date(?) AND date(?)
            ORDER BY r.created_at DESC LIMIT 200`,
        ).all(from, to) as { order_number: string; status: string; items: number; opened: string }[]
      ).map((r) => [r.order_number, r.status.replace(/_/g, ' '), r.items ?? 0, r.opened]);
      break;
    }
  }

  return { id, title, note, columns, rows, csv: toCsv(columns, rows) };
}

export const REPORT_LIST: { id: ReportId; label: string }[] = [
  { id: 'orders_over_time', label: 'Orders over time' },
  { id: 'sales_over_time', label: 'Revenue over time' },
  { id: 'orders_by_status', label: 'Orders by status' },
  { id: 'orders_by_channel', label: 'Orders by sales channel' },
  { id: 'best_sellers', label: 'Best-selling products' },
  { id: 'average_order_value', label: 'Average order value' },
  { id: 'customer_history', label: 'Customer purchase history' },
  { id: 'fulfillment_performance', label: 'Fulfillment performance' },
  { id: 'late_orders', label: 'Late orders' },
  { id: 'canceled_orders', label: 'Canceled orders' },
  { id: 'returns', label: 'Returns' },
];
