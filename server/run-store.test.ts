import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RunStore } from './src/run-store.js';

describe('RunStore', () => {
  let store: RunStore;

  beforeEach(() => {
    store = new RunStore();
  });

  afterEach(() => {
    store.close();
  });

  function createRun(id: string, snapshot: unknown = { nodes: [] }) {
    const definitionId = store.createWorkflowDefinition({
      id: `definition-${id}`,
      name: 'Workflow',
      ir: snapshot,
    });
    return store.createRun({ id, definitionId, irSnapshot: snapshot });
  }

  it('initializes the six-table schema with foreign keys enabled', () => {
    const tables = store.database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .all() as { name: string }[];

    expect(tables.map(({ name }) => name).sort()).toEqual([
      'agent_tasks',
      'artifacts',
      'run_events',
      'workflow_definitions',
      'workflow_node_runs',
      'workflow_runs',
    ]);
    expect(store.database.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('freezes the run IR snapshot before caller mutation', () => {
    const ir = { nodes: [{ id: 'review' }] };
    createRun('run-1', ir);

    ir.nodes[0]!.id = 'mutated';
    ir.nodes.push({ id: 'later' });

    expect(store.getIrSnapshot('run-1')).toEqual({
      nodes: [{ id: 'review' }],
    });
  });

  it('commits status and event atomically with independent contiguous seq', () => {
    createRun('run-1');
    createRun('run-2');
    const nodeRunId = store.createNodeRun({
      runId: 'run-1',
      nodeId: 'review',
      nodeType: 'agent.run',
    });
    const taskId = store.createAgentTask({
      nodeRunId,
      agentId: 'codex',
    });

    expect(
      store.setRunStatus('run-1', 'running', { type: 'run_started' }).seq,
    ).toBe(1);
    expect(store.appendEvent('run-2', { type: 'observed' }).seq).toBe(1);
    expect(store.appendEvent('run-1', { type: 'observed' }).seq).toBe(2);
    expect(store.appendEvent('run-2', { type: 'observed_again' }).seq).toBe(2);
    expect(
      store.setNodeRunStatus(nodeRunId, 'ready', { type: 'node_ready' }),
    ).toMatchObject({ seq: 3, node_id: 'review' });
    expect(
      store.setAgentTaskStatus(taskId, 'completed', {
        type: 'agent_task_completed',
      }),
    ).toMatchObject({ seq: 4, node_id: 'review' });

    expect(() =>
      store.setRunStatus('run-1', 'failed', { type: '' }),
    ).toThrow('event.type must not be empty');
    expect(store.getRun('run-1')?.status).toBe('running');
    expect(store.getEvents('run-1').map(({ seq }) => seq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(store.getEvents('run-2').map(({ seq }) => seq)).toEqual([1, 2]);
  });

  it('rejects duplicate, updated, and deleted events in SQLite', () => {
    createRun('run-1');
    store.appendEvent('run-1', { type: 'original', data: { value: 1 } });

    expect(() =>
      store.database
        .prepare(
          `INSERT INTO run_events
            (run_id, seq, type, created_at) VALUES (?, ?, ?, ?)`,
        )
        .run('run-1', 1, 'duplicate', Date.now()),
    ).toThrow();
    expect(() =>
      store.database
        .prepare('UPDATE run_events SET type = ? WHERE run_id = ? AND seq = ?')
        .run('changed', 'run-1', 1),
    ).toThrow('run_events are append-only');
    expect(() =>
      store.database
        .prepare('DELETE FROM run_events WHERE run_id = ? AND seq = ?')
        .run('run-1', 1),
    ).toThrow('run_events are append-only');

    expect(store.getEvents('run-1')).toMatchObject([
      { seq: 1, type: 'original', data_json: '{"value":1}' },
    ]);
  });

  it('reads artifacts by run and node while preserving provenance', () => {
    createRun('run-1');
    createRun('run-2');
    const nodeRunId = store.createNodeRun({
      id: 'node-run-1',
      runId: 'run-1',
      nodeId: 'review',
      nodeType: 'agent.run',
    });
    const artifactId = store.writeArtifact({
      id: 'artifact-1',
      runId: 'run-1',
      nodeRunId,
      type: 'report',
      name: 'review',
      data: { text: 'done' },
    });

    expect(store.getArtifactsByRunId('run-1')).toMatchObject([
      { id: artifactId, run_id: 'run-1', node_run_id: nodeRunId },
    ]);
    expect(store.getArtifactsByNodeRunId(nodeRunId)).toMatchObject([
      { id: artifactId, run_id: 'run-1', node_run_id: nodeRunId },
    ]);
    expect(() =>
      store.writeArtifact({
        runId: 'run-2',
        nodeRunId,
        type: 'report',
        name: 'wrong-run',
        data: {},
      }),
    ).toThrow('artifact node_run_id does not belong to run_id');
  });
});
