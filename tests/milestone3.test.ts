import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-m3-'));
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
  const o = await import('../src/database/orders.js');
  const f = await import('../src/database/fulfillment.js');
  return { o, f };
}

function makeOrder(o: any) {
  return o.createOrder({
    order_date: '2026-11-04',
    items: [
      { description: 'Candles', quantity: 5, unit_price_cents: 1500 },
      { description: 'Soap', quantity: 2, unit_price_cents: 800 },
    ],
  });
}

function toReady(o: any, order: any) {
  o.setOrderStatus(order.id, 'new');
  o.setOrderStatus(order.id, 'confirmed');
  return o.setOrderStatus(order.id, 'ready_to_fulfill');
}

describe('fulfillment', () => {
  it('packs, readies, and ships a full order', async () => {
    const { o, f } = await setup();
    const order = toReady(o, makeOrder(o));

    const ful = f.startPacking(order.id);
    expect(ful.status).toBe('packing');
    expect(o.getOrder(order.id).status).toBe('packing');

    const items = o.getOrder(order.id).items;
    const candles = items.find((i) => i.description === 'Candles')!;
    const soap = items.find((i) => i.description === 'Soap')!;

    let d = f.setPackedQuantity(ful.id, { order_item_id: candles.id, quantity: 5 });
    expect(d.items.find((i) => i.description === 'Candles')!.quantity_packed).toBe(5);
    d = f.setPackedQuantity(ful.id, { order_item_id: soap.id, quantity: 2 });
    d = f.markReadyToShip(ful.id, { package_notes: 'Fragile', weight_kg: 2.5 });
    expect(d.status).toBe('ready_to_ship');
    expect(d.weight_kg).toBe(2.5);

    d = f.shipFulfillment(ful.id, {
      carrier: 'USPS',
      service: 'Priority',
      tracking_number: '94001111',
      shipped_at: '2026-11-04',
      shipping_cost_cents: 895,
    });
    expect(d.status).toBe('shipped');
    expect(d.shipment!.tracking_number).toBe('94001111');
    expect(d.shipment!.shipping_cost_cents).toBe(895);
    // Everything packed and shipped -> order shipped.
    expect(o.getOrder(order.id).status).toBe('shipped');
    const hist = o.getStatusHistory(order.id);
    expect(hist.map((h) => h.to_status)).toContain('shipped');
  });

  it('supports partial fulfillment across two shipments', async () => {
    const { o, f } = await setup();
    const order = toReady(o, makeOrder(o));
    const items = o.getOrder(order.id).items;
    const candles = items.find((i) => i.description === 'Candles')!;

    // Ship 3 of 5 candles now.
    const ful1 = f.startPacking(order.id);
    f.setPackedQuantity(ful1.id, { order_item_id: candles.id, quantity: 3 });
    f.markReadyToShip(ful1.id, {});
    f.shipFulfillment(ful1.id, { shipped_at: '2026-11-04', shipping_cost_cents: 500, tracking_number: 'T1' });

    // Order goes back to ready_to_fulfill with items remaining.
    expect(o.getOrder(order.id).status).toBe('ready_to_fulfill');

    // Second packing session for the rest.
    const ful2 = f.startPacking(order.id);
    f.setPackedQuantity(ful2.id, { order_item_id: candles.id, quantity: 2 });
    const soap = items.find((i) => i.description === 'Soap')!;
    f.setPackedQuantity(ful2.id, { order_item_id: soap.id, quantity: 2 });
    f.markReadyToShip(ful2.id, {});
    f.shipFulfillment(ful2.id, { shipped_at: '2026-11-05', shipping_cost_cents: 700, tracking_number: 'T2' });

    expect(o.getOrder(order.id).status).toBe('shipped');
    const all = f.getFulfillmentsForOrder(order.id);
    expect(all).toHaveLength(2);
    expect(all.every((x) => x.status === 'shipped')).toBe(true);
    expect(all[0].shipment!.tracking_number).toBe('T1');
    expect(all[1].shipment!.tracking_number).toBe('T2');
  });

  it('rejects over-packing beyond ordered quantity', async () => {
    const { o, f } = await setup();
    const order = toReady(o, makeOrder(o));
    const ful = f.startPacking(order.id);
    const candles = o.getOrder(order.id).items.find((i) => i.description === 'Candles')!;
    expect(() => f.setPackedQuantity(ful.id, { order_item_id: candles.id, quantity: 6 })).toThrow(/remain unpacked/i);
    // Packing 5 is fine; then a second session cannot pack more.
    f.setPackedQuantity(ful.id, { order_item_id: candles.id, quantity: 5 });
    f.markReadyToShip(ful.id, {});
    f.shipFulfillment(ful.id, { shipped_at: '2026-11-04', shipping_cost_cents: 0 });
    const ful2 = f.startPacking(order.id);
    expect(() => f.setPackedQuantity(ful2.id, { order_item_id: candles.id, quantity: 1 })).toThrow(/remain unpacked/i);
  });

  it('refuses to pack an order that is not ready', async () => {
    const { o, f } = await setup();
    const order = makeOrder(o); // draft
    expect(() => f.startPacking(order.id)).toThrow(/ready to fulfill/i);
  });

  it('refuses to mark ready with nothing packed', async () => {
    const { o, f } = await setup();
    const order = toReady(o, makeOrder(o));
    const ful = f.startPacking(order.id);
    expect(() => f.markReadyToShip(ful.id, {})).toThrow(/at least one item/i);
  });

  it('workspace buckets reflect live state', async () => {
    const { o, f } = await setup();
    const a = toReady(o, makeOrder(o));
    const b = toReady(o, makeOrder(o));
    const ws1 = f.getWorkspace();
    expect(ws1.ready_to_pack.map((x) => x.id)).toContain(a.id);
    expect(ws1.ready_to_pack.map((x) => x.id)).toContain(b.id);

    const ful = f.startPacking(a.id);
    const ws2 = f.getWorkspace();
    expect(ws2.packing.map((x) => x.id)).toContain(a.id);
    expect(ws2.ready_to_pack.map((x) => x.id)).not.toContain(a.id);

    const candles = o.getOrder(a.id).items[0];
    f.setPackedQuantity(ful.id, { order_item_id: candles.id, quantity: 5 });
    f.markReadyToShip(ful.id, {});
    const ws3 = f.getWorkspace();
    expect(ws3.ready_to_ship.map((x) => x.id)).toContain(ful.id);

    f.shipFulfillment(ful.id, { shipped_at: '2026-11-04', shipping_cost_cents: 0 });
    const ws4 = f.getWorkspace();
    expect(ws4.shipped.map((x) => x.id)).toContain(ful.id);
    // Partial: order a went back to ready_to_pack; order b untouched.
    expect(ws4.ready_to_pack.map((x) => x.id)).toContain(a.id);
  });

  it('discarding a packing session returns the order to ready_to_fulfill', async () => {
    const { o, f } = await setup();
    const order = toReady(o, makeOrder(o));
    const ful = f.startPacking(order.id);
    expect(o.getOrder(order.id).status).toBe('packing');
    f.deleteFulfillment(ful.id);
    expect(o.getOrder(order.id).status).toBe('ready_to_fulfill');
    expect(f.getFulfillmentsForOrder(order.id)).toHaveLength(0);
  });

  it('shipped fulfillments are immutable history', async () => {
    const { o, f } = await setup();
    const order = toReady(o, makeOrder(o));
    const ful = f.startPacking(order.id);
    const candles = o.getOrder(order.id).items[0];
    f.setPackedQuantity(ful.id, { order_item_id: candles.id, quantity: 5 });
    const soap = o.getOrder(order.id).items[1];
    f.setPackedQuantity(ful.id, { order_item_id: soap.id, quantity: 2 });
    f.markReadyToShip(ful.id, {});
    f.shipFulfillment(ful.id, { shipped_at: '2026-11-04', shipping_cost_cents: 0 });
    expect(() => f.deleteFulfillment(ful.id)).toThrow(/historical record/i);
    expect(() => f.setPackedQuantity(ful.id, { order_item_id: candles.id, quantity: 1 })).toThrow(/in progress/i);
  });
});
