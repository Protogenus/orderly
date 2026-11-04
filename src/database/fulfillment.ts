import { getDb, tx } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import { assertTransition } from '../domain/orders.js';
import type {
  Fulfillment,
  FulfillmentDetail,
  FulfillmentItemDetail,
  Order,
  OrderStatus,
  PackItemInput,
  ReadyToShipInput,
  Shipment,
  ShipInput,
  WorkspaceData,
} from '../shared/types.js';

type Db = ReturnType<typeof getDb>;

function fulfillmentItems(db: Db, fulfillmentId: string): FulfillmentItemDetail[] {
  return db
    .prepare(
      `SELECT fi.*, oi.description, oi.sku, oi.quantity AS quantity_ordered
         FROM fulfillment_items fi JOIN order_items oi ON oi.id = fi.order_item_id
        WHERE fi.fulfillment_id = ? ORDER BY oi.position`,
    )
    .all(fulfillmentId) as FulfillmentItemDetail[];
}

function shipmentFor(db: Db, fulfillmentId: string): Shipment | null {
  const row = db.prepare(`SELECT * FROM shipments WHERE fulfillment_id = ?`).get(fulfillmentId) as Shipment | undefined;
  return row ?? null;
}

function detailOf(db: Db, id: string): FulfillmentDetail {
  const f = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(id) as any;
  if (!f) throw new AppError('NOT_FOUND', 'Fulfillment not found.');
  const o = db.prepare(`SELECT order_number, customer_id FROM orders WHERE id = ?`).get(f.order_id) as any;
  const customer = f.order_id
    ? (db.prepare(`SELECT c.name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`).get(f.order_id) as { name: string | null } | undefined)
    : undefined;
  return {
    ...f,
    order_number: o.order_number,
    customer_name: customer?.name ?? null,
    items: fulfillmentItems(db, id),
    shipment: shipmentFor(db, id),
  };
}

function recordStatus(db: Db, orderId: string, from: OrderStatus | null, to: OrderStatus, note?: string | null): void {
  db.prepare(
    `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(newId('osh'), orderId, from, to, note ?? null, nowIso());
}

/** Quantity of an order item already packed across all fulfillments except optionally one. */
function packedElsewhere(db: Db, orderItemId: string, exceptFulfillmentId?: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(quantity_packed), 0) AS n FROM fulfillment_items
        WHERE order_item_id = ? ${exceptFulfillmentId ? 'AND fulfillment_id != ?' : ''}`,
    )
    .get(orderItemId, ...(exceptFulfillmentId ? [exceptFulfillmentId] : [])) as { n: number };
  return row.n;
}

function orderItemQty(db: Db, orderItemId: string): number {
  const row = db.prepare(`SELECT quantity, order_id FROM order_items WHERE id = ?`).get(orderItemId) as
    | { quantity: number; order_id: string }
    | undefined;
  if (!row) throw new AppError('NOT_FOUND', 'Order item not found.');
  return row.quantity;
}

/** Remaining unpacked quantity per order item for an order. */
export function remainingForOrder(db: Db, orderId: string): Map<string, number> {
  const items = db.prepare(`SELECT id, quantity FROM order_items WHERE order_id = ?`).all(orderId) as {
    id: string;
    quantity: number;
  }[];
  const map = new Map<string, number>();
  for (const i of items) {
    map.set(i.id, i.quantity - packedElsewhere(db, i.id));
  }
  return map;
}

function assertPackableStatus(status: OrderStatus): void {
  if (!['ready_to_fulfill', 'packing'].includes(status)) {
    throw new AppError(
      'CONFLICT',
      `Order must be Ready to Fulfill before packing (currently ${status}). Move it through the lifecycle first.`,
    );
  }
}

export function startPacking(orderId: string): FulfillmentDetail {
  return tx((db) => {
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    assertPackableStatus(order.status as OrderStatus);
    const remaining = remainingForOrder(db, orderId);
    const totalRemaining = [...remaining.values()].reduce((s, n) => s + n, 0);
    if (totalRemaining <= 0) throw new AppError('CONFLICT', 'Every item on this order is already packed.');
    const existing = db
      .prepare(`SELECT id FROM fulfillments WHERE order_id = ? AND status = 'packing'`)
      .get(orderId) as { id: string } | undefined;
    if (existing) throw new AppError('CONFLICT', 'This order already has a packing session in progress.');
    const now = nowIso();
    const id = newId('ful');
    db.prepare(
      `INSERT INTO fulfillments (id, order_id, status, created_at, updated_at) VALUES (?, ?, 'packing', ?, ?)`,
    ).run(id, orderId, now, now);
    if (order.status === 'ready_to_fulfill') {
      db.prepare(`UPDATE orders SET status = 'packing', updated_at = ? WHERE id = ?`).run(now, orderId);
      recordStatus(db, orderId, 'ready_to_fulfill', 'packing', 'Packing started.');
    }
    return detailOf(db, id);
  });
}

