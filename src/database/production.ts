import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb, tx, dataDir } from './index.js';
import { newId, nowIso } from '../domain/ids.js';
import { AppError } from '../domain/errors.js';
import {
  HANDOFF_CONTRACT,
  assertHandoffTransition,
  validateAck,
  type HandoffAck,
  type HandoffEnvelope,
} from '../domain/handoff.js';
import { getSetting } from './settings.js';
import type { HandoffStatus, ProductionHandoff } from '../shared/types.js';

type Db = ReturnType<typeof getDb>;

function outboxDir(): string {
  const dir = join(dataDir(), 'handoff', 'outbox');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function rowToHandoff(r: any): ProductionHandoff {
  return { ...r, items: JSON.parse(r.items ?? '[]') };
}

export interface NewHandoffItem {
  order_item_id: string;
  quantity: number;
}

export function createHandoff(orderId: string, items: NewHandoffItem[], moveOrderToProduction: boolean): ProductionHandoff {
  return tx((db) => {
    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId) as any;
    if (!order) throw new AppError('NOT_FOUND', 'Order not found.');
    if (items.length === 0) throw new AppError('VALIDATION', 'Select at least one line item for production.');
    const validIds = new Set(
      (db.prepare(`SELECT id, quantity FROM order_items WHERE order_id = ?`).all(orderId) as { id: string; quantity: number }[]).map((i) => i.id),
    );
    const orderQty = new Map(
      (db.prepare(`SELECT id, quantity FROM order_items WHERE order_id = ?`).all(orderId) as { id: string; quantity: number }[]).map((i) => [i.id, i.quantity]),
    );
    const normalized = items.map((it) => {
      if (!validIds.has(it.order_item_id)) throw new AppError('VALIDATION', 'A selected item does not belong to this order.');
      const max = orderQty.get(it.order_item_id)!;
      if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > max) {
        throw new AppError('VALIDATION', `Quantity for a production item must be between 1 and ${max}.`);
      }
      return { order_item_id: it.order_item_id, quantity: it.quantity };
    });
    const now = nowIso();
    const h: ProductionHandoff = {
      id: newId('hnd'),
      order_id: orderId,
      status: 'draft',
      items: normalized.map((n) => ({ ...n, description: '' })),
      envelope_path: null,
      accepted_at: null,
      progress_note: null,
      completed_at: null,
      created_at: now,
      updated_at: now,
    };
    // Fill descriptions for the record.
    const descs = db.prepare(`SELECT id, description FROM order_items WHERE order_id = ?`).all(orderId) as { id: string; description: string }[];
    const descMap = new Map(descs.map((d) => [d.id, d.description]));
    h.items = normalized.map((n) => ({ ...n, description: descMap.get(n.order_item_id) ?? '' }));
    db.prepare(
      `INSERT INTO production_handoffs (id, order_id, status, items, created_at, updated_at)
       VALUES (?, ?, 'draft', ?, ?, ?)`,
    ).run(h.id, orderId, JSON.stringify(h.items), now, now);

    if (moveOrderToProduction) {
      const from = order.status as string;
      if (from === 'confirmed' || from === 'new') {
        db.prepare(`UPDATE orders SET status = 'awaiting_production', updated_at = ? WHERE id = ?`).run(now, orderId);
        db.prepare(
          `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
           VALUES (?, ?, ?, 'awaiting_production', 'Production handoff created.', ?)`,
        ).run(newId('osh'), orderId, from, now);
      }
    }
    return h;
  });
}

/** Write the JSON envelope to the outbox and mark the handoff sent. */
export function sendHandoff(id: string): ProductionHandoff {
  return tx((db) => {
    const h = getHandoffRow(db, id);
    assertHandoffTransition(h.status, 'sent');
    const order = db.prepare(
      `SELECT o.order_number, o.requested_date, o.internal_notes, c.name AS customer_name
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    ).get(h.order_id) as any;
    const items = (h.items as { order_item_id: string; quantity: number; description: string }[]).map((it) => {
      const oi = db.prepare(`SELECT sku FROM order_items WHERE id = ?`).get(it.order_item_id) as { sku: string | null } | undefined;
      return { order_item_id: it.order_item_id, description: it.description, sku: oi?.sku ?? null, quantity: it.quantity };
    });
    const envelope: HandoffEnvelope = {
      contract: HANDOFF_CONTRACT,
      handoff_id: h.id,
      order_id: h.order_id,
      order_number: order.order_number,
      customer_name: order.customer_name ?? null,
      requested_date: order.requested_date ?? null,
      items,
      notes: order.internal_notes ?? null,
      created_at: new Date().toISOString(),
    };
    const dir = outboxDir();
    // If StagePoint's inbox is configured and exists, deliver there directly; otherwise our outbox.
    const inbox = configuredInboxDir();
    const dest = inbox ? join(inbox, `${h.id}.json`) : join(dir, `${h.id}.json`);
    writeFileSync(dest, JSON.stringify(envelope, null, 2), 'utf-8');
    const now = nowIso();
    db.prepare(`UPDATE production_handoffs SET status = 'sent', envelope_path = ?, updated_at = ? WHERE id = ?`).run(dest, now, id);
    return { ...h, status: 'sent' as const, envelope_path: dest, updated_at: now };
  });
}

function getHandoffRow(db: Db, id: string): ProductionHandoff {
  const row = db.prepare(`SELECT * FROM production_handoffs WHERE id = ?`).get(id) as any;
  if (!row) throw new AppError('NOT_FOUND', 'Production handoff not found.');
  return rowToHandoff(row);
}

export function getHandoff(id: string): ProductionHandoff {
  return tx((db) => getHandoffRow(db, id));
}

export function listHandoffs(orderId?: string): (ProductionHandoff & { order_number: string })[] {
  const db = getDb();
  const rows = orderId
    ? (db.prepare(
        `SELECT h.*, o.order_number FROM production_handoffs h JOIN orders o ON o.id = h.order_id WHERE h.order_id = ? ORDER BY h.created_at DESC`,
      ).all(orderId) as any[])
    : (db.prepare(
        `SELECT h.*, o.order_number FROM production_handoffs h JOIN orders o ON o.id = h.order_id ORDER BY h.created_at DESC LIMIT 200`,
      ).all() as any[]);
  return rows.map((r) => ({ ...rowToHandoff(r), order_number: r.order_number }));
}

/** Manual status update when operating without (or alongside) an integration. */
export function updateHandoffStatus(id: string, to: HandoffStatus, note?: string | null): ProductionHandoff {
  return tx((db) => {
    const h = getHandoffRow(db, id);
    assertHandoffTransition(h.status, to);
    const now = nowIso();
    const patch: Record<string, unknown> = { status: to, updated_at: now };
    if (note !== undefined) patch.progress_note = note;
    if (to === 'accepted' && !h.accepted_at) patch.accepted_at = now;
    if (to === 'completed') patch.completed_at = now;
    const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE production_handoffs SET ${sets} WHERE id = ?`).run(...Object.values(patch), id);
    const updated = getHandoffRow(db, id);
    if (to === 'completed') maybeAdvanceOrder(db, updated);
    return updated;
  });
}

