import type { BrowserWindowConstructorOptions } from 'electron';

export const windowOptions = {
  width: 960,
  height: 640,
  show: !process.argv.includes('--smoke'),
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
} satisfies BrowserWindowConstructorOptions;
