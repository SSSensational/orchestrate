import {
  Background,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  artifactText,
  createRunViewState,
  parseArtifacts,
  parseRunEvent,
  parseWorkflowSnapshot,
  reduceRunEvent,
  STATUS_COLOR_TOKENS,
  workflowFingerprint,
  type Artifact,
  type NodeStatus,
  type RunStatus,
  type RunViewState,
  type WorkflowSnapshot,
} from './run-state.js';

interface WorkflowNodeData extends Record<string, unknown> {
  agent: string;
  label: string;
  status: NodeStatus;
  statusColor: string;
}

type WorkflowFlowNode = Node<WorkflowNodeData, 'workflow'>;

interface StartedRun {
  id: string;
  status: RunStatus;
  ir_snapshot_json: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseStartedRun(value: unknown): StartedRun {
  const run = record(value);
  if (
    run === undefined ||
    typeof run.id !== 'string' ||
    !['created', 'running', 'completed', 'failed'].includes(String(run.status)) ||
    typeof run.ir_snapshot_json !== 'string'
  ) {
    throw new TypeError('Start response does not match the run contract.');
  }
  return {
    id: run.id,
    status: run.status as RunStatus,
    ir_snapshot_json: run.ir_snapshot_json,
  };
}

function serverOrigin(): URL {
  const configured = new URLSearchParams(window.location.search).get('server_origin');
  const origin = new URL(configured ?? window.location.origin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1') {
    throw new Error('The runtime server must use loopback HTTP.');
  }
  return origin;
}

function WorkflowNode({ data }: NodeProps<WorkflowFlowNode>) {
  return (
    <article
      className="workflow-node"
      data-color-token={data.statusColor}
      data-status={data.status}
      style={{ '--node-status-color': `var(--${data.statusColor})` } as React.CSSProperties}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="node-kind">{data.agent}</span>
      <strong>{data.label}</strong>
      <span className="node-status">{data.status}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </article>
  );
}

const nodeTypes = { workflow: WorkflowNode };

function toFlowElements(
  workflow: WorkflowSnapshot,
  statuses: Readonly<Record<string, NodeStatus>>,
): { nodes: WorkflowFlowNode[]; edges: Edge[] } {
  return {
    nodes: workflow.nodes.map((node, index) => {
      const status = statuses[node.id] ?? 'pending';
      return {
        id: node.id,
        type: 'workflow',
        position: { x: 90 + (index % 3) * 280, y: 80 + Math.floor(index / 3) * 190 },
        draggable: false,
        connectable: false,
        deletable: false,
        selectable: false,
        data: {
          agent: node.agent,
          label: node.id,
          status,
          statusColor: STATUS_COLOR_TOKENS[status],
        },
      };
    }),
    edges: workflow.edges.map((edge, index) => ({
      id: `${edge.from}->${edge.to}:${index}`,
      source: edge.from,
      target: edge.to,
      deletable: false,
      selectable: false,
    })),
  };
}

export function App() {
  const origin = useMemo(serverOrigin, []);
  const [workflow, setWorkflow] = useState<WorkflowSnapshot>();
  const [view, setView] = useState<RunViewState>();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const lastSeqRef = useRef(0);
  const reconnectPausedUntilRef = useRef(0);

  const refreshArtifacts = useCallback(
    async (runId: string) => {
      const response = await fetch(new URL(`/api/runs/${encodeURIComponent(runId)}/artifacts`, origin));
      if (!response.ok) throw new Error(`Artifact request failed (${response.status}).`);
      setArtifacts(parseArtifacts(await response.json()));
    },
    [origin],
  );

  useEffect(() => {
    const root = document.querySelector('#app');
    if (root instanceof HTMLElement) {
      root.dataset.ready = 'true';
      root.dataset.serverOrigin = origin.origin;
    }
  }, [origin]);

  useEffect(() => {
    if (view === undefined) return;
    let stopped = false;
    let reconnectTimer: number | undefined;

    const connect = () => {
      if (stopped) return;
      const url = new URL(
        `/api/runs/${encodeURIComponent(view.runId)}/events`,
        origin,
      );
      url.protocol = 'ws:';
      url.searchParams.set('after_seq', String(lastSeqRef.current));
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.addEventListener('message', (message) => {
        try {
          const event = parseRunEvent(JSON.parse(String(message.data)));
          if (event.seq <= lastSeqRef.current) return;
          if (event.seq !== lastSeqRef.current + 1) {
            socket.close(1012, 'event sequence gap');
            return;
          }
          lastSeqRef.current = event.seq;
          setView((current) =>
            current === undefined ? current : reduceRunEvent(current, event),
          );
          if (
            event.type === 'artifact_emitted' ||
            event.type === 'node_completed' ||
            event.type === 'run_completed'
          ) {
            void refreshArtifacts(view.runId).catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : String(reason));
            });
          }
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : String(reason));
          socket.close(1002, 'invalid persisted event');
        }
      });
      socket.addEventListener('close', () => {
        if (stopped) return;
        const delay = Math.max(100, reconnectPausedUntilRef.current - Date.now());
        reconnectTimer = window.setTimeout(connect, delay);
      });
      socket.addEventListener('error', () => socket.close());
    };

    const testDisconnect = (rawEvent: Event) => {
      if (new URLSearchParams(window.location.search).get('e2e') !== 'true') return;
      const delay =
        rawEvent instanceof CustomEvent &&
        typeof (record(rawEvent.detail)?.delayMs) === 'number'
          ? Number(record(rawEvent.detail)?.delayMs)
          : 800;
      reconnectPausedUntilRef.current = Date.now() + delay;
      socketRef.current?.close(1000, 'e2e reconnect check');
    };

    window.addEventListener('run-ui:test-disconnect', testDisconnect);
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      window.removeEventListener('run-ui:test-disconnect', testDisconnect);
      socketRef.current?.close();
    };
  }, [origin, refreshArtifacts, view?.runId]);

  const startRun = async () => {
    setStarting(true);
    setError('');
    setArtifacts([]);
    try {
      const response = await fetch(new URL('/api/runs', origin), { method: 'POST' });
      if (!response.ok) throw new Error(`Run request failed (${response.status}).`);
      const run = parseStartedRun(await response.json());
      const snapshot = parseWorkflowSnapshot(run.ir_snapshot_json);
      lastSeqRef.current = 0;
      reconnectPausedUntilRef.current = 0;
      setWorkflow(snapshot);
      setView(createRunViewState(run.id, run.status, snapshot));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  };

  const flow = useMemo(
    () =>
      workflow === undefined
        ? { nodes: [] as WorkflowFlowNode[], edges: [] as Edge[] }
        : toFlowElements(workflow, view?.nodeStatuses ?? {}),
    [view?.nodeStatuses, workflow],
  );
  const reports = artifacts.filter(({ type }) => type === 'report');

  return (
    <main
      className="app-shell"
      data-ir-fingerprint={workflow === undefined ? '' : workflowFingerprint(workflow)}
    >
      <header>
        <div>
          <span className="eyebrow">LOCAL RUNTIME</span>
          <h1>Agent Workflow</h1>
        </div>
        <div className="run-summary">
          <span className="run-state" data-run-status={view?.runStatus ?? 'idle'}>
            {view?.runStatus ?? 'idle'}
          </span>
          <button
            data-testid="run-button"
            disabled={starting || view?.runStatus === 'running'}
            onClick={() => void startRun()}
            type="button"
          >
            {starting ? 'Starting…' : 'Run'}
          </button>
        </div>
      </header>

      {error.length > 0 && <p className="error" role="alert">{error}</p>}

      <section className="workspace" aria-label="Run workspace">
        <section className="canvas-card" aria-label="Read-only workflow canvas">
          <div className="section-heading">
            <div>
              <span className="eyebrow">WORKFLOW</span>
              <h2>{workflow?.name ?? 'Start a run to load the workflow'}</h2>
            </div>
            <span className="readonly-badge">Read only</span>
          </div>
          <div className="flow" data-testid="workflow-canvas">
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesReconnectable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.4, maxZoom: 1.2 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} />
            </ReactFlow>
          </div>
        </section>

        <aside className="details">
          <section className="panel" aria-labelledby="live-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SEQ {view?.lastSeq ?? 0}</span>
                <h2 id="live-heading">Agent stream</h2>
              </div>
              <span className="live-dot" aria-hidden="true" />
            </div>
            <pre id="agent-text" data-testid="agent-text">
              {view?.agentText || 'Waiting for persisted agent text…'}
            </pre>
          </section>

          <section className="panel artifacts" aria-labelledby="artifact-heading">
            <div className="section-heading">
              <div>
                <span className="eyebrow">PERSISTED OUTPUT</span>
                <h2 id="artifact-heading">Artifacts</h2>
              </div>
              <span className="artifact-count">{reports.length}</span>
            </div>
            {reports.length === 0 ? (
              <p className="empty">A completed report will appear here.</p>
            ) : (
              reports.map((artifact) => (
                <article className="artifact" data-artifact-id={artifact.id} key={artifact.id}>
                  <pre className="report-text">{artifactText(artifact)}</pre>
                  <dl>
                    <dt>Artifact id</dt><dd>{artifact.id}</dd>
                    <dt>Run id</dt><dd>{artifact.run_id}</dd>
                    <dt>Node</dt>
                    <dd>{artifact.node_run_id === null ? '—' : view?.nodeRunIds[artifact.node_run_id] ?? '—'}</dd>
                    <dt>Node run id</dt><dd>{artifact.node_run_id ?? '—'}</dd>
                  </dl>
                </article>
              ))
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
