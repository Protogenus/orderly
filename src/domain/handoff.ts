import { AppError } from './errors.js';
import type { HandoffStatus } from '../shared/types.js';

export const HANDOFF_CONTRACT = 'cleversignal.production-handoff/1';

export interface HandoffEnvelopeItem {
  order_item_id: string;
  description: string;
  sku: string | null;
  quantity: number;
}

export interface HandoffEnvelope {
  contract: typeof HANDOFF_CONTRACT;
  handoff_id: string;
  order_id: string;
  order_number: string;
  customer_name: string | null;
  requested_date: string | null;
  items: HandoffEnvelopeItem[];
  notes: string | null;
  created_at: string;
}

export interface HandoffAck {
  contract: typeof HANDOFF_CONTRACT;
  handoff_id: string;
  status: 'accepted' | 'in_progress' | 'completed' | 'failed';
  progress_note: string | null;
  updated_at: string;
}

const HANDOFF_TRANSITIONS: Record<HandoffStatus, HandoffStatus[]> = {
  draft: ['sent', 'failed'],
  sent: ['accepted', 'in_progress', 'completed', 'failed'],
  accepted: ['in_progress', 'completed', 'failed'],
  in_progress: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export function canTransitionHandoff(from: HandoffStatus, to: HandoffStatus): boolean {
  return (HANDOFF_TRANSITIONS[from] ?? []).includes(to);
}

export function assertHandoffTransition(from: HandoffStatus, to: HandoffStatus): void {
  if (from === to) return;
  if (!canTransitionHandoff(from, to)) {
    throw new AppError('ILLEGAL_TRANSITION', `Cannot move a handoff from "${from}" to "${to}".`);
  }
}

export function validateEnvelope(raw: unknown): HandoffEnvelope {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.contract !== HANDOFF_CONTRACT) throw new AppError('VALIDATION', 'Unknown handoff contract version.');
  if (typeof o.handoff_id !== 'string' || !o.handoff_id) throw new AppError('VALIDATION', 'Envelope is missing handoff_id.');
  if (!Array.isArray(o.items) || o.items.length === 0) throw new AppError('VALIDATION', 'Envelope has no items.');
  for (const [i, item] of (o.items as unknown[]).entries()) {
    const it = (item ?? {}) as Record<string, unknown>;
    if (typeof it.description !== 'string' || !it.description.trim()) {
      throw new AppError('VALIDATION', `Envelope item ${i + 1} is missing a description.`);
    }
    if (!Number.isInteger(it.quantity) || (it.quantity as number) < 1) {
      throw new AppError('VALIDATION', `Envelope item ${i + 1} has an invalid quantity.`);
    }
  }
  return o as unknown as HandoffEnvelope;
}

export function validateAck(raw: unknown): HandoffAck {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.contract !== HANDOFF_CONTRACT) throw new AppError('VALIDATION', 'Unknown ack contract version.');
  if (typeof o.handoff_id !== 'string' || !o.handoff_id) throw new AppError('VALIDATION', 'Ack is missing handoff_id.');
  if (!['accepted', 'in_progress', 'completed', 'failed'].includes(o.status as string)) {
    throw new AppError('VALIDATION', `Ack has an invalid status: ${String(o.status)}.`);
  }
  return {
    contract: HANDOFF_CONTRACT,
    handoff_id: o.handoff_id as string,
    status: o.status as HandoffAck['status'],
    progress_note: typeof o.progress_note === 'string' ? o.progress_note : null,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : new Date().toISOString(),
  };
}
