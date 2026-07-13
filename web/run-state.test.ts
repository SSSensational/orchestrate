import { describe, expect, it } from 'vitest';

import {
  artifactText,
  createRunViewState,
  parseArtifacts,
  parseWorkflowSnapshot,
  reduceRunEvent,
  STATUS_COLOR_TOKENS,
  type RunEvent,
} from './src/run-state.js';

const workflow = parseWorkflowSnapshot(
  JSON.stringify({
    name: 'Cross-Agent Review',
    nodes: [{ id: 'codex_review', type: 'agent.run', agent: 'codex' }],
    edges: [],
  }),
);

function event(
  seq: number,
  type: string,
  data: unknown,
  nodeId: string | null = 'codex_review',
): RunEvent {
  return {
    run_id: 'run-1',
    seq,
    node_id: nodeId,
    type,
    data_json: JSON.stringify(data),
    created_at: seq,
  };
}

describe('persisted run event reducer', () => {
  it('updates status, text, and provenance once in seq order', () => {
    let state = createRunViewState('run-1', 'running', workflow);
    state = reduceRunEvent(
      state,
      event(1, 'node_started', { nodeRunId: 'node-run-1' }),
    );
    state = reduceRunEvent(
      state,
      event(2, 'agent_text_delta', { text: 'first ' }),
    );
    state = reduceRunEvent(
      state,
      event(3, 'agent_text_delta', { text: 'second' }),
    );
    const beforeDuplicate = state;
    const afterDuplicate = reduceRunEvent(
      beforeDuplicate,
      event(3, 'agent_text_delta', { text: 'second' }),
    );
    expect(afterDuplicate).toBe(beforeDuplicate);
    state = reduceRunEvent(
      afterDuplicate,
      event(4, 'node_completed', { nodeRunId: 'node-run-1' }),
    );
    state = reduceRunEvent(state, event(5, 'run_completed', {}, null));

    expect(state).toMatchObject({
      lastSeq: 5,
      runStatus: 'completed',
      agentText: 'first second',
      nodeStatuses: { codex_review: 'completed' },
      nodeRunIds: { 'node-run-1': 'codex_review' },
    });
    expect(STATUS_COLOR_TOKENS.running).toBe('status-running');
    expect(STATUS_COLOR_TOKENS.completed).toBe('status-completed');
  });

  it('keeps complete report text and persisted ids', () => {
    const [artifact] = parseArtifacts([
      {
        id: 'artifact-1',
        run_id: 'run-1',
        node_run_id: 'node-run-1',
        type: 'report',
        name: 'report',
        data_json: JSON.stringify({ text: 'line one\nline two' }),
        created_at: 10,
      },
    ]);

    expect(artifact).toMatchObject({
      id: 'artifact-1',
      run_id: 'run-1',
      node_run_id: 'node-run-1',
    });
    expect(artifactText(artifact!)).toBe('line one\nline two');
  });
});
