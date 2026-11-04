import type { PaymentStatus } from './types.js';

export interface TotalsInput {
  items: { quantity: number; unit_price_cents: number; discount_cents: number; tax_cents: number }[];
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  paid_cents: number;
}

export interface OrderTotals {
  subtotal_cents: number;
  discount_cents: number;
  shipping_cents: number;
  tax_cents: number;
  grand_total_cents: number;
  balance_cents: number;
  payment_status: PaymentStatus;
}

export function lineTotal(item: { quantity: number; unit_price_cents: number; discount_cents: number; tax_cents: number }): number {
  return item.quantity * item.unit_price_cents - item.discount_cents + item.tax_cents;
}

/** All money math in integer cents. No floats anywhere. Shared by main and renderer. */
export function computeTotals(input: TotalsInput): OrderTotals {
  const subtotal = input.items.reduce(
    (s, i) => s + i.quantity * i.unit_price_cents - i.discount_cents,
    0,
  );
  const grand = subtotal - input.discount_cents + input.tax_cents + input.shipping_cents;
  const balance = grand - input.paid_cents;
  let payment_status: PaymentStatus = 'unpaid';
  if (input.paid_cents > 0 && balance > 0) payment_status = 'partial';
  else if (balance === 0 && grand > 0) payment_status = 'paid';
  else if (balance < 0) payment_status = 'overpaid';
  return {
    subtotal_cents: subtotal,
    discount_cents: input.discount_cents,
    shipping_cents: input.shipping_cents,
    tax_cents: input.tax_cents,
    grand_total_cents: grand,
    balance_cents: balance,
    payment_status,
  };
}
