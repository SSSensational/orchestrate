import type {
  AgentAdapter,
  AgentEvent,
  AgentResult,
  WorkflowIrL2Input,
} from '@agent-workflow/shared';

import { codexAppServerAdapter } from './codex-app-server-adapter.js';
import { RunStore } from './run-store.js';

export type AgentAdapterRegistry = Readonly<Record<string, AgentAdapter>>;

export interface RunOrchestratorOptions {
  textFlushIntervalMs?: number;
}

export interface RunExecutionOutcome {
  runId: string;
  nodeRunId: string;
  taskId: string;
  status: 'completed' | 'failed';
  artifactId?: string;
  failureReason?: string;
}

export const codexAdapterRegistry: AgentAdapterRegistry = {
  codex: codexAppServerAdapter,
};

const inputReferencePattern = /{{inputs\.([^{}.]+)}}/g;

function renderInputs(
  template: string,
  inputs: Readonly<Record<string, string>>,
): string {
  return template.replace(inputReferencePattern, (reference, name: string) => {
    const value = inputs[name];
    if (value === undefined) {
      throw new Error(`Missing workflow input for template ${reference}.`);
    }
    return value;
  });
}

function failureResult(reason: unknown): AgentResult {
  return {
    status: 'failed',
    failureReason: `Adapter execution error: ${
      reason instanceof Error ? reason.message : String(reason)
    }`,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class RunOrchestrator {
  private readonly textFlushIntervalMs: number;

  constructor(
    private readonly store: RunStore,
    private readonly adapters: AgentAdapterRegistry,
    options: RunOrchestratorOptions = {},
  ) {
    this.textFlushIntervalMs = options.textFlushIntervalMs ?? 500;
    if (this.textFlushIntervalMs <= 0) {
      throw new TypeError('textFlushIntervalMs must be greater than zero.');
    }
  }

  async run(
    ir: WorkflowIrL2Input,
    inputs: Readonly<Record<string, string>> = {},
  ): Promise<RunExecutionOutcome> {
    if (ir.nodes.length !== 1 || ir.edges.length !== 0) {
      throw new Error('Phase 1 orchestrator requires one root node and no edges.');
    }
    const node = ir.nodes[0]!;
    const adapter = this.adapters[node.agent];
    if (!adapter) throw new Error(`Agent adapter is not registered: ${node.agent}.`);
    const workspacePath = renderInputs(ir.workspace.path, inputs);
    const prompt = renderInputs(node.prompt, inputs);

    const definitionId = this.store.createWorkflowDefinition({
      name: ir.name,
      ir,
    });
    const { runId, nodeRunId } = this.store.createRunWithPendingNode({
      definitionId,
      irSnapshot: ir,
      inputs,
      nodeId: node.id,
      nodeType: node.type,
      nodeInputs: inputs,
    });
    this.store.setRunStatus(runId, 'running', {
      type: 'run_started',
      data: { runId },
    });
    this.store.setNodeRunStatus(nodeRunId, 'ready', {
      type: 'node_ready',
      data: { nodeRunId },
    });

    const { taskId } = this.store.startAgentTask({
      nodeRunId,
      agentId: node.agent,
      workDir: workspacePath,
    });

    let result: AgentResult;
    try {
      const execution = adapter.execute({
        taskId,
        prompt,
        workspace: { path: workspacePath, mode: ir.workspace.mode },
        permissions: {
          ...ir.policies.default_permissions,
          mcp_servers: [...ir.policies.default_permissions.mcp_servers],
        },
        mcpConfig: [],
        timeoutSeconds: ir.policies.timeout_seconds,
      });
      [result] = await Promise.all([
        execution.result,
        this.persistAgentEvents(taskId, execution.events),
      ]);
    } catch (error) {
      await adapter.stop(taskId).catch(() => undefined);
      result = failureResult(error);
    }

    if (result.status !== 'completed') {
      const failedResult = {
        ...result,
        failureReason:
          result.failureReason?.trim() ||
          `Agent task ended with status ${result.status}.`,
      };
      this.store.failAgentTaskNodeAndRun(taskId, failedResult);
      return {
        runId,
        nodeRunId,
        taskId,
        status: 'failed',
        failureReason: failedResult.failureReason,
      };
    }

    const completed = this.store.completeAgentTaskAndNode(taskId, result);
    this.store.setRunStatus(runId, 'completed', {
      type: 'run_completed',
      data: {
        runId,
        ...(completed.artifactId === undefined
          ? {}
          : { artifactId: completed.artifactId }),
      },
    });
    return {
      runId,
      nodeRunId,
      taskId,
      status: 'completed',
      ...(completed.artifactId === undefined
        ? {}
        : { artifactId: completed.artifactId }),
    };
  }

  private async persistAgentEvents(
    taskId: string,
    events: AsyncIterable<AgentEvent>,
  ): Promise<void> {
    const iterator = events[Symbol.asyncIterator]();
    let nextEvent = iterator.next();
    let flushWait: Promise<'flush'> | undefined;
    let text = '';

    const flush = () => {
      if (text.length === 0) return;
      this.store.recordAgentTextDelta(taskId, text);
      text = '';
    };

    while (true) {
      const eventWait = nextEvent.then((value) => ({
        kind: 'event' as const,
        value,
      }));
      const outcome = flushWait
        ? await Promise.race([
            eventWait,
            flushWait.then(() => ({ kind: 'flush' as const })),
          ])
        : await eventWait;

      if (outcome.kind === 'flush') {
        flushWait = undefined;
        flush();
        continue;
      }
      if (outcome.value.done) break;

      nextEvent = iterator.next();
      const event = outcome.value.value;
      if (event.type === 'session') {
        this.store.captureAgentTaskSession(taskId, event.sessionId);
      } else if (event.type === 'text_delta') {
        text += event.text;
        flushWait ??= delay(this.textFlushIntervalMs).then(() => 'flush');
      }
    }

    flush();
  }
}
