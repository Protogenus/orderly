import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { launchApp } from './helpers';

let dir: string;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-e2e-m3-'));
});

test.afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

test('M3: partial fulfillment across two shipments, then print slip', async () => {
  const app = await launchApp(dir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const sidebar = window.locator('.sidebar');

  // Seed an order ready to fulfill via the real IPC API.
  const orderId = await window.evaluate(async () => {
    const o = await window.orderly.createOrder({
      order_date: '2026-11-04',
      source: 'Manual',
      items: [
        { description: 'E2E Candle', quantity: 5, unit_price_cents: 1500 },
        { description: 'E2E Soap', quantity: 2, unit_price_cents: 800 },
      ],
    });
    await window.orderly.setOrderStatus(o.id, 'new');
    await window.orderly.setOrderStatus(o.id, 'confirmed');
    await window.orderly.setOrderStatus(o.id, 'ready_to_fulfill');
    return o.id;
  });

  // --- fulfillment workspace: start packing ---
  await sidebar.getByRole('button', { name: 'Fulfillment', exact: true }).click();
  await expect(window.getByText('E2E Candle').first()).toBeHidden({ timeout: 5000 }).catch(() => {});
  const readyTab = window.getByRole('tab', { name: /Ready to pack/ });
  await expect(readyTab).toBeVisible();
  await window.getByRole('button', { name: 'Start packing' }).click();
  const dialog = window.locator('.modal');
  await expect(dialog.getByText(/Packing ORD-/)).toBeVisible({ timeout: 8000 });
  await expect(dialog.getByLabel('Pack quantity for E2E Candle')).toBeVisible({ timeout: 8000 });

  // Pack 3 of 5 candles (partial).
  await dialog.getByLabel('Pack quantity for E2E Candle').fill('3');
  await dialog.getByRole('button', { name: 'Mark ready to ship' }).click();
  await expect(dialog).toBeHidden({ timeout: 8000 });

  // --- ship the partial package ---
  await window.getByRole('tab', { name: /Ready to ship/ }).click();
  await window.getByRole('button', { name: 'Ship…' }).click();
  const shipModal = window.locator('.modal');
  await shipModal.getByLabel('Carrier').fill('USPS');
  await shipModal.getByLabel('Tracking number').fill('TRACK-001');
  await shipModal.getByLabel('Shipping cost').fill('8.95');
  await shipModal.getByRole('button', { name: 'Record shipment' }).click();
  await expect(window.getByText('Shipment recorded.').first()).toBeVisible({ timeout: 8000 });

  // Order went back to ready_to_fulfill (2 candles + 2 soaps remain).
  const orderAfterPartial = await window.evaluate(async (id: string) => {
    const o = await window.orderly.getOrder(id);
    return o.status;
  }, orderId);
  expect(orderAfterPartial).toBe('ready_to_fulfill');

  // --- second packing round for the remainder ---
  await window.getByRole('tab', { name: /Ready to pack/ }).click();
  await window.getByRole('button', { name: 'Start packing' }).click();
  const dialog2 = window.locator('.modal');
  await expect(dialog2.getByText(/Packing ORD-/)).toBeVisible({ timeout: 8000 });
  await expect(dialog2.getByLabel('Pack quantity for E2E Candle')).toBeVisible({ timeout: 8000 });
  await dialog2.getByLabel('Pack quantity for E2E Candle').fill('2');
  await dialog2.getByLabel('Pack quantity for E2E Soap').fill('2');
  await dialog2.getByRole('button', { name: 'Mark ready to ship' }).click();
  await window.getByRole('tab', { name: /Ready to ship/ }).click();
  await window.getByRole('button', { name: 'Ship…' }).click();
  const shipModal2 = window.locator('.modal');
  await shipModal2.getByLabel('Tracking number').fill('TRACK-002');
  await shipModal2.getByRole('button', { name: 'Record shipment' }).click();
  await expect(window.getByText('Shipment recorded.').first()).toBeVisible({ timeout: 8000 });

  // Everything shipped -> order status shipped; two shipment records exist.
  const final = await window.evaluate(async (id: string) => {
    const o = await window.orderly.getOrder(id);
    const fuls = await window.orderly.getFulfillmentsForOrder(id);
    return { status: o.status, shipments: fuls.filter((f) => f.shipment).length };
  }, orderId);
  expect(final.status).toBe('shipped');
  expect(final.shipments).toBe(2);

  // --- print smoke: packing slip renders into the print area ---
  // Headless Electron blocks on window.print(), so stub it: we verify the app
  // invokes printing with the correct document rendered.
  await window.evaluate(() => {
    (window as unknown as { __printed: boolean }).__printed = false;
    window.print = () => {
      (window as unknown as { __printed: boolean }).__printed = true;
    };
  });
  await window.getByRole('tab', { name: /Shipped/ }).click();
  await window.getByRole('button', { name: 'Packing slip' }).first().click();
  const printArea = window.locator('.print-area');
  await expect(printArea.getByText('PACKING SLIP')).toBeAttached({ timeout: 8000 });
  expect(await printArea.getByText('E2E Candle').count()).toBeGreaterThan(0);
  // Print fires and the doc unmounts afterwards.
  await expect(printArea).toHaveCount(0, { timeout: 8000 });
  expect(await window.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);

  await app.close();
});
