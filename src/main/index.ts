import { app, BrowserWindow, Menu, dialog, shell, protocol } from 'electron';
import { join } from 'path';
import { copyFileSync, existsSync } from 'fs';
import { openDatabase, closeDatabase, getDb, getDbPath, dataDir } from '../database/index.js';
import { registerIpc } from './ipc.js';
import { getSetting, setSetting } from '../database/settings.js';
import { resolveImagePath } from './images.js';

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  let bounds: Electron.Rectangle | undefined;
  try {
    const saved = getSetting('window_bounds');
    if (saved) bounds = JSON.parse(saved) as Electron.Rectangle;
  } catch {
    bounds = undefined;
  }

  mainWindow = new BrowserWindow({
    width: bounds?.width ?? 1280,
    height: bounds?.height ?? 800,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 1024,
    minHeight: 640,
    title: 'Orderly',
    backgroundColor: '#F5F0E6',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on('close', () => {
    try {
      const b = mainWindow?.getBounds();
      if (b) setSetting('window_bounds', JSON.stringify(b));
    } catch {
      /* best effort */
    }
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Back Up Database…',
          click: () => backupNow(),
        },
        {
          label: 'Restore Database…',
          click: () => restoreFlow(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Orderly',
          click: () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: 'About Orderly',
              message: `Orderly ${app.getVersion()}`,
              detail: 'Clever Signal — Every order, in order.\nHelping makers build better businesses.',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

import { backupFileName, copyDatabaseFile, validateBackupFile } from '../domain/backup.js';

/** Create a timestamped backup copy of the database. Returns the backup path. */
export function backupNow(targetDir?: string): string {
  const src = getDbPath();
  if (!src || !existsSync(src)) throw new Error('Database file not found.');
  const dir = targetDir ?? join(dataDir(), 'backups');
  // Checkpoint WAL so the backup is a complete, consistent copy.
  try {
    getDb().pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    /* best effort */
  }
  closeDatabase();
  try {
    return copyDatabaseFile(src, dir);
  } finally {
    openDatabase();
  }
}

export async function restoreFlow(pickedPath?: string): Promise<void> {
  let file = pickedPath;
  if (!file) {
    const res = await dialog.showOpenDialog(mainWindow!, {
      title: 'Restore Orderly database',
      filters: [{ name: 'Orderly backups', extensions: ['db'] }],
      properties: ['openFile'],
    });
    if (res.canceled || res.filePaths.length === 0) return;
    file = res.filePaths[0];
  }
  validateBackupFile(file);
  const confirm = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    buttons: ['Restore', 'Cancel'],
    defaultId: 1,
    title: 'Restore database',
    message: 'Replace the current database with this backup?',
    detail: 'Your current data will be replaced. A safety backup of the current database is made first.',
  });
  if (confirm.response !== 0) return;
  // Safety backup of current data before replacing.
  const currentPath = getDbPath();
  backupNow();
  closeDatabase();
  copyFileSync(file, currentPath);
  app.relaunch();
  app.exit(0);
}

app.whenReady().then(() => {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  openDatabase();
  registerIpc();
  // Serve product images from the data dir; nothing else on disk is reachable.
  protocol.registerFileProtocol('orderly-img', (request, respond) => {
    try {
      const rel = decodeURIComponent(request.url.replace(/^orderly-img:\/\//, ''));
      const full = resolveImagePath(rel);
      if (!full) return respond({ error: -6 });
      respond({ path: full });
    } catch {
      respond({ error: -6 });
    }
  });
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  closeDatabase();
});

// Open links in the user's browser, never inside the app.
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url);
    return { action: 'deny' };
  });
});
