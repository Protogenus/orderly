import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '..');

/**
 * Launch the built app with an isolated user-data dir (so Electron's
 * single-instance lock never collides between test launches), retrying
 * briefly in case a previous run is still releasing resources.
 */
export async function launchApp(dataDir: string): Promise<ElectronApplication> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'orderly-e2e-user-'));
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const app = await electron.launch({
        args: [join(ROOT, 'out', 'main', 'index.js'), `--user-data-dir=${userDataDir}`],
        env: { ...process.env, ORDERLY_DATA_DIR: dataDir, NODE_ENV: 'production' },
      });
      await app.firstWindow({ timeout: 15000 });
      return app;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastError;
}
