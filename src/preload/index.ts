import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';
import type { AppInfo, BackupResult } from '../shared/types.js';

/** Unwrap the IPC envelope; surface main-process errors as thrown Errors. */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((res) => {
    if (res && res.ok === true) return res.data as T;
    const message =
      res && res.error && typeof res.error.message === 'string'
        ? res.error.message
        : 'An unexpected error occurred.';
    const error = new Error(message) as Error & { code?: string };
    if (res && res.error && typeof res.error.code === 'string') error.code = res.error.code;
    throw error;
  });
}

/** Restricted API surface exposed to the renderer. No database access. */
const api = {
  getAppInfo: () => invoke<AppInfo>(IPC.appGetInfo),
  getSettings: () => invoke<Record<string, string>>(IPC.settingsGet),
  setSetting: (key: string, value: string) => invoke<string | null>(IPC.settingsSet, key, value),
  createBackup: () => invoke<BackupResult>(IPC.backupCreate),
  restoreBackup: () => invoke<null>(IPC.backupRestore),
  pickBackupFile: () => invoke<string | null>(IPC.dialogPickBackupFile),
};

export type OrderlyApi = typeof api;

contextBridge.exposeInMainWorld('orderly', api);

declare global {
  interface Window {
    orderly: OrderlyApi;
  }
}
