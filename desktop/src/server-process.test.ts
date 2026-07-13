import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { startServerChild, stopServerChild } from './server-process.js';

function portAcceptsConnections(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('Electron runtime server lifecycle', () => {
  it('waits for readiness and releases the child port within grace', async () => {
    const running = await startServerChild({
      entry: fileURLToPath(
        new URL('../fixtures/ready-server.mjs', import.meta.url),
      ),
      mode: 'fixture',
      readinessTimeoutMs: 2_000,
    });

    expect(await portAcceptsConnections(running.readiness.port)).toBe(true);
    await stopServerChild(running.child, 2_000);
    expect(await portAcceptsConnections(running.readiness.port)).toBe(false);
  });
});
