import type {
  AgentAdapter,
  AgentCapabilities,
  AgentExecuteInput,
  AgentExecution,
} from '@agent-workflow/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { singleAgentCrossAgentReviewIr } from './src/bundled-workflow.js';
import {
  createRunApi,
  RUNS_PATH,
  streamPersistedEvents,
  type RunEventSocket,
} from './src/run-api.js';
import { RunOrchestrator } from './src/run-orchestrator.js';
import { announceReadiness } from './src/runtime-server.js';
import { RunStore } from './src/run-store.js';

const capabilities: AgentCapabilities = {
  resume: true,
  fork: true,
  structuredOutput: true,
  mcp: true,
  sandbox: true,
  interactivePermission: true,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class BlockingAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Blocking test adapter';
  readonly gate = deferred();

  capabilities(): Promise<AgentCapabilities> {
    return Promise.resolve(capabilities);
  }

  probe(): Promise<{ available: boolean; version?: string }> {
    return Promise.resolve({ available: true, version: 'test' });
  }

  execute(input: AgentExecuteInput): AgentExecution {
    const gate = this.gate.promise;
    return {
      events: (async function* () {
        yield { type: 'session' as const, sessionId: 'session-test' };
        yield { type: 'text_delta' as const, text: `review:${input.workspace.path}` };
        await gate;
      })(),
      result: gate.then(() => ({
        status: 'completed' as const,
        sessionId: 'session-test',
        finalText: 'final report',
      })),
    };
  }

  stop(): Promise<void> {
    this.gate.resolve();
    return Promise.resolve();
  }
}

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

class FakeSocket implements RunEventSocket {
  readyState = 1;
  readonly messages: unknown[] = [];
  private readonly listeners: (() => void)[] = [];

  close(): void {
    this.terminate();
  }

  on(_event: 'close' | 'error', listener: () => void): this {
    this.listeners.push(listener);
    return this;
  }

  send(data: string): void {
    this.messages.push(JSON.parse(data));
  }

  terminate(): void {
    this.readyState = 3;
    for (const listener of this.listeners) listener();
  }
}

function createPersistedRun(store: RunStore): string {
  const definitionId = store.createWorkflowDefinition({
    name: 'Event stream test',
    ir: singleAgentCrossAgentReviewIr,
  });
  return store.createRun({
    definitionId,
    irSnapshot: singleAgentCrossAgentReviewIr,
  });
}

describe('run API', () => {
  const stores: RunStore[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const store of stores.splice(0)) store.close();
  });

  it('starts the bundled workflow before completion and exposes snapshot/artifacts', async () => {
    const adapter = new BlockingAdapter();
    const store = new RunStore();
    stores.push(store);
    const app = createRunApi({
      store,
      orchestrator: new RunOrchestrator(store, { codex: adapter }),
      onRunError: (error) => {
        throw error;
      },
    });

    const response = await app.request(RUNS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ inputs: { target: '/workspace' } }),
    });
    expect(response.status).toBe(202);
    const started = (await response.json()) as { id: string; status: string };
    expect(started.status).toBe('running');

    const snapshot = (await (
      await app.request(`${RUNS_PATH}/${started.id}`)
    ).json()) as { ir_snapshot_json: string; status: string };
    expect(JSON.parse(snapshot.ir_snapshot_json)).toEqual(
      singleAgentCrossAgentReviewIr,
    );
    expect(snapshot.status).toBe('running');

    adapter.gate.resolve();
    await waitFor(async () => {
      const run = (await (
        await app.request(`${RUNS_PATH}/${started.id}`)
      ).json()) as { status: string };
      return run.status === 'completed';
    });
    const artifacts = (await (
      await app.request(`${RUNS_PATH}/${started.id}/artifacts`)
    ).json()) as { run_id: string; data_json: string }[];
    expect(artifacts).toMatchObject([
      { run_id: started.id, data_json: '{"text":"final report"}' },
    ]);
  });

  it('replays SQLite rows after seq and then continues live without duplicates', async () => {
    vi.useFakeTimers();
    const store = new RunStore();
    stores.push(store);
    const runId = createPersistedRun(store);
    store.appendEvent(runId, { type: 'one', data: { value: 1 } });
    store.appendEvent(runId, { type: 'two', data: { value: 2 } });

    const first = new FakeSocket();
    streamPersistedEvents(first, store, runId, 0, 5);
    expect(first.messages).toEqual(store.getEvents(runId));
    first.terminate();

    store.appendEvent(runId, { type: 'three', data: { value: 3 } });
    store.appendEvent(runId, { type: 'four', data: { value: 4 } });
    const reconnected = new FakeSocket();
    streamPersistedEvents(reconnected, store, runId, 2, 5);
    expect(reconnected.messages).toEqual(store.getEvents(runId, 2));
    store.appendEvent(runId, { type: 'five', data: { value: 5 } });
    await vi.advanceTimersByTimeAsync(5);
    expect(reconnected.messages).toEqual(store.getEvents(runId, 2));
    expect(
      reconnected.messages.map((event) => (event as { seq: number }).seq),
    ).toEqual([3, 4, 5]);
    reconnected.terminate();
  });

  it('announces structured loopback readiness', () => {
    if (typeof process.send === 'function') {
      const send = vi.spyOn(process, 'send').mockImplementation(() => true);
      announceReadiness({ type: 'ready', host: '127.0.0.1', port: 43210 });
      expect(send).toHaveBeenCalledWith({
        type: 'ready',
        host: '127.0.0.1',
        port: 43210,
      });
      send.mockRestore();
      return;
    }
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    announceReadiness({ type: 'ready', host: '127.0.0.1', port: 43210 });
    expect(write).toHaveBeenCalledWith(
      '{"type":"ready","host":"127.0.0.1","port":43210}\n',
    );
    write.mockRestore();
  });
});
