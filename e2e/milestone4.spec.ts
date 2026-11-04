import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launchApp } from './helpers';

let dir: string;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-e2e-m4-'));
});

test.afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

test('M4: production handoff (honest unconnected) + returns lifecycle', async () => {
  const app = await launchApp(dir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const sidebar = window.locator('.sidebar');

  // Seed an order with a production-flagged item.
  const orderId = await window.evaluate(async () => {
    const o = await window.orderly.createOrder({
      order_date: '2026-11-04',
      source: 'Manual',
      items: [
        { description: 'E2E Candle', quantity: 10, unit_price_cents: 1500, requires_production: true },
        { description: 'E2E Soap', quantity: 2, unit_price_cents: 800 },
      ],
    });
    await window.orderly.setOrderStatus(o.id, 'new');
    await window.orderly.setOrderStatus(o.id, 'confirmed');
    return o.id;
  });

  // --- production page: honest "not connected" state ---
  await sidebar.getByRole('button', { name: 'Production', exact: true }).click();
  await expect(window.getByText('StagePoint not connected')).toBeVisible({ timeout: 8000 });

  // --- create a handoff for the order ---
  await window.getByPlaceholder('Find order by number…').fill('ORD-');
  await window.getByRole('button', { name: 'New handoff' }).first().click();
  const composer = window.locator('.modal');
  await expect(composer.getByText(/Production handoff/)).toBeVisible({ timeout: 8000 });
  // The production-flagged item is pre-selected; soap is not.
  const candleBox = composer.getByLabel('Include E2E Candle');
  await expect(candleBox).toBeChecked();
  await expect(composer.getByLabel('Include E2E Soap')).not.toBeChecked();
  await composer.getByRole('button', { name: 'Create and send handoff' }).click();
  await expect(window.getByText('Handoff sent.')).toBeVisible({ timeout: 8000 });

  // Handoff appears as sent; order moved to awaiting_production.
  await expect(window.locator('.page').getByText('sent', { exact: true }).first()).toBeVisible({ timeout: 8000 });
  const orderStatus = await window.evaluate(async (id: string) => {
    return (await window.orderly.getOrder(id)).status;
  }, orderId);
  expect(orderStatus).toBe('awaiting_production');

  // --- manual status update (unintegrated operation) ---
  await window.getByRole('button', { name: 'Update status' }).first().click();
  const statusModal = window.locator('.modal');
  await statusModal.getByLabel('New status').selectOption('completed');
  await statusModal.getByLabel('Note').fill('Made in the workshop.');
  await statusModal.getByRole('button', { name: 'Apply' }).click();
  await expect(window.getByText('completed', { exact: true }).first()).toBeVisible({ timeout: 8000 });

  // --- returns: start a return from the order ---
  await sidebar.getByRole('button', { name: 'Returns', exact: true }).click();
  await window.getByPlaceholder('Find order to start a return…').fill('ORD-');
  await window.getByRole('button', { name: 'Start return' }).first().click();
  const retComposer = window.locator('.modal');
  await expect(retComposer.getByText(/New return/)).toBeVisible({ timeout: 8000 });
  await retComposer.getByLabel('Return E2E Candle').check();
  await retComposer.getByLabel('Return quantity for E2E Candle').fill('2');
  await retComposer.getByLabel("Return reason").first().fill('Damaged in transit');
  await retComposer.getByRole('button', { name: 'Create return request' }).click();
  await expect(window.getByText('Return request created.')).toBeVisible({ timeout: 8000 });

  // --- walk the return lifecycle ---
  await window.locator('.page table.data tbody tr').first().click();
  await expect(window.getByRole('heading', { name: 'Returned items' })).toBeVisible({ timeout: 8000 });
  for (const s of ['approved', 'awaiting_return', 'received', 'inspected', 'resolved']) {
    await window.getByLabel('Next return status').selectOption(s);
    await window.getByRole('button', { name: 'Apply' }).click();
    await expect(window.getByText(`Return marked ${s.replace(/_/g, ' ')}.`)).toBeVisible({ timeout: 8000 });
  }

  // --- refund status is informational ---
  await window.getByLabel('Refund status').fill('Refunded $30.00 via card (recorded manually).');
  await window.getByRole('button', { name: 'Save details' }).click();
  await expect(window.getByText('Return updated.')).toBeVisible({ timeout: 8000 });

  await app.close();
});
