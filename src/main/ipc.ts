import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import { statSync } from 'fs';
import { IPC } from '../shared/ipc.js';
import type { IpcErr, IpcOk, AppInfo, BackupResult } from '../shared/types.js';
import { AppError } from '../domain/errors.js';
import { getAllSettings, getSetting, setSetting } from '../database/settings.js';
import { getDbPath, dataDir } from '../database/index.js';
import { backupNow, restoreFlow } from './index.js';
import { optString, reqString } from '../shared/validate.js';

function ok<T>(data: T): IpcOk<T> {
  return { ok: true, data };
}
function err(e: unknown): IpcErr {
  if (e instanceof AppError) return { ok: false, error: { code: e.code, message: e.message } };
  const message = e instanceof Error ? e.message : 'An unexpected error occurred.';
  return { ok: false, error: { code: 'INTERNAL', message } };
}

function handle<T>(channel: string, fn: (...args: any[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return ok(await fn(...args));
    } catch (e) {
      return err(e);
    }
  });
}

const ALLOWED_SETTINGS = new Set([
  'company_name',
  'order_number_prefix',
  'default_currency',
  'sample_data_enabled',
  'last_page',
]);

export function registerIpc(): void {
  handle<AppInfo>(IPC.appGetInfo, () => ({
    version: app.getVersion(),
    dataDir: dataDir(),
    dbPath: getDbPath(),
  }));

  handle(IPC.settingsGet, () => getAllSettings());

  handle(IPC.settingsSet, (key: unknown, value: unknown) => {
    const k = reqString(key, 'setting key', 64);
    if (!ALLOWED_SETTINGS.has(k)) throw new AppError('VALIDATION', `Unknown setting: ${k}.`);
    if (k === 'sample_data_enabled') {
      const v = optString(value, 'value', 8);
      if (v !== '0' && v !== '1') throw new AppError('VALIDATION', 'sample_data_enabled must be 0 or 1.');
      setSetting(k, v ?? '0');
    } else if (k === 'default_currency') {
      setSetting(k, reqString(value, 'value', 8).toUpperCase());
    } else {
      setSetting(k, optString(value, 'value', 200) ?? '');
    }
    return getSetting(k);
  });

  handle<BackupResult>(IPC.backupCreate, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose backup location',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) {
      throw new AppError('CANCELED', 'Backup canceled.');
    }
    const path = backupNow(res.filePaths[0]);
    const size = statSync(path).size;
    return { path, size_bytes: size };
  });

  handle(IPC.backupRestore, async () => {
    await restoreFlow();
    return null;
  });

  handle<string | null>(IPC.dialogPickBackupFile, async () => {
    const win = BrowserWindow.getFocusedWindow();
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose an Orderly backup file',
      filters: [{ name: 'Orderly backups', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
}
