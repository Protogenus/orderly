import type { OrderStatus, ReturnStatus } from './types.js';

/** Allowed lifecycle transitions. Key = current status, value = reachable statuses. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['new', 'canceled'],
  new: ['confirmed', 'on_hold', 'canceled'],
  confirmed: ['awaiting_production', 'ready_to_fulfill', 'on_hold', 'canceled'],
  awaiting_production: ['in_production', 'on_hold', 'canceled'],
  in_production: ['ready_to_fulfill', 'on_hold'],
  ready_to_fulfill: ['packing', 'on_hold', 'canceled'],
  packing: ['shipped', 'ready_to_fulfill', 'on_hold'],
  shipped: ['delivered'],
  delivered: ['completed'],
  completed: [],
  on_hold: ['new', 'confirmed', 'awaiting_production', 'in_production', 'ready_to_fulfill', 'canceled'],
  canceled: [],
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: 'Draft',
  new: 'New',
  confirmed: 'Confirmed',
  awaiting_production: 'Awaiting Production',
  in_production: 'In Production',
  ready_to_fulfill: 'Ready to Fulfill',
  packing: 'Packing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  on_hold: 'On Hold',
  canceled: 'Canceled',
};

export const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['awaiting_return', 'rejected'],
  awaiting_return: ['received'],
  received: ['inspected'],
  inspected: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

export const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  awaiting_return: 'Awaiting Return',
  received: 'Received',
  inspected: 'Inspected',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

export const ORDER_SOURCES = ['Manual', 'Etsy', 'Shopify', 'WooCommerce', 'eBay', 'Amazon', 'CSV Import', 'Other'] as const;

export const PRIORITY_LABELS = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' } as const;

/** Statuses that count as "open" for the dashboard. */
export const OPEN_STATUSES: OrderStatus[] = [
  'new',
  'confirmed',
  'awaiting_production',
  'in_production',
  'ready_to_fulfill',
  'packing',
  'shipped',
  'delivered',
  'on_hold',
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] ?? []).includes(to);
}

export function canTransitionReturn(from: ReturnStatus, to: ReturnStatus): boolean {
  return (RETURN_TRANSITIONS[from] ?? []).includes(to);
}
