import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

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
  status?: string;
  createdAt?: number;
}

export interface WorkflowNodeRunInput {
  id?: string;
  runId: string;
  nodeId: string;
  nodeType: string;
  round?: number;
  status?: string;
  attempt?: number;
  maxAttempts?: number;
  inputs?: unknown;
}

export interface AgentTaskInput {
  id?: string;
  nodeRunId: string;
  agentId: string;
  attempt?: number;
  status?: string;
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
  status: string;
  inputs_json: string;
  outputs_json: string | null;
  error_json: string | null;
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

export class RunStore {
  readonly database: SqliteDatabase;
  private readonly insertEventStatement: SqliteStatement;
  private readonly updateRunStatusStatement: SqliteStatement;
  private readonly getNodeRunForStatusStatement: SqliteStatement;
  private readonly updateNodeRunStatusStatement: SqliteStatement;
  private readonly getAgentTaskForStatusStatement: SqliteStatement;
  private readonly updateAgentTaskStatusStatement: SqliteStatement;
  private readonly appendEventTransaction: SqliteTransaction<
    [runId: string, event: RunEventInput],
    RunEventRow
  >;
  private readonly setRunStatusTransaction: SqliteTransaction<
    [runId: string, status: string, event: RunEventInput],
    RunEventRow
  >;
  private readonly setNodeRunStatusTransaction: SqliteTransaction<
    [nodeRunId: string, status: string, event: RunEventInput],
    RunEventRow
  >;
  private readonly setAgentTaskStatusTransaction: SqliteTransaction<
    [taskId: string, status: string, event: RunEventInput],
    RunEventRow
  >;

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
    this.updateRunStatusStatement = this.database.prepare(
      'UPDATE workflow_runs SET status = ? WHERE id = ?',
    );
    this.getNodeRunForStatusStatement = this.database.prepare(
      'SELECT run_id, node_id FROM workflow_node_runs WHERE id = ?',
    );
    this.updateNodeRunStatusStatement = this.database.prepare(
      'UPDATE workflow_node_runs SET status = ? WHERE id = ?',
    );
    this.getAgentTaskForStatusStatement = this.database.prepare(
      `SELECT workflow_node_runs.run_id, workflow_node_runs.node_id
       FROM agent_tasks
       JOIN workflow_node_runs
         ON workflow_node_runs.id = agent_tasks.node_run_id
       WHERE agent_tasks.id = ?`,
    );
    this.updateAgentTaskStatusStatement = this.database.prepare(
      'UPDATE agent_tasks SET status = ? WHERE id = ?',
    );

    this.appendEventTransaction = this.database.transaction(
      (runId: string, event: RunEventInput) => this.insertEvent(runId, event),
    );
    this.setRunStatusTransaction = this.database.transaction(
      (runId: string, status: string, event: RunEventInput) => {
        const result = this.updateRunStatusStatement.run(
          requiredText(status, 'status'),
          runId,
        );
        if (Number(result.changes) !== 1)
          throw new Error(`Run not found: ${runId}`);
        return this.insertEvent(runId, event);
      },
    );
    this.setNodeRunStatusTransaction = this.database.transaction(
      (nodeRunId: string, status: string, event: RunEventInput) => {
        const node = this.getNodeRunForStatusStatement.get(nodeRunId) as
          | { run_id: string; node_id: string }
          | undefined;
        if (!node) throw new Error(`Node run not found: ${nodeRunId}`);
        this.updateNodeRunStatusStatement.run(
          requiredText(status, 'status'),
          nodeRunId,
        );
        return this.insertEvent(node.run_id, {
          ...event,
          nodeId: node.node_id,
        });
      },
    );
    this.setAgentTaskStatusTransaction = this.database.transaction(
      (taskId: string, status: string, event: RunEventInput) => {
        const task = this.getAgentTaskForStatusStatement.get(taskId) as
          | { run_id: string; node_id: string }
          | undefined;
        if (!task) throw new Error(`Agent task not found: ${taskId}`);
        this.updateAgentTaskStatusStatement.run(
          requiredText(status, 'status'),
          taskId,
        );
        return this.insertEvent(task.run_id, {
          ...event,
          nodeId: task.node_id,
        });
      },
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
    return id;
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
    return id;
  }

  createAgentTask(input: AgentTaskInput): string {
    const id = input.id ?? randomUUID();
    this.database
      .prepare(
        `INSERT INTO agent_tasks
          (id, node_run_id, agent_id, attempt, status, work_dir, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.nodeRunId,
        requiredText(input.agentId, 'agentId'),
        input.attempt ?? 1,
        input.status ?? 'running',
        input.workDir ?? null,
        input.createdAt ?? Date.now(),
      );
    return id;
  }

  appendEvent(runId: string, event: RunEventInput): RunEventRow {
    return this.appendEventTransaction.immediate(runId, event);
  }

  setRunStatus(
    runId: string,
    status: string,
    event: RunEventInput,
  ): RunEventRow {
    return this.setRunStatusTransaction.immediate(runId, status, event);
  }

  setNodeRunStatus(
    nodeRunId: string,
    status: string,
    event: RunEventInput,
  ): RunEventRow {
    return this.setNodeRunStatusTransaction.immediate(
      nodeRunId,
      status,
      event,
    );
  }

  setAgentTaskStatus(
    taskId: string,
    status: string,
    event: RunEventInput,
  ): RunEventRow {
    return this.setAgentTaskStatusTransaction.immediate(taskId, status, event);
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
    this.database
      .prepare(
        `INSERT INTO artifacts
          (id, run_id, node_run_id, type, name, dedupe_key, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.nodeRunId ?? null,
        requiredText(input.type, 'type'),
        requiredText(input.name, 'name'),
        input.dedupeKey ?? null,
        toJson(input.data),
        input.createdAt ?? Date.now(),
      );
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
}
