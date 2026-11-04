import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

let dir: string;

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-e2e-m5-'));
});

test.afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

test('M5: overview stats -> report -> CSV import wizard', async () => {
  // ORDERLY_TEST_CSV bypasses the native file picker (cannot be driven headless);
  // set before launch since launchApp snapshots process.env.
  const fixture = join(tmpdir(), `orderly-e2e-import-${Date.now()}.csv`);
  writeFileSync(fixture, 'Full Name,E-mail Address\nImport One,one@example.com\nImport Two,two@example.com\n', 'utf-8');
  process.env.ORDERLY_TEST_CSV = fixture;
  try {
    await runM5Flow();
  } finally {
    delete process.env.ORDERLY_TEST_CSV;
  }
});

async function runM5Flow() {
  const app = await launchApp(dir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const sidebar = window.locator('.sidebar');

  // --- seed: one customer + one order via the real IPC API ---
  const seeded = await window.evaluate(async () => {
    const o = (window as unknown as { orderly: any }).orderly;
    const c = await o.createCustomer({ name: 'Report Buyer', email: 'buyer@example.com' });
    const order = await o.createOrder({
      customer_id: c.id,
      order_date: '2026-11-04',
      items: [{ description: 'E2E Widget', quantity: 2, unit_price_cents: 1500 }],
    });
    await o.setOrderStatus(order.id, 'new');
    return { orderNumber: order.order_number as string };
  });
  expect(seeded.orderNumber).toMatch(/ORD-\d+/);

  // --- overview: stat tiles reflect live data (navigate away and back to remount) ---
  await sidebar.getByRole('button', { name: 'Orders', exact: true }).click();
  await sidebar.getByRole('button', { name: 'Overview', exact: true }).click();
  const openTile = window.locator('button.card', { hasText: 'Open orders' });
  await expect(openTile).toContainText('1', { timeout: 8000 });
  await expect(window.getByText(seeded.orderNumber).first()).toBeVisible({ timeout: 8000 });

  // --- reports: run revenue report, see the seeded total ---
  await sidebar.getByRole('button', { name: 'Reports', exact: true }).click();
  await window.getByLabel('Report').selectOption('sales_over_time');
  await window.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(window.getByText('30.00').first()).toBeVisible({ timeout: 8000 });
  await expect(window.getByText(/not profit/i).first()).toBeVisible();

  // --- CSV import wizard: ORDERLY_TEST_CSV bypasses the native file picker (headless) ---
  // Everything else — parse, auto-map, validate, transactional apply — is the real path.
  await sidebar.getByRole('button', { name: 'Integrations', exact: true }).click();
  // step 1: choose data
  await window.getByLabel('What are you importing?').selectOption('customers');
  await window.getByRole('button', { name: 'Continue', exact: true }).click();
  // step 2: pick file
  await window.getByRole('button', { name: 'Choose CSV file…' }).click();
  // step 3: inspect
  await expect(window.getByText('2 data rows').first()).toBeVisible({ timeout: 8000 });
  await window.getByRole('button', { name: 'Map columns', exact: true }).click();
  // step 4: auto-mapped (Full Name -> Name, E-mail Address -> Email)
  await expect(window.getByLabel('Name *')).toHaveValue('Full Name');
  await expect(window.getByLabel('Email')).toHaveValue('E-mail Address');
  await window.getByRole('button', { name: 'Preview', exact: true }).click();
  // step 5: preview
  await expect(window.getByText('Import One').first()).toBeVisible({ timeout: 8000 });
  await window.getByRole('button', { name: 'Validate', exact: true }).click();
  // step 6: validation
  await expect(window.getByText('2 of 2 rows are ready to import.').first()).toBeVisible({ timeout: 8000 });
  await window.getByRole('button', { name: 'Continue to confirm', exact: true }).click();
  // step 7: confirm
  await window.getByRole('button', { name: 'Import 2 customers', exact: true }).click();
  // step 8: results
  await expect(window.getByText('2 customers imported.').first()).toBeVisible({ timeout: 8000 });

  // imported customers really exist
  await sidebar.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(window.getByText('Import Two').first()).toBeVisible({ timeout: 8000 });

  await app.close();
}
