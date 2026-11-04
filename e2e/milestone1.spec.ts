import { test, expect } from '@playwright/test';
import { launchApp } from './helpers';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

let dir: string;

test.beforeAll(() => {
  // Build fresh so E2E always runs the current source.
  execSync('npm run build', { cwd: join(__dirname, '..'), stdio: 'pipe' });
});

test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orderly-e2e-'));
});

test.afterEach(async () => {
  rmSync(dir, { recursive: true, force: true });
});

test('M1: app boots, all nav sections render, settings persist', async () => {
  const app = await launchApp(dir);
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Sidebar brand visible.
  await expect(window.getByText('Orderly', { exact: false }).first()).toBeVisible();

  // Click through all 9 primary nav sections; each must render without error.
  const nav = ['Overview', 'Inbox', 'Orders', 'Customers', 'Products', 'Fulfillment', 'Production', 'Returns', 'Reports', 'Integrations', 'Settings'];
  const sidebar = window.locator('.sidebar');
  for (const label of nav) {
    await sidebar.getByRole('button', { name: label, exact: true }).click();
    await expect(window.locator('.workspace')).toBeVisible();
  }

  // Settings page: save company name, then reload and verify persistence.
  await sidebar.getByRole('button', { name: 'Settings', exact: true }).click();
  await window.locator('#company').fill('Acme Candle Co');
  await window.getByRole('button', { name: 'Save settings' }).click();
  await expect(window.getByText('Settings saved.')).toBeVisible({ timeout: 5000 });

  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await expect(window.locator('#company')).toHaveValue('Acme Candle Co');

  // Database file was created in the scratch data dir.
  expect(existsSync(join(dir, 'orderly.db'))).toBe(true);

  await app.close();
});
