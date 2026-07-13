import {
  fork,
  type ChildProcess,
  type ForkOptions,
} from 'node:child_process';

export interface ServerReadiness {
  type: 'ready';
  host: '127.0.0.1';
  port: number;
}

export interface RunningServerChild {
  child: ChildProcess;
  readiness: ServerReadiness;
}

export interface StartServerChildOptions {
  entry: string;
  mode: 'real' | 'fixture' | 'custom';
  env?: NodeJS.ProcessEnv;
  readinessTimeoutMs?: number;
  forkProcess?: typeof fork;
}

function readinessMessage(value: unknown): ServerReadiness | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const message = value as Record<string, unknown>;
  return message.type === 'ready' &&
    message.host === '127.0.0.1' &&
    typeof message.port === 'number' &&
    Number.isSafeInteger(message.port) &&
    message.port > 0 &&
    message.port <= 65_535
    ? (message as unknown as ServerReadiness)
    : undefined;
}

export async function startServerChild(
  options: StartServerChildOptions,
): Promise<RunningServerChild> {
  const forkProcess = options.forkProcess ?? fork;
  const forkOptions: ForkOptions = {
    env: {
      ...process.env,
      ...options.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  };
  const child = forkProcess(options.entry, [], forkOptions);
  const prefix = `[app-server:${options.mode} pid=${child.pid ?? 'pending'}]`;
  child.stdout?.on('data', (chunk: Buffer | string) => {
    process.stdout.write(`${prefix} ${String(chunk)}`);
  });
  child.stderr?.on('data', (chunk: Buffer | string) => {
    process.stderr.write(`${prefix} ${String(chunk)}`);
  });
  process.stdout.write(`${prefix} spawned entry=${options.entry}\n`);

  try {
    const readiness = await new Promise<ServerReadiness>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Runtime server readiness timed out.')),
        options.readinessTimeoutMs ?? 15_000,
      );
      const cleanup = () => {
        clearTimeout(timeout);
        child.off('message', onMessage);
        child.off('error', onError);
        child.off('exit', onExit);
      };
      const onMessage = (message: unknown) => {
        const ready = readinessMessage(message);
        if (ready === undefined) return;
        cleanup();
        resolve(ready);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(
            `Runtime server exited before readiness (code=${String(code)}, signal=${String(signal)}).`,
          ),
        );
      };
      child.on('message', onMessage);
      child.once('error', onError);
      child.once('exit', onExit);
    });
    process.stdout.write(
      `${prefix} ready origin=http://${readiness.host}:${readiness.port}\n`,
    );
    return { child, readiness };
  } catch (error) {
    child.kill('SIGTERM');
    throw error;
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off('exit', exited);
      resolve(false);
    }, timeoutMs);
    const exited = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once('exit', exited);
  });
}

export async function stopServerChild(
  child: ChildProcess,
  gracePeriodMs = 3_000,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = waitForExit(child, gracePeriodMs);
  child.kill('SIGTERM');
  if (await exited) return;

  child.kill('SIGKILL');
  if (!(await waitForExit(child, 1_000))) {
    throw new Error('Runtime server did not exit after SIGKILL.');
  }
}
