import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { serve } from '@hono/node-server';
import type { WorkflowIrL2Input } from '@agent-workflow/shared';
import { Hono } from 'hono';

import { singleAgentCrossAgentReviewIr } from './bundled-workflow.js';
import {
  codexAdapterRegistry,
  RunOrchestrator,
  type AgentAdapterRegistry,
} from './run-orchestrator.js';
import { RunStore } from './run-store.js';

export const LOOPBACK_HOST = '127.0.0.1' as const;
export const RUNS_PATH = '/api/runs' as const;

export interface RunEventSocket {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  on(event: 'close' | 'error', listener: () => void): this;
  send(data: string): void;
  terminate(): void;
}

interface WebSocketServerInstance {
  readonly clients: Set<RunEventSocket>;
  close(callback: (error?: Error) => void): void;
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (socket: RunEventSocket) => void,
  ): void;
}

const WebSocketServer = (
  createRequire(import.meta.url)('ws') as {
    WebSocketServer: new (options: {
      noServer: true;
    }) => WebSocketServerInstance;
  }
).WebSocketServer;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readInputs(
  body: unknown,
  defaults: Readonly<Record<string, string>>,
): Record<string, string> {
  if (!isRecord(body)) throw new TypeError('Request body must be an object.');
  const value = body.inputs === undefined ? body : body.inputs;
  if (!isRecord(value)) throw new TypeError('inputs must be an object.');

  const inputs = { ...defaults };
  for (const [name, input] of Object.entries(value)) {
    if (typeof input !== 'string') {
      throw new TypeError(`inputs.${name} must be a string.`);
    }
    inputs[name] = input;
  }
  return inputs;
}

export interface RunApiOptions {
  store: RunStore;
  orchestrator: RunOrchestrator;
  workflow?: WorkflowIrL2Input;
  defaultInputs?: Readonly<Record<string, string>>;
  onRunError?: (error: unknown) => void;
}