export function setPackedQuantity(fulfillmentId: string, input: PackItemInput): FulfillmentDetail {
  return tx((db) => {
    const f = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(fulfillmentId) as any;
    if (!f) throw new AppError('NOT_FOUND', 'Fulfillment not found.');
    if (f.status !== 'packing') throw new AppError('CONFLICT', 'Only a packing session in progress can be edited.');
    const oi = db.prepare(`SELECT id, order_id, quantity FROM order_items WHERE id = ?`).get(input.order_item_id) as
      | { id: string; order_id: string; quantity: number }
      | undefined;
    if (!oi || oi.order_id !== f.order_id) throw new AppError('NOT_FOUND', 'Order item not found on this order.');
    if (!Number.isInteger(input.quantity) || input.quantity < 0) {
      throw new AppError('VALIDATION', 'Packed quantity must be a whole number of 0 or more.');
    }
    const maxForThis = oi.quantity - packedElsewhere(db, input.order_item_id, fulfillmentId);
    if (input.quantity > maxForThis) {
      throw new AppError(
        'VALIDATION',
        `Only ${maxForThis} of this item remain unpacked (ordered ${oi.quantity}).`,
      );
    }
    if (input.quantity === 0) {
      db.prepare(`DELETE FROM fulfillment_items WHERE fulfillment_id = ? AND order_item_id = ?`).run(fulfillmentId, input.order_item_id);
    } else {
      db.prepare(
        `INSERT INTO fulfillment_items (id, fulfillment_id, order_item_id, quantity_packed)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(fulfillment_id, order_item_id) DO UPDATE SET quantity_packed = excluded.quantity_packed`,
      ).run(newId('fui'), fulfillmentId, input.order_item_id, input.quantity);
    }
    db.prepare(`UPDATE fulfillments SET updated_at = ? WHERE id = ?`).run(nowIso(), fulfillmentId);
    return detailOf(db, fulfillmentId);
  });
}

export function markReadyToShip(fulfillmentId: string, input: ReadyToShipInput): FulfillmentDetail {
  return tx((db) => {
    const f = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(fulfillmentId) as any;
    if (!f) throw new AppError('NOT_FOUND', 'Fulfillment not found.');
    if (f.status !== 'packing') throw new AppError('CONFLICT', 'Only a packing session can be marked ready to ship.');
    const count = (db.prepare(`SELECT COALESCE(SUM(quantity_packed),0) AS n FROM fulfillment_items WHERE fulfillment_id = ?`).get(fulfillmentId) as { n: number }).n;
    if (count <= 0) throw new AppError('VALIDATION', 'Pack at least one item before marking ready to ship.');
    db.prepare(
      `UPDATE fulfillments SET status = 'ready_to_ship', package_notes = ?, length_cm = ?, width_cm = ?, height_cm = ?, weight_kg = ?, updated_at = ? WHERE id = ?`,
    ).run(
      input.package_notes ?? null,
      input.length_cm ?? null,
      input.width_cm ?? null,
      input.height_cm ?? null,
      input.weight_kg ?? null,
      nowIso(),
      fulfillmentId,
    );
    return detailOf(db, fulfillmentId);
  });
}

export function backToPacking(fulfillmentId: string): FulfillmentDetail {
  return tx((db) => {
    const f = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(fulfillmentId) as any;
    if (!f) throw new AppError('NOT_FOUND', 'Fulfillment not found.');
    if (f.status !== 'ready_to_ship') throw new AppError('CONFLICT', 'Only a ready-to-ship package can go back to packing.');
    db.prepare(`UPDATE fulfillments SET status = 'packing', updated_at = ? WHERE id = ?`).run(nowIso(), fulfillmentId);
    return detailOf(db, fulfillmentId);
  });
}

