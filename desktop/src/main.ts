import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { windowOptions } from './window-options.js';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const rendererRoot = join(desktopRoot, '../web/index.html');
const smoke = process.argv.includes('--smoke');
let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow(windowOptions);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await mainWindow.loadFile(rendererRoot);

  if (!smoke) return;

  const renderer = await mainWindow.webContents.executeJavaScript(`({
    ready: document.querySelector('#app')?.dataset.ready,
    requireType: typeof require,
    processType: typeof process,
    electronApiType: typeof window.electronAPI
  })`) as {
    ready?: string;
    requireType: string;
    processType: string;
    electronApiType: string;
  };

  const passed = BrowserWindow.getAllWindows().length === 1
    && renderer.ready === 'true'
    && renderer.requireType === 'undefined'
    && renderer.processType === 'undefined'
    && renderer.electronApiType === 'undefined';

  if (!passed) throw new Error(`Desktop smoke failed: ${JSON.stringify(renderer)}`);
  console.log('Desktop smoke passed: one isolated window loaded the web root');
  mainWindow.close();
}

app.whenReady().then(createWindow).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
