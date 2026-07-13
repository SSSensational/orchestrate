import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

import type { AgentResult } from '@agent-workflow/shared';

export type WorkflowRunStatus = 'created' | 'running' | 'completed' | 'failed';
export type WorkflowNodeRunStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';
export type AgentTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export const RUN_STATUS_TRANSITIONS = {
  created: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
} as const satisfies Record<WorkflowRunStatus, readonly WorkflowRunStatus[]>;

export const NODE_RUN_STATUS_TRANSITIONS = {
  pending: ['ready'],
  ready: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
} as const satisfies Record<
  WorkflowNodeRunStatus,
  readonly WorkflowNodeRunStatus[]
>;

export const AGENT_TASK_STATUS_TRANSITIONS = {
  running: ['completed', 'failed', 'cancelled', 'timeout'],
  completed: [],
  failed: [],
  cancelled: [],
  timeout: [],
} as const satisfies Record<AgentTaskStatus, readonly AgentTaskStatus[]>;

export class StateTransitionError extends Error {
  readonly code = 'invalid_state_transition';

  constructor(
    readonly entity: 'run' | 'node_run' | 'agent_task',
    readonly entityId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${entity} state transition for ${entityId}: ${from} -> ${to}.`);
    this.name = 'StateTransitionError';
  }
}

export interface SqliteStatement {
  run(...parameters: unknown[]): { changes: number | bigint };
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

interface SqliteTransaction<Parameters extends unknown[], Result> {
  (...parameters: Parameters): Result;
  immediate(...parameters: Parameters): Result;
}

export interface SqliteDatabase {
  close(): void;
  exec(sql: string): this;
  pragma(source: string, options?: { simple?: boolean }): unknown;
  prepare(sql: string): SqliteStatement;
  transaction<Parameters extends unknown[], Result>(
    fn: (...parameters: Parameters) => Result,
  ): SqliteTransaction<Parameters, Result>;
}

const Database = createRequire(import.meta.url)('better-sqlite3') as new (
  path: string | Buffer,
) => SqliteDatabase;

const schema = `
  CREATE TABLE IF NOT EXISTS workflow_definitions (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
    ir_json TEXT NOT NULL, ui_json TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    definition_id TEXT NOT NULL REFERENCES workflow_definitions(id),
    ir_snapshot_json TEXT NOT NULL,
    status TEXT NOT NULL,
    inputs_json TEXT NOT NULL, outputs_json TEXT, error_json TEXT,
    created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS workflow_node_runs (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    node_id TEXT NOT NULL, node_type TEXT NOT NULL,
    round INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1, max_attempts INTEGER NOT NULL DEFAULT 2,
    inputs_json TEXT, outputs_json TEXT, error_json TEXT,
    started_at INTEGER, finished_at INTEGER,
    UNIQUE (run_id, node_id, round)
  );

  CREATE TABLE IF NOT EXISTS agent_tasks (
    id TEXT PRIMARY KEY,
    node_run_id TEXT NOT NULL REFERENCES workflow_node_runs(id),
    agent_id TEXT NOT NULL, attempt INTEGER NOT NULL,
    status TEXT NOT NULL,
    session_id TEXT,
    work_dir TEXT,
    result_json TEXT, error TEXT, failure_reason TEXT,
    created_at INTEGER NOT NULL, started_at INTEGER, finished_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    node_run_id TEXT REFERENCES workflow_node_runs(id),
    type TEXT NOT NULL, name TEXT NOT NULL,
    -- PRD §7; single-channel-workflow-slice defers reduce-node use past P1.
    dedupe_key TEXT,
    data_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS artifacts_node_run_id_idx
  ON artifacts (node_run_id);

  CREATE UNIQUE INDEX IF NOT EXISTS artifacts_one_report_per_node_idx
  ON artifacts (node_run_id)
  WHERE type = 'report' AND node_run_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS run_events (
    run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    seq INTEGER NOT NULL,
    node_id TEXT, type TEXT NOT NULL, data_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (run_id, seq)
  );

  CREATE TRIGGER IF NOT EXISTS run_events_no_update
  BEFORE UPDATE ON run_events
  BEGIN
    SELECT RAISE(ABORT, 'run_events are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS run_events_no_delete
  BEFORE DELETE ON run_events
  BEGIN
    SELECT RAISE(ABORT, 'run_events are append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS artifacts_validate_node_run_insert
  BEFORE INSERT ON artifacts
  WHEN NEW.node_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_node_runs
    WHERE id = NEW.node_run_id AND run_id = NEW.run_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'artifact node_run_id does not belong to run_id');
  END;

  CREATE TRIGGER IF NOT EXISTS artifacts_validate_node_run_update
  BEFORE UPDATE OF run_id, node_run_id ON artifacts
  WHEN NEW.node_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM workflow_node_runs
    WHERE id = NEW.node_run_id AND run_id = NEW.run_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'artifact node_run_id does not belong to run_id');
  END;
`;

function toJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError('Value must be JSON serializable.');
  return json;
}

function requiredText(value: string, name: string): string {
  if (value.length === 0) throw new TypeError(`${name} must not be empty.`);
  return value;
}

export interface WorkflowDefinitionInput {
  id?: string;
  name: string;
  description?: string | null;
  ir: unknown;
  ui?: unknown;
  createdAt?: number;
}

export interface WorkflowRunInput {
  id?: string;
  definitionId: string;
  irSnapshot: unknown;
  inputs?: unknown;
  status?: WorkflowRunStatus;
  createdAt?: number;
}

export interface WorkflowNodeRunInput {
  id?: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  round?: number;
  status?: WorkflowNodeRunStatus;
  attempt?: number;
  maxAttempts?: number;
  inputs?: unknown;
}

export interface AgentTaskInput {
  id?: string;
  nodeRunId: string;
  agentId: string;
  attempt?: number;
  status?: AgentTaskStatus;
  workDir?: string | null;
  createdAt?: number;
}

export interface RunEventInput {
  type: string;
  nodeId?: string | null;
  data?: unknown;
  createdAt?: number;
}

export interface ArtifactInput {
  id?: string;
  runId: string;
  nodeRunId?: string | null;
  type: string;
  name: string;
  dedupeKey?: string | null;
  data: unknown;
  createdAt?: number;
}

export interface WorkflowRunRow {
  id: string;
  definition_id: string;
  ir_snapshot_json: string;
  status: WorkflowRunStatus;
  inputs_json: string;
  outputs_json: string | null;
  error_json: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface WorkflowNodeRunRow {
  id: string;
  run_id: string;
  node_id: string;
  node_type: string;
  round: number;
  status: WorkflowNodeRunStatus;
  attempt: number;
  max_attempts: number;
  inputs_json: string | null;
  outputs_json: string | null;
  error_json: string | null;
  started_at: number | null;
  finished_at: number | null;
}

export interface AgentTaskRow {
  id: string;
  node_run_id: string;
  agent_id: string;
  attempt: number;
  status: AgentTaskStatus;
  session_id: string | null;
  work_dir: string | null;
  result_json: string | null;
  error: string | null;
  failure_reason: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface RunEventRow {
  run_id: string;
  seq: number;
  node_id: string | null;
  type: string;
  data_json: string | null;
  created_at: number;
}

export interface ArtifactRow {
  id: string;
  run_id: string;
  node_run_id: string | null;
  type: string;
  name: string;
  dedupe_key: string | null;
  data_json: string;
  created_at: number;
}

export interface RunWithPendingNodeInput {
  runId?: string;
  nodeRunId?: string;
  definitionId: string;
  irSnapshot: unknown;
  inputs?: unknown;
  nodeId: string;
  nodeType: string;
  nodeInputs?: unknown;
  createdAt?: number;
}

export interface StartedAgentTask {
  taskId: string;
  nodeStartedEvent: RunEventRow;
  taskStartedEvent: RunEventRow;
}

export interface CompletedAgentNode {
  artifactId?: string;
  taskFinishedEvent: RunEventRow;
  artifactEmittedEvent?: RunEventRow;
  nodeCompletedEvent: RunEventRow;
}

function assertTransition(
  entity: StateTransitionError['entity'],
  entityId: string,
  from: string,
  to: string,
  transitions: Readonly<Record<string, readonly string[]>>,
): void {
  if (!(transitions[from] ?? []).includes(to)) {
    throw new StateTransitionError(entity, entityId, from, to);
  }
}

export class RunStore {
  readonly database: SqliteDatabase;
  private readonly insertEventStatement: SqliteStatement;

  constructor(path: string | Buffer = ':memory:') {
    this.database = new Database(path);
    this.database.pragma('foreign_keys = ON');
    this.database.exec(schema);
    this.insertEventStatement = this.database.prepare(
      `INSERT INTO run_events
        (run_id, seq, node_id, type, data_json, created_at)
       SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?
       FROM run_events
       WHERE run_id = ?
       RETURNING *`,
    );
  }

  close(): void {
    this.database.close();
  }

  createWorkflowDefinition(input: WorkflowDefinitionInput): string {
    const id = input.id ?? randomUUID();
    const now = input.createdAt ?? Date.now();
    this.database
      .prepare(
        `INSERT INTO workflow_definitions
          (id, name, description, ir_json, ui_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        requiredText(input.name, 'name'),
        input.description ?? null,
        toJson(input.ir),
        input.ui === undefined ? null : toJson(input.ui),
        now,
        now,
      );
    return id;
  }

  createRun(input: WorkflowRunInput): string {
    const id = input.id ?? randomUUID();
    // Serialize before opening the write transaction so this exact value is frozen.
    const snapshot = toJson(input.irSnapshot);
    this.insertRun(id, input, snapshot);
    return id;
  }

  createRunWithPendingNode(input: RunWithPendingNodeInput): {
    runId: string;
    nodeRunId: string;
    runCreatedEvent: RunEventRow;
  } {
    const runId = input.runId ?? randomUUID();
    const nodeRunId = input.nodeRunId ?? randomUUID();
    const createdAt = input.createdAt ?? Date.now();
    const snapshot = toJson(input.irSnapshot);

    return this.immediate(() => {
      this.insertRun(
        runId,
        {
          definitionId: input.definitionId,
          irSnapshot: input.irSnapshot,
          inputs: input.inputs,
          status: 'created',
          createdAt,
        },
        snapshot,
      );
      this.insertNodeRun(nodeRunId, {
        runId,
        nodeId: input.nodeId,
        nodeType: input.nodeType,
        status: 'pending',
        inputs: input.nodeInputs,
      });
      const runCreatedEvent = this.insertEvent(runId, {
        type: 'run_created',
        data: { nodeRunId },
        createdAt,
      });
      return { runId, nodeRunId, runCreatedEvent };
    });
  }

  getRun(runId: string): WorkflowRunRow | undefined {
    return this.database
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(runId) as WorkflowRunRow | undefined;
  }

  getIrSnapshot(runId: string): unknown {
    const run = this.getRun(runId);
    return run ? JSON.parse(run.ir_snapshot_json) : undefined;
  }

  createNodeRun(input: WorkflowNodeRunInput): string {
    const id = input.id ?? randomUUID();
    this.insertNodeRun(id, input);
    return id;
  }

  getNodeRun(nodeRunId: string): WorkflowNodeRunRow | undefined {
    return this.database
      .prepare('SELECT * FROM workflow_node_runs WHERE id = ?')
      .get(nodeRunId) as WorkflowNodeRunRow | undefined;
  }

  createAgentTask(input: AgentTaskInput): string {
    const id = input.id ?? randomUUID();
    this.insertAgentTask(id, input);
    return id;
  }

  getAgentTask(taskId: string): AgentTaskRow | undefined {
    return this.database
      .prepare('SELECT * FROM agent_tasks WHERE id = ?')
      .get(taskId) as AgentTaskRow | undefined;
  }

  appendEvent(runId: string, event: RunEventInput): RunEventRow {
    return this.immediate(() => this.insertEvent(runId, event));
  }

  setRunStatus(
    runId: string,
    status: WorkflowRunStatus,
    event: RunEventInput,
    errorData?: unknown,
  ): RunEventRow {
    return this.immediate(() => {
      const run = this.getRun(runId);
      if (!run) throw new Error(`Run not found: ${runId}`);
      assertTransition(
        'run',
        runId,
        run.status,
        status,
        RUN_STATUS_TRANSITIONS,
      );
      const at = event.createdAt ?? Date.now();
      const result = this.database
        .prepare(
          `UPDATE workflow_runs
           SET status = ?, started_at = ?, finished_at = ?, error_json = ?
           WHERE id = ? AND status = ?`,
        )
        .run(
          status,
          status === 'running' ? at : run.started_at,
          status === 'completed' || status === 'failed' ? at : null,
          status === 'failed' && errorData !== undefined
            ? toJson(errorData)
            : null,
          runId,
          run.status,
        );
      if (Number(result.changes) !== 1) {
        throw new Error(`Concurrent run state change: ${runId}`);
      }
      return this.insertEvent(runId, { ...event, createdAt: at });
    });
  }

  setNodeRunStatus(
    nodeRunId: string,
    status: WorkflowNodeRunStatus,
    event: RunEventInput,
    errorData?: unknown,
  ): RunEventRow {
    return this.immediate(() => {
      const node = this.getNodeRun(nodeRunId);
      if (!node) throw new Error(`Node run not found: ${nodeRunId}`);
      assertTransition(
        'node_run',
        nodeRunId,
        node.status,
        status,
        NODE_RUN_STATUS_TRANSITIONS,
      );
      const at = event.createdAt ?? Date.now();
      const result = this.database
        .prepare(
          `UPDATE workflow_node_runs
           SET status = ?, started_at = ?, finished_at = ?, error_json = ?
           WHERE id = ? AND status = ?`,
        )
        .run(
          status,
          status === 'running' ? at : node.started_at,
          status === 'completed' || status === 'failed' ? at : null,
          status === 'failed' && errorData !== undefined
            ? toJson(errorData)
            : null,
          nodeRunId,
          node.status,
        );
      if (Number(result.changes) !== 1) {
        throw new Error(`Concurrent node run state change: ${nodeRunId}`);
      }
      return this.insertEvent(node.run_id, {
        ...event,
        nodeId: node.node_id,
        createdAt: at,
      });
    });
  }

  setAgentTaskStatus(
    taskId: string,
    status: AgentTaskStatus,
    event: RunEventInput,
    persistence: {
      result?: unknown;
      error?: string;
      failureReason?: string;
    } = {},
  ): RunEventRow {
    return this.immediate(() => {
      const context = this.getTaskContext(taskId);
      assertTransition(
        'agent_task',
        taskId,
        context.task_status,
        status,
        AGENT_TASK_STATUS_TRANSITIONS,
      );
      const at = event.createdAt ?? Date.now();
      const result = this.database
        .prepare(
          `UPDATE agent_tasks
           SET status = ?, result_json = ?, error = ?, failure_reason = ?,
               finished_at = ?
           WHERE id = ? AND status = ?`,
        )
        .run(
          status,
          persistence.result === undefined ? null : toJson(persistence.result),
          persistence.error ?? null,
          persistence.failureReason ?? null,
          at,
          taskId,
          context.task_status,
        );
      if (Number(result.changes) !== 1) {
        throw new Error(`Concurrent agent task state change: ${taskId}`);
      }
      return this.insertEvent(context.run_id, {
        ...event,
        nodeId: context.node_id,
        createdAt: at,
      });
    });
  }

  startAgentTask(input: Omit<AgentTaskInput, 'status'>): StartedAgentTask {
    const taskId = input.id ?? randomUUID();
    const at = input.createdAt ?? Date.now();

    return this.immediate(() => {
      const node = this.getNodeRun(input.nodeRunId);
      if (!node) throw new Error(`Node run not found: ${input.nodeRunId}`);
      assertTransition(
        'node_run',
        node.id,
        node.status,
        'running',
        NODE_RUN_STATUS_TRANSITIONS,
      );
      this.database
        .prepare(
          `UPDATE workflow_node_runs SET status = 'running', started_at = ?
           WHERE id = ? AND status = 'ready'`,
        )
        .run(at, node.id);
      const nodeStartedEvent = this.insertEvent(node.run_id, {
        type: 'node_started',
        nodeId: node.node_id,
        data: { nodeRunId: node.id },
        createdAt: at,
      });
      this.insertAgentTask(taskId, { ...input, status: 'running', createdAt: at });
      const taskStartedEvent = this.insertEvent(node.run_id, {
        type: 'task_started',
        nodeId: node.node_id,
        data: { taskId, nodeRunId: node.id, agentId: input.agentId },
        createdAt: at,
      });
      return { taskId, nodeStartedEvent, taskStartedEvent };
    });
  }

  captureAgentTaskSession(taskId: string, sessionId: string): RunEventRow {
    return this.immediate(() => {
      const context = this.getTaskContext(taskId);
      if (context.task_status !== 'running') {
        throw new StateTransitionError(
          'agent_task',
          taskId,
          context.task_status,
          'session_captured',
        );
      }
      if (context.session_id !== null) {
        throw new Error(`Agent task session already captured: ${taskId}`);
      }
      const capturedSessionId = requiredText(sessionId, 'sessionId');
      this.database
        .prepare(
          `UPDATE agent_tasks SET session_id = ?
           WHERE id = ? AND status = 'running' AND session_id IS NULL`,
        )
        .run(capturedSessionId, taskId);
      return this.insertEvent(context.run_id, {
        type: 'session_captured',
        nodeId: context.node_id,
        data: { taskId, sessionId: capturedSessionId },
      });
    });
  }

  recordAgentTextDelta(taskId: string, text: string): RunEventRow {
    return this.immediate(() => {
      const context = this.getTaskContext(taskId);
      if (context.task_status !== 'running') {
        throw new StateTransitionError(
          'agent_task',
          taskId,
          context.task_status,
          'agent_text_delta',
        );
      }
      return this.insertEvent(context.run_id, {
        type: 'agent_text_delta',
        nodeId: context.node_id,
        data: { taskId, text: requiredText(text, 'text delta') },
      });
    });
  }

  completeAgentTaskAndNode(
    taskId: string,
    result: AgentResult,
    finishedAt = Date.now(),
  ): CompletedAgentNode {
    if (result.status !== 'completed') {
      throw new TypeError('Completed agent result must have status completed.');
    }

    return this.immediate(() => {
      const context = this.getTaskContext(taskId);
      assertTransition(
        'agent_task',
        taskId,
        context.task_status,
        'completed',
        AGENT_TASK_STATUS_TRANSITIONS,
      );
      assertTransition(
        'node_run',
        context.node_run_id,
        context.node_status,
        'completed',
        NODE_RUN_STATUS_TRANSITIONS,
      );
      if (context.run_status !== 'running') {
        throw new StateTransitionError(
          'run',
          context.run_id,
          context.run_status,
          'completed',
        );
      }

      this.database
        .prepare(
          `UPDATE agent_tasks
           SET status = 'completed', result_json = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(toJson(result), finishedAt, taskId);
      const taskFinishedEvent = this.insertEvent(context.run_id, {
        type: 'task_finished',
        nodeId: context.node_id,
        data: { taskId, status: 'completed' },
        createdAt: finishedAt,
      });

      let artifactId: string | undefined;
      let artifactEmittedEvent: RunEventRow | undefined;
      if (result.finalText?.trim()) {
        artifactId = randomUUID();
        this.insertArtifact({
          id: artifactId,
          runId: context.run_id,
          nodeRunId: context.node_run_id,
          type: 'report',
          name: 'report',
          dedupeKey: 'final-text',
          data: { text: result.finalText },
          createdAt: finishedAt,
        });
        artifactEmittedEvent = this.insertEvent(context.run_id, {
          type: 'artifact_emitted',
          nodeId: context.node_id,
          data: {
            artifactId,
            runId: context.run_id,
            nodeRunId: context.node_run_id,
            type: 'report',
            name: 'report',
          },
          createdAt: finishedAt,
        });
      }

      this.database
        .prepare(
          `UPDATE workflow_node_runs
           SET status = 'completed', outputs_json = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(
          artifactId === undefined ? null : toJson({ report: artifactId }),
          finishedAt,
          context.node_run_id,
        );
      const nodeCompletedEvent = this.insertEvent(context.run_id, {
        type: 'node_completed',
        nodeId: context.node_id,
        data: {
          nodeRunId: context.node_run_id,
          taskId,
          ...(artifactId === undefined ? {} : { artifactId }),
        },
        createdAt: finishedAt,
      });

      return {
        ...(artifactId === undefined ? {} : { artifactId }),
        taskFinishedEvent,
        ...(artifactEmittedEvent === undefined ? {} : { artifactEmittedEvent }),
        nodeCompletedEvent,
      };
    });
  }

  failAgentTaskNodeAndRun(
    taskId: string,
    result: AgentResult,
    finishedAt = Date.now(),
  ): { taskFinishedEvent: RunEventRow; nodeFailedEvent: RunEventRow; runFailedEvent: RunEventRow } {
    if (result.status === 'completed') {
      throw new TypeError('Failed agent result must have a terminal failure status.');
    }
    const failureReason = requiredText(
      result.failureReason?.trim() ?? '',
      'failureReason',
    );

    return this.immediate(() => {
      const context = this.getTaskContext(taskId);
      assertTransition(
        'agent_task',
        taskId,
        context.task_status,
        result.status,
        AGENT_TASK_STATUS_TRANSITIONS,
      );
      assertTransition(
        'node_run',
        context.node_run_id,
        context.node_status,
        'failed',
        NODE_RUN_STATUS_TRANSITIONS,
      );
      assertTransition(
        'run',
        context.run_id,
        context.run_status,
        'failed',
        RUN_STATUS_TRANSITIONS,
      );
      const errorData = {
        failureReason,
        taskId,
        taskStatus: result.status,
      };

      this.database
        .prepare(
          `UPDATE agent_tasks
           SET status = ?, result_json = ?, error = ?, failure_reason = ?,
               finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(
          result.status,
          toJson(result),
          failureReason,
          failureReason,
          finishedAt,
          taskId,
        );
      const taskFinishedEvent = this.insertEvent(context.run_id, {
        type: 'task_finished',
        nodeId: context.node_id,
        data: { ...errorData, status: result.status },
        createdAt: finishedAt,
      });

      this.database
        .prepare(
          `UPDATE workflow_node_runs
           SET status = 'failed', error_json = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(toJson(errorData), finishedAt, context.node_run_id);
      const nodeFailedEvent = this.insertEvent(context.run_id, {
        type: 'node_failed',
        nodeId: context.node_id,
        data: { ...errorData, nodeRunId: context.node_run_id },
        createdAt: finishedAt,
      });

      this.database
        .prepare(
          `UPDATE workflow_runs
           SET status = 'failed', error_json = ?, finished_at = ?
           WHERE id = ? AND status = 'running'`,
        )
        .run(toJson(errorData), finishedAt, context.run_id);
      const runFailedEvent = this.insertEvent(context.run_id, {
        type: 'run_failed',
        data: errorData,
        createdAt: finishedAt,
      });

      return { taskFinishedEvent, nodeFailedEvent, runFailedEvent };
    });
  }

  getEvents(runId: string, afterSeq = 0): RunEventRow[] {
    return this.database
      .prepare(
        `SELECT * FROM run_events
         WHERE run_id = ? AND seq > ?
         ORDER BY seq`,
      )
      .all(runId, afterSeq) as RunEventRow[];
  }

  writeArtifact(input: ArtifactInput): string {
    const id = input.id ?? randomUUID();
    this.insertArtifact({ ...input, id });
    return id;
  }

  getArtifactsByRunId(runId: string): ArtifactRow[] {
    return this.database
      .prepare('SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, id')
      .all(runId) as ArtifactRow[];
  }

  getArtifactsByNodeRunId(nodeRunId: string): ArtifactRow[] {
    return this.database
      .prepare(
        'SELECT * FROM artifacts WHERE node_run_id = ? ORDER BY created_at, id',
      )
      .all(nodeRunId) as ArtifactRow[];
  }

  private insertEvent(runId: string, event: RunEventInput): RunEventRow {
    return this.insertEventStatement.get(
      runId,
      event.nodeId ?? null,
      requiredText(event.type, 'event.type'),
      event.data === undefined ? null : toJson(event.data),
      event.createdAt ?? Date.now(),
      runId,
    ) as RunEventRow;
  }

  private insertRun(
    id: string,
    input: WorkflowRunInput,
    snapshot: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO workflow_runs
          (id, definition_id, ir_snapshot_json, status, inputs_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.definitionId,
        snapshot,
        input.status ?? 'created',
        toJson(input.inputs ?? {}),
        input.createdAt ?? Date.now(),
      );
  }

  private insertNodeRun(id: string, input: WorkflowNodeRunInput): void {
    this.database
      .prepare(
        `INSERT INTO workflow_node_runs
          (id, run_id, node_id, node_type, round, status, attempt,
           max_attempts, inputs_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        requiredText(input.nodeId, 'nodeId'),
        requiredText(input.nodeType, 'nodeType'),
        input.round ?? 1,
        input.status ?? 'pending',
        input.attempt ?? 1,
        input.maxAttempts ?? 2,
        input.inputs === undefined ? null : toJson(input.inputs),
      );
  }

  private insertAgentTask(id: string, input: AgentTaskInput): void {
    const createdAt = input.createdAt ?? Date.now();
    const status = input.status ?? 'running';
    this.database
      .prepare(
        `INSERT INTO agent_tasks
          (id, node_run_id, agent_id, attempt, status, work_dir,
           created_at, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.nodeRunId,
        requiredText(input.agentId, 'agentId'),
        input.attempt ?? 1,
        status,
        input.workDir ?? null,
        createdAt,
        status === 'running' ? createdAt : null,
      );
  }

  private insertArtifact(input: ArtifactInput & { id: string }): void {
    this.database
      .prepare(
        `INSERT INTO artifacts
          (id, run_id, node_run_id, type, name, dedupe_key, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.runId,
        input.nodeRunId ?? null,
        requiredText(input.type, 'type'),
        requiredText(input.name, 'name'),
        input.dedupeKey ?? null,
        toJson(input.data),
        input.createdAt ?? Date.now(),
      );
  }

  private getTaskContext(taskId: string): {
    run_id: string;
    run_status: WorkflowRunStatus;
    node_run_id: string;
    node_id: string;
    node_status: WorkflowNodeRunStatus;
    task_status: AgentTaskStatus;
    session_id: string | null;
  } {
    const context = this.database
      .prepare(
        `SELECT workflow_runs.id AS run_id,
                workflow_runs.status AS run_status,
                workflow_node_runs.id AS node_run_id,
                workflow_node_runs.node_id,
                workflow_node_runs.status AS node_status,
                agent_tasks.status AS task_status,
                agent_tasks.session_id
         FROM agent_tasks
         JOIN workflow_node_runs
           ON workflow_node_runs.id = agent_tasks.node_run_id
         JOIN workflow_runs
           ON workflow_runs.id = workflow_node_runs.run_id
         WHERE agent_tasks.id = ?`,
      )
      .get(taskId) as
      | {
          run_id: string;
          run_status: WorkflowRunStatus;
          node_run_id: string;
          node_id: string;
          node_status: WorkflowNodeRunStatus;
          task_status: AgentTaskStatus;
          session_id: string | null;
        }
      | undefined;
    if (!context) throw new Error(`Agent task not found: ${taskId}`);
    return context;
  }

  private immediate<Result>(operation: () => Result): Result {
    return this.database.transaction(operation).immediate();
  }
}
