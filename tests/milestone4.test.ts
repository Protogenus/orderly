import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-m4-'));
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
  const p = await import('../src/database/production.js');
  const r = await import('../src/database/returns.js');
  return { o, p, r };
}

function makeOrder(o: any) {
  const order = o.createOrder({
    order_date: '2026-11-04',
    items: [
      { description: 'Candles', quantity: 5, unit_price_cents: 1500, requires_production: true },
      { description: 'Soap', quantity: 2, unit_price_cents: 800 },
    ],
  });
  o.setOrderStatus(order.id, 'new');
  o.setOrderStatus(order.id, 'confirmed');
  return order;
}

describe('production handoff', () => {
  it('creates a draft handoff, writes a valid envelope, and tracks status', async () => {
    const { o, p } = await setup();
    const order = makeOrder(o);
    const items = o.getOrder(order.id).items;
    const candles = items.find((i: any) => i.description === 'Candles')!;

    const h = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 5 }], true);
    expect(h.status).toBe('draft');
    expect(h.items[0].description).toBe('Candles');
    // move_order moved confirmed -> awaiting_production
    expect(o.getOrder(order.id).status).toBe('awaiting_production');

    const sent = p.sendHandoff(h.id);
    expect(sent.status).toBe('sent');
    expect(sent.envelope_path).toBeTruthy();
    expect(existsSync(sent.envelope_path!)).toBe(true);

    // Envelope validates against the contract.
    const { validateEnvelope } = await import('../src/domain/handoff.js');
    const raw = JSON.parse((await import('fs')).readFileSync(sent.envelope_path!, 'utf-8'));
    const env = validateEnvelope(raw);
    expect(env.contract).toBe('cleversignal.production-handoff/1');
    expect(env.order_number).toMatch(/ORD-/);
    expect(env.items).toHaveLength(1);
    expect(env.items[0].quantity).toBe(5);
  });

  it('is honest about StagePoint not being connected', async () => {
    const { p } = await setup();
    const d = p.detectStagepoint();
    expect(d.connected).toBe(false);
    expect(d.message).toMatch(/not connected/i);
  });

  it('applies StagePoint ack files from the outbox', async () => {
    const { o, p } = await setup();
    const order = makeOrder(o);
    const candles = o.getOrder(order.id).items[0];
    const h = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 5 }], false);
    const sent = p.sendHandoff(h.id);

    // Simulate StagePoint writing an ack.
    const ack = {
      contract: 'cleversignal.production-handoff/1',
      handoff_id: h.id,
      status: 'accepted',
      progress_note: 'Scheduled for Monday.',
      updated_at: new Date().toISOString(),
    };
    writeFileSync(sent.envelope_path!.replace(/\.json$/, '.ack.json'), JSON.stringify(ack));

    const res = p.checkForAcks();
    expect(res.applied).toBe(1);
    expect(res.errors).toHaveLength(0);
    const updated = p.getHandoff(h.id);
    expect(updated.status).toBe('accepted');
    expect(updated.progress_note).toBe('Scheduled for Monday.');
    expect(updated.accepted_at).toBeTruthy();
  });

  it('rejects invalid acks without corrupting state', async () => {
    const { o, p } = await setup();
    const order = makeOrder(o);
    const candles = o.getOrder(order.id).items[0];
    const h = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 5 }], false);
    p.sendHandoff(h.id);
    const outbox = join(dir, 'handoff', 'outbox');
    writeFileSync(join(outbox, `${h.id}.ack.json`), JSON.stringify({ contract: 'nope', handoff_id: h.id, status: 'completed' }));
    const res = p.checkForAcks();
    expect(res.applied).toBe(0);
    expect(res.errors).toHaveLength(1);
    expect(p.getHandoff(h.id).status).toBe('sent');
  });

  it('allows manual status updates when unintegrated', async () => {
    const { o, p } = await setup();
    const order = makeOrder(o);
    const candles = o.getOrder(order.id).items[0];
    const h = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 5 }], true);
    p.sendHandoff(h.id);
    const done = p.updateHandoffStatus(h.id, 'completed', 'Made by hand.');
    expect(done.status).toBe('completed');
    expect(done.completed_at).toBeTruthy();
    // Order was awaiting_production -> moved to in_production on completion.
    expect(o.getOrder(order.id).status).toBe('in_production');
    // Illegal jump: draft handoff cannot go straight to completed.
    const h2 = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 1 }], false);
    expect(() => p.updateHandoffStatus(h2.id, 'completed')).toThrow(/cannot move/i);
  });

  it('only drafts can be deleted', async () => {
    const { o, p } = await setup();
    const order = makeOrder(o);
    const candles = o.getOrder(order.id).items[0];
    const h = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 5 }], false);
    p.deleteHandoff(h.id);
    expect(() => p.getHandoff(h.id)).toThrow(/not found/i);
    const h2 = p.createHandoff(order.id, [{ order_item_id: candles.id, quantity: 5 }], false);
    p.sendHandoff(h2.id);
    expect(() => p.deleteHandoff(h2.id)).toThrow(/only a draft/i);
  });
});

describe('returns', () => {
  it('creates a return, enforces quantities, and walks the lifecycle', async () => {
    const { o, r } = await setup();
    const order = makeOrder(o);
    const items = o.getOrder(order.id).items;
    const candles = items.find((i: any) => i.description === 'Candles')!;

    const ret = r.createReturn(order.id, {
      reason: 'Damaged in transit',
      internal_notes: 'Customer sent photos.',
      items: [{ order_item_id: candles.id, quantity: 2, reason: 'Broken jars' }],
    });
    expect(ret.status).toBe('requested');
    expect(ret.items).toHaveLength(1);
    expect(ret.items[0].quantity_ordered).toBe(5);

    // Cannot return more than ordered minus already-returned.
    expect(() =>
      r.createReturn(order.id, { items: [{ order_item_id: candles.id, quantity: 4 }] }),
    ).toThrow(/only 3/i);

    const approved = r.updateReturnStatus(ret.id, 'approved');
    expect(approved.status).toBe('approved');
    expect(() => r.updateReturnStatus(ret.id, 'resolved')).toThrow(/cannot move/i);
    const resolved = ['awaiting_return', 'received', 'inspected', 'resolved'].reduce(
      (id, s) => r.updateReturnStatus(id, s as any).id,
      ret.id,
    );
    expect(r.getReturn(resolved).status).toBe('resolved');

    const listed = r.listReturns({});
    expect(listed.map((x) => x.id)).toContain(ret.id);
    expect(listed[0].order_number).toMatch(/ORD-/);
  });

  it('links a replacement order and records refund status', async () => {
    const { o, r } = await setup();
    const order = makeOrder(o);
    const replacement = o.createOrder({ order_date: '2026-11-04', items: [{ description: 'Candles', quantity: 2, unit_price_cents: 1500 }] });
    const candles = o.getOrder(order.id).items[0];
    const ret = r.createReturn(order.id, { items: [{ order_item_id: candles.id, quantity: 1 }] });
    const updated = r.updateReturn(ret.id, {
      replacement_order_id: replacement.id,
      refund_status: 'Refund issued via original payment method (informational).',
    });
    expect(updated.replacement_order_id).toBe(replacement.id);
    expect(updated.refund_status).toMatch(/informational/);
    // Cannot link the original order as its own replacement.
    expect(() => r.updateReturn(ret.id, { replacement_order_id: order.id })).toThrow(/cannot be the original/i);
  });
});