export function shipFulfillment(fulfillmentId: string, input: ShipInput): FulfillmentDetail {
  return tx((db) => {
    const f = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(fulfillmentId) as any;
    if (!f) throw new AppError('NOT_FOUND', 'Fulfillment not found.');
    if (f.status !== 'ready_to_ship') throw new AppError('CONFLICT', 'Only a ready-to-ship package can be shipped.');
    const now = nowIso();
    db.prepare(
      `INSERT INTO shipments (id, fulfillment_id, order_id, carrier, service, tracking_number, shipped_at, shipping_cost_cents, package_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('shp'), fulfillmentId, f.order_id,
      input.carrier ?? null, input.service ?? null, input.tracking_number ?? null,
      input.shipped_at, input.shipping_cost_cents, input.package_summary ?? null, now,
    );
    db.prepare(`UPDATE fulfillments SET status = 'shipped', updated_at = ? WHERE id = ?`).run(now, fulfillmentId);

    // Order status: shipped only when everything is packed and shipped; otherwise back to ready_to_fulfill.
    const remaining = remainingForOrder(db, f.order_id);
    const left = [...remaining.values()].reduce((s, n) => s + n, 0);
    const order = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(f.order_id) as { status: OrderStatus };
    if (left <= 0) {
      assertTransition(order.status, 'shipped');
      db.prepare(`UPDATE orders SET status = 'shipped', updated_at = ? WHERE id = ?`).run(now, f.order_id);
      recordStatus(db, f.order_id, order.status, 'shipped', input.tracking_number ? `Tracking ${input.tracking_number}` : 'Shipped.');
    } else if (order.status === 'packing') {
      db.prepare(`UPDATE orders SET status = 'ready_to_fulfill', updated_at = ? WHERE id = ?`).run(now, f.order_id);
      recordStatus(db, f.order_id, 'packing', 'ready_to_fulfill', `Partial shipment sent; ${left} item(s) still to pack.`);
    }
    return detailOf(db, fulfillmentId);
  });
}

export function getFulfillmentsForOrder(orderId: string): FulfillmentDetail[] {
  return tx((db) => {
    const ids = db.prepare(`SELECT id FROM fulfillments WHERE order_id = ? ORDER BY created_at`).all(orderId) as { id: string }[];
    return ids.map((r) => detailOf(db, r.id));
  });
}

export function getFulfillment(id: string): FulfillmentDetail {
  return tx((db) => detailOf(db, id));
}

export function getWorkspace(): WorkspaceData {
  return tx((db) => {
    const orderRows = (status: string) =>
      db
        .prepare(
          `SELECT o.*, c.name AS customer_name,
                  (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count,
                  (SELECT COALESCE(SUM(fi.quantity_packed),0) FROM fulfillment_items fi
                    JOIN order_items oi ON oi.id = fi.order_item_id WHERE oi.order_id = o.id) AS packed_count
             FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
            WHERE o.status = ? AND o.archived = 0 ORDER BY o.requested_date, o.order_date`,
        )
        .all(status) as any[];
    const toOrder = (r: any) => ({
      ...r,
      tags: JSON.parse(r.tags ?? '[]'),
      archived: r.archived === 1,
      balance_cents: (r.grand_total_cents ?? 0) - (r.paid_cents ?? 0),
      items: [],
      customer_name: r.customer_name ?? null,
    });
    const fulRows = (status: string) =>
      (db.prepare(`SELECT id FROM fulfillments WHERE status = ? ORDER BY updated_at DESC LIMIT 200`).all(status) as { id: string }[])
        .map((r) => detailOf(db, r.id));
    const awaiting = (db
      .prepare(
        `SELECT f.id FROM fulfillments f
          JOIN orders o ON o.id = f.order_id
         WHERE f.status = 'shipped' AND o.status = 'shipped' AND o.archived = 0
         ORDER BY f.updated_at DESC LIMIT 200`,
      )
      .all() as { id: string }[]).map((r) => detailOf(db, r.id));
    return {
      ready_to_pack: orderRows('ready_to_fulfill').map(toOrder),
      packing: orderRows('packing').map(toOrder),
      ready_to_ship: fulRows('ready_to_ship'),
      shipped: fulRows('shipped'),
      awaiting_delivery: awaiting,
    };
  });
}

export function deleteFulfillment(id: string): void {
  tx((db) => {
    const f = db.prepare(`SELECT * FROM fulfillments WHERE id = ?`).get(id) as any;
    if (!f) throw new AppError('NOT_FOUND', 'Fulfillment not found.');
    if (f.status === 'shipped') throw new AppError('CONFLICT', 'A shipped fulfillment cannot be deleted. It is a historical record.');
    db.prepare(`DELETE FROM fulfillments WHERE id = ?`).run(id);
    // If the order has no other active packing sessions, return it to ready_to_fulfill.
    const left = db.prepare(`SELECT COUNT(*) AS n FROM fulfillments WHERE order_id = ? AND status = 'packing'`).get(f.order_id) as { n: number };
    if (left.n === 0) {
      const order = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(f.order_id) as { status: OrderStatus };
      if (order.status === 'packing') {
        db.prepare(`UPDATE orders SET status = 'ready_to_fulfill', updated_at = ? WHERE id = ?`).run(nowIso(), f.order_id);
        recordStatus(db, f.order_id, 'packing', 'ready_to_fulfill', 'Packing session discarded.');
      }
    }
  });
}
