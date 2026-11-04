import { getDb } from './index.js';
import { OPEN_STATUSES } from '../shared/constants.js';
import type { DashboardStats, OrderStatus } from '../shared/types.js';

export interface DateRange {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

/** All figures computed from live database records. */
export function getDashboardStats(range: DateRange): DashboardStats {
  const db = getDb();
  const openList = OPEN_STATUSES.map(() => '?').join(',');
  const count = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { n: number }).n;

  const open_orders = count(
    `SELECT COUNT(*) AS n FROM orders WHERE archived = 0 AND status IN (${openList})`,
    ...OPEN_STATUSES,
  );
  const awaiting_processing = count(
    `SELECT COUNT(*) AS n FROM orders WHERE archived = 0 AND status IN ('draft','new')`,
  );
  const awaiting_production = count(
    `SELECT COUNT(*) AS n FROM orders WHERE archived = 0 AND status = 'awaiting_production'`,
  );
  const ready_for_packing = count(
    `SELECT COUNT(*) AS n FROM orders WHERE archived = 0 AND status = 'ready_to_fulfill'`,
  );
  const awaiting_shipment = count(
    `SELECT COUNT(*) AS n FROM fulfillments WHERE status = 'ready_to_ship'`,
  );
  const overdue_orders = count(
    `SELECT COUNT(*) AS n FROM orders
      WHERE archived = 0 AND requested_date IS NOT NULL
        AND date(requested_date) < date('now')
        AND status IN (${openList})`,
    ...OPEN_STATUSES,
  );
  const completed_recent = count(
    `SELECT COUNT(*) AS n FROM orders
      WHERE archived = 0 AND status = 'completed'
        AND date(updated_at) BETWEEN date(?) AND date(?)`,
    range.from,
    range.to,
  );
  const recent_activity = db
    .prepare(
      `SELECT h.id, h.order_id, o.order_number, h.to_status, h.created_at
         FROM order_status_history h JOIN orders o ON o.id = h.order_id
        WHERE date(h.created_at) BETWEEN date(?) AND date(?)
        ORDER BY h.created_at DESC LIMIT 30`,
    )
    .all(range.from, range.to) as DashboardStats['recent_activity'];

  return {
    open_orders,
    awaiting_processing,
    awaiting_production,
    ready_for_packing,
    awaiting_shipment,
    overdue_orders,
    completed_recent,
    recent_activity: recent_activity.map((r) => ({ ...r, to_status: r.to_status as OrderStatus })),
  };
}
