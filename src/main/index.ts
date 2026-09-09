import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { createCompositionRoot, type CompositionRoot } from './composition-root';
import { registerIpcHandlers } from './ipc';

let services: CompositionRoot | null = null;

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    title: 'Installed Base Intelligence',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.once('ready-to-show', () => window.show());
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
};

app.whenReady().then(() => {
  const requestedMode = process.env.CIB_INFERENCE_MODE;
  const inferenceMode =
    requestedMode === 'qvac' || requestedMode === 'mock' ? requestedMode : undefined;
  if (requestedMode && !inferenceMode) {
    throw new Error('CIB_INFERENCE_MODE must be either qvac or mock.');
  }
  services = createCompositionRoot({
    databasePath:
      process.env.CIB_DATABASE_PATH ?? join(app.getPath('userData'), 'installed-base.sqlite'),
    development: !app.isPackaged,
    inferenceMode,
  });
  registerIpcHandlers(services);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (services) void services.dispose();
  services = null;
});
