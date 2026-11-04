import { canTransition } from '../shared/constants.js';
import type { OrderStatus } from '../shared/types.js';
import { AppError } from './errors.js';

export { lineTotal, computeTotals } from '../shared/totals.js';
export type { TotalsInput, OrderTotals } from '../shared/totals.js';

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new AppError(
      'ILLEGAL_TRANSITION',
      `Cannot move an order from "${from}" to "${to}".`,
    );
  }
}

/** Next order number from prefix + counter settings; caller persists the incremented counter. */
export function nextOrderNumber(prefix: string, next: number): { order_number: string; next_counter: number } {
  if (!Number.isInteger(next) || next < 1) throw new AppError('VALIDATION', 'Order number counter is invalid.');
  return { order_number: `${prefix}${next}`, next_counter: next + 1 };
}
