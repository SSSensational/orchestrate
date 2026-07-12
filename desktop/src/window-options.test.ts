import { describe, expect, it } from 'vitest';

import { windowOptions } from './window-options.js';

describe('desktop renderer isolation', () => {
  it('keeps Node and Electron privileges out of the renderer', () => {
    expect(windowOptions.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
    expect(windowOptions.webPreferences).not.toHaveProperty('preload');
  });
});