/** When a handoff completes, move the order along if it was waiting on production. */
function maybeAdvanceOrder(db: Db, h: ProductionHandoff): void {
  const o = db.prepare(`SELECT status FROM orders WHERE id = ?`).get(h.order_id) as { status: string };
  if (o.status === 'awaiting_production' || o.status === 'in_production') {
    const now = nowIso();
    db.prepare(`UPDATE orders SET status = 'in_production', updated_at = ? WHERE id = ?`).run(now, h.order_id);
    db.prepare(
      `INSERT INTO order_status_history (id, order_id, from_status, to_status, note, created_at)
       VALUES (?, ?, ?, 'in_production', 'Production handoff completed; ready for next step.', ?)`,
    ).run(newId('osh'), h.order_id, o.status, now);
  }
}

export function deleteHandoff(id: string): void {
  tx((db) => {
    const h = getHandoffRow(db, id);
    if (h.status !== 'draft') throw new AppError('CONFLICT', 'Only a draft handoff can be deleted.');
    db.prepare(`DELETE FROM production_handoffs WHERE id = ?`).run(id);
  });
}

function configuredInboxDir(): string | null {
  const dir = getSetting('stagepoint_inbox_dir');
  if (dir && existsSync(dir)) return dir;
  return null;
}

export interface StagepointDetection {
  connected: boolean;
  inbox_dir: string | null;
  outbox_dir: string;
  message: string;
}

/** Honest detection: connected only when the user has pointed Orderly at a real inbox directory. */
export function detectStagepoint(): StagepointDetection {
  const inbox = configuredInboxDir();
  const outbox = outboxDir();
  if (inbox) {
    return {
      connected: true,
      inbox_dir: inbox,
      outbox_dir: outbox,
      message: `StagePoint inbox found at ${inbox}. Envelopes are delivered there directly.`,
    };
  }
  const configured = getSetting('stagepoint_inbox_dir');
  return {
    connected: false,
    inbox_dir: null,
    outbox_dir: outbox,
    message: configured
      ? `Configured StagePoint inbox not found at ${configured}. Envelopes are saved to Orderly's outbox instead.`
      : 'StagePoint is not connected. Envelopes are saved to Orderly\'s outbox folder; set the StagePoint inbox directory in Settings to connect.',
  };
}

/** Scan the outbox for StagePoint acknowledgement files and apply them. Returns applied count. */
export function checkForAcks(): { applied: number; errors: string[] } {
  const dir = outboxDir();
  const errors: string[] = [];
  let applied = 0;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.ack.json'));
  } catch {
    return { applied: 0, errors: ['Could not read the handoff outbox.'] };
  }
  for (const file of files) {
    try {
      const ack = validateAck(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
      tx((db) => {
        const h = getHandoffRow(db, ack.handoff_id);
        if (h.status === ack.status) return;
        assertHandoffTransition(h.status, ack.status);
        const now = nowIso();
        const patch: Record<string, unknown> = { status: ack.status, updated_at: now, progress_note: ack.progress_note };
        if (ack.status === 'accepted' && !h.accepted_at) patch.accepted_at = now;
        if (ack.status === 'completed') patch.completed_at = now;
        const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE production_handoffs SET ${sets} WHERE id = ?`).run(...Object.values(patch), ack.handoff_id);
        if (ack.status === 'completed') maybeAdvanceOrder(db, { ...h, status: 'completed' });
      });
      applied++;
    } catch (e) {
      errors.push(`${file}: ${e instanceof Error ? e.message : 'invalid ack'}`);
    }
  }
  return { applied, errors };
}

export function applyAckObject(raw: unknown): HandoffAck {
  return validateAck(raw);
}
