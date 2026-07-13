import { pathToFileURL } from 'node:url';

import { startRunServer, type RunServerOptions } from './run-api.js';

export interface RunServerReadiness {
  type: 'ready';
  host: '127.0.0.1';
  port: number;
}

export function announceReadiness(readiness: RunServerReadiness): void {
  if (typeof process.send === 'function') {
    process.send(readiness);
  } else {
    process.stdout.write(`${JSON.stringify(readiness)}\n`);
  }
}

export async function runServerProcess(
  options: RunServerOptions = {},
): Promise<void> {
  const databasePath = process.env.AGENT_WORKFLOW_DB_PATH;
  const runtime = await startRunServer({
    ...options,
    ...(databasePath === undefined || options.databasePath !== undefined
      ? {}
      : { databasePath }),
  });
  announceReadiness({
    type: 'ready',
    host: runtime.host,
    port: runtime.port,
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void runtime.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      },
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (typeof process.send === 'function') process.once('disconnect', shutdown);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  void runServerProcess().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
