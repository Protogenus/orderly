import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-e2e-m2-'));
});

test.afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

test('M2: customer -> product -> order -> lifecycle -> inbox', async () => {
  const app = await launchApp(dir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const sidebar = window.locator('.sidebar');

  // --- customer ---
  await sidebar.getByRole('button', { name: 'Customers', exact: true }).click();
  await window.getByRole('button', { name: 'New customer' }).first().click();
  await window.locator('#cf-name').fill('E2E Buyer');
  await window.locator('#cf-email').fill('e2e@example.com');
  await window.getByRole('button', { name: 'Create customer' }).click();
  await expect(window.getByText('E2E Buyer').first()).toBeVisible({ timeout: 8000 });

  // --- product ---
  await sidebar.getByRole('button', { name: 'Products', exact: true }).click();
  await window.getByRole('button', { name: 'New product' }).first().click();
  const modal = window.locator('.modal');
  await modal.getByLabel('Product name').fill('E2E Candle');
  await modal.getByLabel('Selling price').fill('18.00');
  await modal.getByRole('button', { name: 'Create product' }).click();
  await expect(window.getByText('E2E Candle').first()).toBeVisible({ timeout: 8000 });

  // --- order ---
  await sidebar.getByRole('button', { name: 'Orders', exact: true }).click();
  await window.getByRole('button', { name: 'New order', exact: true }).first().click();
  await window.getByRole('button', { name: 'Add item' }).click();
  await window.getByRole('button', { name: 'Choose product…' }).click();
  await window.getByPlaceholder('Search products…').fill('E2E Candle');
  await window.getByText('E2E Candle').first().click();
  // pick the customer
  await window.getByPlaceholder('Type to search…').fill('E2E Buyer');
  await window.locator('.card select').first().selectOption({ label: 'E2E Buyer' });
  await window.getByRole('button', { name: 'Create order' }).click();
  await expect(window.getByText(/ORD-/).first()).toBeVisible({ timeout: 8000 });
  const orderNumber = (await window.locator('h1.page-title').textContent()) ?? '';
  expect(orderNumber).toMatch(/ORD-\d+/);

  // --- lifecycle: draft -> new -> confirmed ---
  await window.getByLabel('Next status').selectOption('new');
  await window.getByRole('button', { name: 'Apply' }).click();
  await expect(window.getByText('New', { exact: true }).first()).toBeVisible({ timeout: 8000 });
  await window.getByLabel('Next status').selectOption('confirmed');
  await window.getByRole('button', { name: 'Apply' }).click();
  await expect(window.getByText('Confirmed', { exact: true }).first()).toBeVisible({ timeout: 8000 });

  // --- history shows the transitions ---
  await expect(window.getByText('Draft → New')).toBeVisible();
  await expect(window.getByText('New → Confirmed')).toBeVisible();

  // --- record a payment ---
  await window.getByLabel('Payment amount').fill('9.00');
  await window.getByRole('button', { name: 'Record' }).click();
  await expect(window.getByText('Payment recorded.')).toBeVisible({ timeout: 8000 });

  // --- duplicate the order ---
  await window.getByRole('button', { name: 'Duplicate' }).click();
  await expect(window.getByText(/Duplicated as ORD-/)).toBeVisible({ timeout: 8000 });

  // --- inbox shows the unreviewed draft (the duplicate) ---
  await sidebar.getByRole('button', { name: 'Inbox', exact: true }).click();
  await window.getByRole('tab', { name: 'Board' }).click();
  await expect(window.locator('.page').getByText(/ORD-/).first()).toBeVisible({ timeout: 8000 });

  // --- restart persistence: order data survives ---
  await app.close();
  const app2 = await launchApp(dir);
  const w2 = await app2.firstWindow();
  await w2.waitForLoadState('domcontentloaded');
  await w2.locator('.sidebar').getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(w2.getByText(orderNumber).first()).toBeVisible({ timeout: 8000 });
  expect(existsSync(join(dir, 'orderly.db'))).toBe(true);
  await app2.close();
});
