import type { BrowserWindowConstructorOptions } from 'electron';

export const windowOptions = {
  width: 1280,
  height: 800,
  backgroundColor: '#09111c',
  show: !process.argv.includes('--smoke'),
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
} satisfies BrowserWindowConstructorOptions;
