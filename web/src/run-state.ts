export type NodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';

export type RunStatus = 'created' | 'running' | 'completed' | 'failed';

export const STATUS_COLOR_TOKENS = {
  pending: 'status-pending',
  ready: 'status-ready',
  running: 'status-running',
  completed: 'status-completed',
  failed: 'status-failed',
} as const satisfies Record<NodeStatus, string>;

export interface WorkflowNodeSnapshot {
  id: string;
  type: string;
  agent: string;
}

export interface WorkflowEdgeSnapshot {
  from: string;
  to: string;
}

export interface WorkflowSnapshot {
  name: string;
  nodes: WorkflowNodeSnapshot[];
  edges: WorkflowEdgeSnapshot[];
}

export interface RunEvent {
  run_id: string;
  seq: number;
  node_id: string | null;
  type: string;
  data_json: string | null;
  created_at: number;
}

export interface Artifact {
  id: string;
  run_id: string;
  node_run_id: string | null;
  type: string;
  name: string;
  data_json: string;
  created_at: number;
}

export interface RunViewState {
  runId: string;
  runStatus: RunStatus;
  lastSeq: number;
  nodeStatuses: Readonly<Record<string, NodeStatus>>;
  nodeRunIds: Readonly<Record<string, string>>;
  agentText: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  return value === null ? null : requiredString(value, name);
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer.`);
  }
  return value;
}

function parseJsonRecord(json: string | null): Record<string, unknown> {
  if (json === null) return {};
  return record(JSON.parse(json)) ?? {};
}

export function parseWorkflowSnapshot(json: string): WorkflowSnapshot {
  const value = record(JSON.parse(json));
  if (value === undefined || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) {
    throw new TypeError('ir_snapshot_json must contain nodes and edges arrays.');
  }

  return {
    name: requiredString(value.name, 'workflow.name'),
    nodes: value.nodes.map((item, index) => {
      const node = record(item);
      if (node === undefined) throw new TypeError(`nodes[${index}] must be an object.`);
      return {
        id: requiredString(node.id, `nodes[${index}].id`),
        type: requiredString(node.type, `nodes[${index}].type`),
        agent: requiredString(node.agent, `nodes[${index}].agent`),
      };
    }),
    edges: value.edges.map((item, index) => {
      const edge = record(item);
      if (edge === undefined) throw new TypeError(`edges[${index}] must be an object.`);
      return {
        from: requiredString(edge.from, `edges[${index}].from`),
        to: requiredString(edge.to, `edges[${index}].to`),
      };
    }),
  };
}

export function parseRunEvent(value: unknown): RunEvent {
  const event = record(value);
  if (event === undefined) throw new TypeError('Run event must be an object.');
  return {
    run_id: requiredString(event.run_id, 'event.run_id'),
    seq: integer(event.seq, 'event.seq'),
    node_id: nullableString(event.node_id, 'event.node_id'),
    type: requiredString(event.type, 'event.type'),
    data_json: nullableString(event.data_json, 'event.data_json'),
    created_at: integer(event.created_at, 'event.created_at'),
  };
}

export function parseArtifacts(value: unknown): Artifact[] {
  if (!Array.isArray(value)) throw new TypeError('Artifacts response must be an array.');
  return value.map((item, index) => {
    const artifact = record(item);
    if (artifact === undefined) {
      throw new TypeError(`artifacts[${index}] must be an object.`);
    }
    return {
      id: requiredString(artifact.id, `artifacts[${index}].id`),
      run_id: requiredString(artifact.run_id, `artifacts[${index}].run_id`),
      node_run_id: nullableString(
        artifact.node_run_id,
        `artifacts[${index}].node_run_id`,
      ),
      type: requiredString(artifact.type, `artifacts[${index}].type`),
      name: requiredString(artifact.name, `artifacts[${index}].name`),
      data_json: requiredString(
        artifact.data_json,
        `artifacts[${index}].data_json`,
      ),
      created_at: integer(
        artifact.created_at,
        `artifacts[${index}].created_at`,
      ),
    };
  });
}

export function artifactText(artifact: Artifact): string {
  const data = parseJsonRecord(artifact.data_json);
  return typeof data.text === 'string' ? data.text : artifact.data_json;
}

export function createRunViewState(
  runId: string,
  status: RunStatus,
  workflow: WorkflowSnapshot,
): RunViewState {
  return {
    runId,
    runStatus: status,
    lastSeq: 0,
    nodeStatuses: Object.fromEntries(
      workflow.nodes.map(({ id }) => [id, 'pending' as const]),
    ),
    nodeRunIds: {},
    agentText: '',
  };
}

const NODE_STATUS_BY_EVENT = {
  node_ready: 'ready',
  node_started: 'running',
  node_completed: 'completed',
  node_failed: 'failed',
} as const satisfies Readonly<Record<string, NodeStatus>>;

export function reduceRunEvent(
  state: RunViewState,
  event: RunEvent,
): RunViewState {
  if (event.run_id !== state.runId || event.seq <= state.lastSeq) return state;

  const data = parseJsonRecord(event.data_json);
  const nodeStatus = (
    NODE_STATUS_BY_EVENT as Partial<Record<string, NodeStatus>>
  )[event.type];
  const nodeRunId = data.nodeRunId;

  return {
    ...state,
    lastSeq: event.seq,
    runStatus:
      event.type === 'run_started'
        ? 'running'
        : event.type === 'run_completed'
          ? 'completed'
          : event.type === 'run_failed'
            ? 'failed'
            : state.runStatus,
    nodeStatuses:
      event.node_id !== null && nodeStatus !== undefined
        ? { ...state.nodeStatuses, [event.node_id]: nodeStatus }
        : state.nodeStatuses,
    nodeRunIds:
      event.node_id !== null && typeof nodeRunId === 'string'
        ? { ...state.nodeRunIds, [nodeRunId]: event.node_id }
        : state.nodeRunIds,
    agentText:
      event.type === 'agent_text_delta' && typeof data.text === 'string'
        ? state.agentText + data.text
        : state.agentText,
  };
}

export function workflowFingerprint(workflow: WorkflowSnapshot): string {
  return JSON.stringify({ nodes: workflow.nodes, edges: workflow.edges });
}