export function createRunApi(options: RunApiOptions): Hono {
  const app = new Hono();
  const workflow = options.workflow ?? singleAgentCrossAgentReviewIr;
  const defaultInputs = {
    target: process.cwd(),
    ...options.defaultInputs,
  };

  app.post(RUNS_PATH, async (context) => {
    let body: unknown = {};
    if (context.req.header('content-type') !== undefined) {
      try {
        body = await context.req.json<unknown>();
      } catch {
        return context.json({ error: 'invalid_json' }, 400);
      }
    }

    let inputs: Record<string, string>;
    try {
      inputs = readInputs(body, defaultInputs);
    } catch (error) {
      return context.json(
        {
          error: 'invalid_inputs',
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }

    try {
      const started = options.orchestrator.start(workflow, inputs);
      void started.completion.catch(
        options.onRunError ?? ((error) => console.error(error)),
      );
      return context.json(options.store.getRun(started.runId)!, 202);
    } catch (error) {
      return context.json(
        {
          error: 'run_start_failed',
          message: error instanceof Error ? error.message : String(error),
        },
        400,
      );
    }
  });

  app.get(`${RUNS_PATH}/:runId`, (context) => {
    const run = options.store.getRun(context.req.param('runId'));
    return run === undefined
      ? context.json({ error: 'run_not_found' }, 404)
      : context.json(run);
  });

  app.get(`${RUNS_PATH}/:runId/artifacts`, (context) => {
    const runId = context.req.param('runId');
    if (options.store.getRun(runId) === undefined) {
      return context.json({ error: 'run_not_found' }, 404);
    }
    return context.json(options.store.getArtifactsByRunId(runId));
  });

  return app;
}

function parseSubscription(
  request: IncomingMessage,
  store: RunStore,
): { runId: string; afterSeq: number } | { status: 400 | 404; message: string } {
  const url = new URL(request.url ?? '', `http://${LOOPBACK_HOST}`);
  const match = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (match === null) return { status: 404, message: 'Not found' };

  let runId: string;
  try {
    runId = decodeURIComponent(match[1]!);
  } catch {
    return { status: 400, message: 'Invalid run id' };
  }
  if (store.getRun(runId) === undefined) {
    return { status: 404, message: 'Run not found' };
  }

  const rawAfterSeq = url.searchParams.get('after_seq') ?? '0';
  if (!/^\d+$/.test(rawAfterSeq)) {
    return { status: 400, message: 'after_seq must be a non-negative integer' };
  }
  const afterSeq = Number(rawAfterSeq);
  if (!Number.isSafeInteger(afterSeq)) {
    return { status: 400, message: 'after_seq is too large' };
  }
  return { runId, afterSeq };
}

function rejectUpgrade(socket: Duplex, status: 400 | 404, message: string): void {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${status === 404 ? 'Not Found' : 'Bad Request'}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

export function streamPersistedEvents(
  socket: RunEventSocket,
  store: RunStore,
  runId: string,
  afterSeq: number,
  pollIntervalMs: number,
): void {
  let cursor = afterSeq;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;

  const stop = () => {
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
  };
  const pump = () => {
    if (stopped || socket.readyState !== 1) return;
    for (const event of store.getEvents(runId, cursor)) {
      socket.send(JSON.stringify(event));
      cursor = event.seq;
    }
  };

  socket.on('close', stop);
  socket.on('error', stop);
  pump();
  if (!stopped) timer = setInterval(pump, pollIntervalMs);
}

export interface RunServerOptions {
  port?: number;
  databasePath?: string | Buffer;
  store?: RunStore;
  orchestrator?: RunOrchestrator;
  adapters?: AgentAdapterRegistry;
  workflow?: WorkflowIrL2Input;
  defaultInputs?: Readonly<Record<string, string>>;
  eventPollIntervalMs?: number;
  onRunError?: (error: unknown) => void;
}

export interface RunServer {
  readonly app: Hono;
  readonly host: typeof LOOPBACK_HOST;
  readonly port: number;
  readonly origin: string;
  readonly server: Server;
  readonly store: RunStore;
  close(): Promise<void>;
}

export async function startRunServer(
  options: RunServerOptions = {},
): Promise<RunServer> {
  const pollIntervalMs = options.eventPollIntervalMs ?? 25;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError('eventPollIntervalMs must be a positive integer.');
  }

  const store = options.store ?? new RunStore(options.databasePath);
  const orchestrator =
    options.orchestrator ??
    new RunOrchestrator(store, options.adapters ?? codexAdapterRegistry);
  const app = createRunApi({
    store,
    orchestrator,
    ...(options.workflow === undefined ? {} : { workflow: options.workflow }),
    ...(options.defaultInputs === undefined
      ? {}
      : { defaultInputs: options.defaultInputs }),
    ...(options.onRunError === undefined
      ? {}
      : { onRunError: options.onRunError }),
  });
  const webSockets = new WebSocketServer({ noServer: true });

  let resolveListening: ((port: number) => void) | undefined;
  let rejectListening: ((error: Error) => void) | undefined;
  const listening = new Promise<number>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  const server = serve(
    {
      fetch: app.fetch,
      hostname: LOOPBACK_HOST,
      port: options.port ?? 0,
    },
    ({ port }) => resolveListening!(port),
  ) as Server;
  server.once('error', (error) => rejectListening!(error));

  const upgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => {
    const subscription = parseSubscription(request, store);
    if ('status' in subscription) {
      rejectUpgrade(socket, subscription.status, subscription.message);
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      streamPersistedEvents(
        webSocket,
        store,
        subscription.runId,
        subscription.afterSeq,
        pollIntervalMs,
      );
    });
  };
  server.on('upgrade', upgrade);

  let closed = false;
  const port = await listening;
  return {
    app,
    host: LOOPBACK_HOST,
    port,
    origin: `http://${LOOPBACK_HOST}:${port}`,
    server,
    store,
    async close() {
      if (closed) return;
      closed = true;
      server.off('upgrade', upgrade);
      for (const client of webSockets.clients) client.terminate();

      const results = await Promise.allSettled([
        new Promise<void>((resolve, reject) => {
          webSockets.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        }),
        new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        }),
      ]);
      store.close();
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed !== undefined) throw failed.reason;
    },
  };
}
