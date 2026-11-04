/** Typed wrapper over window.orderly (the restricted preload API). */
export const api = () => window.orderly;

export async function getAppInfo() {
  return api().getAppInfo();
}
export async function getSettings() {
  return api().getSettings();
}
export async function setSetting(key: string, value: string) {
  return api().setSetting(key, value);
}
export async function createBackup() {
  return api().createBackup();
}
export async function restoreBackup() {
  return api().restoreBackup();
}
export async function pickBackupFile() {
  return api().pickBackupFile();
}
