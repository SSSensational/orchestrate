import type {
  AgentAdapter,
  AgentCapabilities,
  AgentEvent,
  AgentExecuteInput,
  AgentExecution,
  AgentResult,
  WorkflowIrL2Input,
} from '@agent-workflow/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { RunOrchestrator } from './src/run-orchestrator.js';
import { RunStore, StateTransitionError } from './src/run-store.js';

const workflow: WorkflowIrL2Input = {
  schema: 'agent.workflow/v1',
  name: 'Single node test workflow',
  inputs: {},
  workspace: { path: '/workspace', mode: 'shared_readonly' },
  actor: { initiator: 'test' },
  policies: {
    max_rounds: 1,
    max_node_runs: 1,
    timeout_seconds: 0,
    default_permissions: {
      filesystem: 'read',
      commands: 'none',
      network: false,
      mcp_servers: [],
    },
  },
  nodes: [
    {
      id: 'review',
      type: 'agent.run',
      agent: 'codex',
      prompt: 'Review the workspace.',
      output_artifacts: ['report'],
    },
  ],
  edges: [],
};

const capabilities: AgentCapabilities = {
  resume: true,
  fork: true,
  structuredOutput: true,
  mcp: true,
  sandbox: true,
  interactivePermission: true,
};

async function* agentEvents(events: readonly AgentEvent[]) {
  for (const event of events) yield event;
}

class DeterministicAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly displayName = 'Deterministic Codex';
  executedInput: AgentExecuteInput | undefined;

  constructor(
    private readonly normalizedEvents: readonly AgentEvent[],
    private readonly agentResult: AgentResult,
  ) {}

  capabilities(): Promise<AgentCapabilities> {
    return Promise.resolve(capabilities);
  }

  probe(): Promise<{ available: boolean; version?: string }> {
    return Promise.resolve({ available: true, version: 'test' });
  }

  execute(input: AgentExecuteInput): AgentExecution {
    this.executedInput = input;
    return {
      events: agentEvents(this.normalizedEvents),
      result: Promise.resolve(this.agentResult),
    };
  }

  stop(): Promise<void> {
    return Promise.resolve();
  }
}

describe('RunOrchestrator', () => {
  const stores: RunStore[] = [];

  afterEach(() => {
    for (const store of stores.splice(0)) store.close();
  });

  function createStore() {
    const store = new RunStore();
    stores.push(store);
    return store;
  }

  it('runs one adapter task and commits a causally ordered report', async () => {
    const store = createStore();
    const adapter = new DeterministicAdapter(
      [
        { type: 'session', sessionId: 'session-1' },
        { type: 'text_delta', text: 'hello ' },
        { type: 'text_delta', text: 'world' },
      ],
      {
        status: 'completed',
        sessionId: 'session-1',
        finalText: 'final report',
      },
    );
    const orchestrator = new RunOrchestrator(store, { codex: adapter });

    const outcome = await orchestrator.run(workflow);

    expect(outcome).toMatchObject({ status: 'completed' });
    expect(store.getRun(outcome.runId)?.status).toBe('completed');
    expect(store.getNodeRun(outcome.nodeRunId)?.status).toBe('completed');
    expect(store.getAgentTask(outcome.taskId)).toMatchObject({
      status: 'completed',
      session_id: 'session-1',
    });
    expect(adapter.executedInput).toMatchObject({
      taskId: outcome.taskId,
      prompt: 'Review the workspace.',
      workspace: { path: '/workspace', mode: 'shared_readonly' },
    });

    const artifacts = store.getArtifactsByRunId(outcome.runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      id: outcome.artifactId,
      run_id: outcome.runId,
      node_run_id: outcome.nodeRunId,
      type: 'report',
      name: 'report',
      data_json: '{"text":"final report"}',
    });
    expect(() =>
      store.writeArtifact({
        runId: outcome.runId,
        nodeRunId: outcome.nodeRunId,
        type: 'report',
        name: 'duplicate',
        data: { text: 'duplicate' },
      }),
    ).toThrow();

    const events = store.getEvents(outcome.runId);
    expect(events.map(({ seq }) => seq)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    expect(events.map(({ type }) => type)).toEqual([
      'run_created',
      'run_started',
      'node_ready',
      'node_started',
      'task_started',
      'session_captured',
      'agent_text_delta',
      'task_finished',
      'artifact_emitted',
      'node_completed',
      'run_completed',
    ]);
    expect(JSON.parse(events[6]!.data_json!)).toMatchObject({
      taskId: outcome.taskId,
      text: 'hello world',
    });
  });

  it('atomically fails the task, node, and run with persisted error data', async () => {
    const store = createStore();
    const adapter = new DeterministicAdapter(
      [{ type: 'session', sessionId: 'session-failed' }],
      { status: 'failed', failureReason: 'model unavailable' },
    );
    const orchestrator = new RunOrchestrator(store, { codex: adapter });

    const outcome = await orchestrator.run(workflow);

    expect(outcome).toMatchObject({
      status: 'failed',
      failureReason: 'model unavailable',
    });
    expect(store.getAgentTask(outcome.taskId)).toMatchObject({
      status: 'failed',
      failure_reason: 'model unavailable',
      error: 'model unavailable',
    });
    expect(store.getAgentTask(outcome.taskId)?.result_json).toContain(
      'model unavailable',
    );
    expect(store.getNodeRun(outcome.nodeRunId)).toMatchObject({
      status: 'failed',
    });
    expect(store.getRun(outcome.runId)).toMatchObject({ status: 'failed' });
    expect(store.getNodeRun(outcome.nodeRunId)?.error_json).toContain(
      'model unavailable',
    );
    expect(store.getRun(outcome.runId)?.error_json).toContain(
      'model unavailable',
    );
    expect(store.getArtifactsByRunId(outcome.runId)).toEqual([]);
    expect(store.getEvents(outcome.runId).slice(-3).map(({ type }) => type)).toEqual(
      ['task_finished', 'node_failed', 'run_failed'],
    );
  });

  it('rejects illegal transitions without changing state or appending an event', () => {
    const store = createStore();
    const definitionId = store.createWorkflowDefinition({
      name: workflow.name,
      ir: workflow,
    });
    const { runId, nodeRunId } = store.createRunWithPendingNode({
      definitionId,
      irSnapshot: workflow,
      nodeId: 'review',
      nodeType: 'agent.run',
    });
    const eventsBefore = store.getEvents(runId);

    let error: unknown;
    try {
      store.setNodeRunStatus(nodeRunId, 'completed', {
        type: 'node_completed',
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(StateTransitionError);
    expect(error).toMatchObject({
      code: 'invalid_state_transition',
      entity: 'node_run',
      entityId: nodeRunId,
      from: 'pending',
      to: 'completed',
    });
    expect(store.getNodeRun(nodeRunId)?.status).toBe('pending');
    expect(store.getEvents(runId)).toEqual(eventsBefore);
  });
});
