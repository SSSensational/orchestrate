import { spawn } from 'node:child_process';
import type {
  ChildProcessWithoutNullStreams,
  SpawnOptions,
} from 'node:child_process';
import { createInterface } from 'node:readline';

import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentExecuteInput,
  AgentExecution,
  AgentResult,
  McpServerConfig,
} from '@agent-workflow/shared';

export const CODEX_APP_SERVER_SMOKE_PROMPT =
  'Reply with exactly CODEX_APP_SERVER_SMOKE_OK and nothing else.';

type JsonObject = Record<string, unknown>;

export interface NormalizedCodexBatch {
  events: AgentEvent[];
  result?: AgentResult;
}

function object(value: unknown, description: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be an object.`);
  }
  return value as JsonObject;
}

function nonEmptyString(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${description} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function mapToolStatus(
  value: unknown,
): 'running' | 'completed' | 'failed' {
  if (value === 'inProgress' || value === 'running') return 'running';
  if (value === 'completed') return 'completed';
  return 'failed';
}

function toolName(item: JsonObject): string | undefined {
  switch (item.type) {
    case 'commandExecution':
    case 'fileChange':
      return item.type;
    case 'mcpToolCall':
      return `${nonEmptyString(item.server, 'MCP server')}/${nonEmptyString(item.tool, 'MCP tool')}`;
    case 'dynamicToolCall': {
      const tool = nonEmptyString(item.tool, 'dynamic tool');
      return typeof item.namespace === 'string' && item.namespace.length > 0
        ? `${item.namespace}/${tool}`
        : tool;
    }
    case 'collabAgentToolCall':
      return typeof item.tool === 'string' ? item.tool : 'collabAgentToolCall';
    default:
      return undefined;
  }
}

function toolEvent(item: JsonObject): AgentEvent | undefined {
  const tool = toolName(item);
  if (!tool) return undefined;
  return {
    type: 'tool_call',
    callId: nonEmptyString(item.id, 'tool item id'),
    tool,
    status: mapToolStatus(item.status),
  };
}

function responseFailure(error: unknown): string {
  const payload = object(error, 'JSON-RPC error');
  return (
    optionalString(payload.message) ??
    `JSON-RPC request failed with code ${String(payload.code ?? 'unknown')}.`
  );
}

export class CodexAppServerNormalizer {
  private finalText = '';
  private hasFinalText = false;
  private sessionId: string | undefined;
  private terminalResult: AgentResult | undefined;

  accept(payload: unknown): NormalizedCodexBatch {
    if (this.terminalResult) return { events: [], result: this.terminalResult };

    const message = object(payload, 'app-server message');
    if ('error' in message && !('method' in message)) {
      return this.terminal('failed', responseFailure(message.error));
    }

    if (!('method' in message)) {
      if (!('id' in message)) {
        throw new Error('app-server message has neither method nor id.');
      }
      const sessionEvent = this.sessionFromThreadResponse(message.result);
      return { events: sessionEvent ? [sessionEvent] : [] };
    }

    const method = nonEmptyString(message.method, 'JSON-RPC method');
    if ('id' in message) {
      return this.terminal(
        'failed',
        `Unsupported server request: ${method}.`,
      );
    }

    const params = object(message.params, `${method} params`);
    switch (method) {
      case 'thread/started': {
        const event = this.captureSession(object(params.thread, 'thread'));
        return { events: event ? [event] : [] };
      }
      case 'item/agentMessage/delta':
        return {
          events: [
            {
              type: 'text_delta',
              text: nonEmptyString(params.delta, 'agent message delta'),
            },
          ],
        };
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta':
        return {
          events: [
            {
              type: 'thinking_delta',
              text: nonEmptyString(params.delta, 'reasoning delta'),
            },
          ],
        };
      case 'item/started':
      case 'item/completed':
        return this.normalizeItem(message, params, method);
      case 'thread/tokenUsage/updated':
        return { events: [this.normalizeUsage(params)] };
      case 'turn/completed':
        return this.normalizeCompletedTurn(params);
      case 'error': {
        if (params.willRetry === true) {
          return { events: [{ type: 'raw', payload }] };
        }
        const error = object(params.error, 'turn error');
        return this.terminal(
          'failed',
          optionalString(error.message) ?? 'agent_error',
        );
      }
      default:
        return { events: [{ type: 'raw', payload }] };
    }
  }

  fail(reason: string, status: 'failed' | 'cancelled' | 'timeout' = 'failed') {
    if (this.terminalResult) return this.terminalResult;
    return this.setResult(status, nonEmptyString(reason, 'failure reason'));
  }

  finish(): AgentResult {
    return (
      this.terminalResult ??
      this.setResult(
        'failed',
        'Protocol ended before a terminal turn/completed notification.',
      )
    );
  }

  private sessionFromThreadResponse(result: unknown): AgentEvent | undefined {
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      return undefined;
    }
    const thread = (result as JsonObject).thread;
    if (typeof thread !== 'object' || thread === null || Array.isArray(thread)) {
      return undefined;
    }
    return this.captureSession(thread as JsonObject);
  }

  private captureSession(thread: JsonObject): AgentEvent | undefined {
    const sessionId = nonEmptyString(thread.sessionId, 'thread.sessionId');
    if (this.sessionId === sessionId) return undefined;
    if (this.sessionId && this.sessionId !== sessionId) {
      throw new Error('app-server changed thread.sessionId during execution.');
    }
    this.sessionId = sessionId;
    return { type: 'session', sessionId };
  }

  private normalizeItem(
    payload: JsonObject,
    params: JsonObject,
    method: 'item/started' | 'item/completed',
  ): NormalizedCodexBatch {
    const item = object(params.item, `${method} item`);
    if (method === 'item/completed' && item.type === 'agentMessage') {
      this.finalText =
        typeof item.text === 'string'
          ? item.text
          : nonEmptyString(item.text, 'completed agent message text');
      this.hasFinalText = true;
      return { events: [] };
    }

    const event = toolEvent(item);
    return event
      ? { events: [event] }
      : { events: [{ type: 'raw', payload }] };
  }

  private normalizeUsage(params: JsonObject): AgentEvent {
    const tokenUsage = object(params.tokenUsage, 'token usage');
    const last = object(tokenUsage.last, 'last token usage');
    if (
      typeof last.inputTokens !== 'number' ||
      typeof last.outputTokens !== 'number'
    ) {
      throw new Error('Token usage must contain numeric inputTokens/outputTokens.');
    }
    return {
      type: 'usage',
      inputTokens: last.inputTokens,
      outputTokens: last.outputTokens,
    };
  }

  private normalizeCompletedTurn(params: JsonObject): NormalizedCodexBatch {
    const turn = object(params.turn, 'completed turn');
    switch (turn.status) {
      case 'completed':
        return this.terminal('completed');
      case 'interrupted':
        return this.terminal('cancelled', 'turn_interrupted');
      case 'failed': {
        const error =
          typeof turn.error === 'object' && turn.error !== null
            ? (turn.error as JsonObject)
            : undefined;
        return this.terminal(
          'failed',
          optionalString(error?.message) ?? 'agent_error',
        );
      }
      default:
        return this.terminal(
          'failed',
          `Protocol error: turn/completed carried status ${String(turn.status)}.`,
        );
    }
  }

  private terminal(
    status: AgentResult['status'],
    failureReason?: string,
  ): NormalizedCodexBatch {
    return {
      events: [],
      result: this.setResult(status, failureReason),
    };
  }

  private setResult(
    status: AgentResult['status'],
    failureReason?: string,
  ): AgentResult {
    const result: AgentResult = { status };
    if (this.sessionId) result.sessionId = this.sessionId;
    if (this.hasFinalText) result.finalText = this.finalText;
    if (failureReason) result.failureReason = failureReason;
    this.terminalResult = result;
    return result;
  }
}

export function normalizeCodexAppServerMessages(
  messages: readonly unknown[],
): { events: AgentEvent[]; result: AgentResult } {
  const normalizer = new CodexAppServerNormalizer();
  const events: AgentEvent[] = [];

  try {
    for (const message of messages) {
      const batch = normalizer.accept(message);
      events.push(...batch.events);
      if (batch.result) return { events, result: batch.result };
    }
  } catch (error) {
    return {
      events,
      result: normalizer.fail(
        `Protocol error: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }

  return { events, result: normalizer.finish() };
}

class EventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<
    (value: IteratorResult<T, undefined>) => void
  > = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value !== undefined) {
          return Promise.resolve({ done: false, value });
        }
        if (this.closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export type CodexProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

export interface CodexAppServerAdapterOptions {
  command?: string;
  spawn?: CodexProcessSpawner;
  stopGraceMs?: number;
}

interface ActiveExecution {
  child: ChildProcessWithoutNullStreams;
  finish(result: AgentResult): void;
}

const codexCapabilities: AgentCapabilities = {
  resume: true,
  fork: true,
  structuredOutput: true,
  mcp: true,
  sandbox: true,
  interactivePermission: true,
};

function mcpConfig(configs: readonly McpServerConfig[]): JsonObject {
  return {
    mcp_servers: Object.fromEntries(
      configs.map(({ name, command, args, env }) => [
        name,
        {
          command,
          ...(args ? { args } : {}),
          ...(env ? { env } : {}),
        },
      ]),
    ),
  };
}

export class CodexAppServerAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Codex';
  private readonly active = new Map<string, ActiveExecution>();
  private readonly command: string;
  private readonly spawnProcess: CodexProcessSpawner;
  private readonly stopGraceMs: number;

  constructor(options: CodexAppServerAdapterOptions = {}) {
    this.command = options.command ?? 'codex';
    this.spawnProcess =
      options.spawn ??
      ((command, args, spawnOptions) =>
        spawn(command, [...args], spawnOptions) as ChildProcessWithoutNullStreams);
    this.stopGraceMs = options.stopGraceMs ?? 1_000;
  }

  async capabilities(): Promise<AgentCapabilities> {
    return codexCapabilities;
  }

  probe(): Promise<{ available: boolean; version?: string }> {
    return new Promise((resolve) => {
      let output = '';
      let settled = false;
      const child = this.spawnProcess(this.command, ['--version'], {
        stdio: 'pipe',
      });
      const done = (result: { available: boolean; version?: string }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.stdout.on('data', (chunk: Buffer | string) => {
        output += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer | string) => {
        output += chunk.toString();
      });
      child.once('error', () => done({ available: false }));
      child.once('close', (code) => {
        const version = output
          .split('\n')
          .map((line) => line.trim())
          .find((line) => /codex/i.test(line) && /\d/.test(line));
        done(
          code === 0 && version
            ? { available: true, version }
            : { available: false },
        );
      });
    });
  }

  execute(input: AgentExecuteInput): AgentExecution {
    if (input.sessionId) {
      return this.failedExecution(
        'resume_rejected: Phase 1 starts a new thread and cannot resume from thread.sessionId.',
      );
    }
    if (this.active.has(input.taskId)) {
      return this.failedExecution(`Task is already running: ${input.taskId}.`);
    }

    const events = new EventQueue<AgentEvent>();
    let resolveResult!: (result: AgentResult) => void;
    const result = new Promise<AgentResult>((resolve) => {
      resolveResult = resolve;
    });
    const normalizer = new CodexAppServerNormalizer();
    const pending = new Map<
      string,
      { resolve(value: unknown): void; reject(error: Error): void }
    >();
    let settled = false;
    let stderr = '';
    let timeout: NodeJS.Timeout | undefined;
    let child: ChildProcessWithoutNullStreams;

    const finish = (agentResult: AgentResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      this.active.delete(input.taskId);
      for (const request of pending.values()) {
        request.reject(new Error(agentResult.failureReason ?? agentResult.status));
      }
      pending.clear();
      events.close();
      resolveResult(agentResult);
      void this.terminate(child);
    };

    try {
      child = this.spawnProcess(
        this.command,
        ['app-server', '--listen', 'stdio://'],
        {
          detached: process.platform !== 'win32',
          stdio: 'pipe',
        },
      );
    } catch (error) {
      return this.failedExecution(
        `Process error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    this.active.set(input.taskId, { child, finish });
    const fail = (
      reason: string,
      status: 'failed' | 'cancelled' | 'timeout' = 'failed',
    ) => finish(normalizer.fail(reason, status));

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4_096);
    });
    child.once('error', (error) => fail(`Process error: ${error.message}`));
    child.once('close', (code, signal) => {
      if (!settled) {
        const detail = stderr.trim();
        fail(
          `Process exited before turn/completed (code=${String(code)}, signal=${String(signal)})${detail ? `: ${detail}` : ''}`,
        );
      }
    });

    const send = (message: JsonObject) => {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    const rpc = (id: number, method: string, params: JsonObject) =>
      new Promise<unknown>((resolve, reject) => {
        pending.set(String(id), { resolve, reject });
        send({ id, method, params });
      });

    createInterface({ input: child.stdout }).on('line', (line) => {
      if (settled) return;
      let payload: unknown;
      try {
        payload = JSON.parse(line);
        const message = object(payload, 'app-server message');

        if ('method' in message && 'id' in message) {
          const method = nonEmptyString(message.method, 'server request method');
          const reason = `Unsupported server request: ${method}.`;
          send({
            id: message.id,
            error: { code: -32_601, message: reason },
          });
          fail(reason);
          return;
        }

        const batch = normalizer.accept(payload);
        for (const event of batch.events) events.push(event);
        if (batch.result) {
          finish(batch.result);
          return;
        }

        if (!('method' in message) && 'id' in message) {
          const request = pending.get(String(message.id));
          if (!request) throw new Error(`Unexpected response id: ${String(message.id)}.`);
          pending.delete(String(message.id));
          if ('error' in message) request.reject(new Error(responseFailure(message.error)));
          else request.resolve(message.result);
        }
      } catch (error) {
        fail(
          `Protocol error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    const run = async () => {
      await rpc(1, 'initialize', {
        clientInfo: {
          name: 'agent_workflow_runtime',
          title: 'Agent Workflow Runtime',
          version: '0.0.0',
        },
      });
      send({ method: 'initialized', params: {} });

      const threadResult = object(
        await rpc(2, 'thread/start', {
          cwd: nonEmptyString(input.workspace.path, 'workspace.path'),
          approvalPolicy: 'never',
          sandbox: 'read-only',
          ...(input.mcpConfig.length > 0
            ? { config: mcpConfig(input.mcpConfig) }
            : {}),
        }),
        'thread/start result',
      );
      const thread = object(threadResult.thread, 'thread/start result.thread');
      nonEmptyString(thread.sessionId, 'thread.sessionId');
      const threadId = nonEmptyString(thread.id, 'thread.id');

      await rpc(3, 'turn/start', {
        threadId,
        input: [{ type: 'text', text: input.prompt, text_elements: [] }],
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      });
    };

    void run().catch((error: unknown) => {
      fail(
        `Protocol error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    if ((input.timeoutSeconds ?? 0) > 0) {
      timeout = setTimeout(
        () => fail('timeout', 'timeout'),
        input.timeoutSeconds! * 1_000,
      );
      timeout.unref();
    }

    return { events, result };
  }

  async stop(taskId: string): Promise<void> {
    const execution = this.active.get(taskId);
    if (!execution) return;
    execution.finish({
      status: 'cancelled',
      failureReason: 'cancelled_by_runtime',
    });
    await this.terminate(execution.child);
  }

  private failedExecution(failureReason: string): AgentExecution {
    const events = new EventQueue<AgentEvent>();
    events.close();
    return {
      events,
      result: Promise.resolve({ status: 'failed', failureReason }),
    };
  }

  private terminate(child: ChildProcessWithoutNullStreams): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, this.stopGraceMs);
      timeout.unref();
      child.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}

export const codexAppServerAdapter = new CodexAppServerAdapter();
