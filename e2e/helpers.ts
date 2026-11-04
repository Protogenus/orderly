import { _electron as electron, type ElectronApplication } from '@playwright/test';
import { join } from 'path';

const ROOT = join(__dirname, '..');

/** Launch the built app, retrying past a stale single-instance lock from a just-closed run. */
export async function launchApp(dataDir: string): Promise<ElectronApplication> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const app = await electron.launch({
        args: [join(ROOT, 'out', 'main', 'index.js')],
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
