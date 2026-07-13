import assert from 'node:assert/strict';

import {
  codexAdapterRegistry,
  RunOrchestrator,
  RunStore,
} from '@agent-workflow/server';

import { singleAgentCrossAgentReviewIr } from './single-agent-cross-agent-review.js';

async function main(): Promise<void> {
  const adapter = codexAdapterRegistry.codex;
  assert.ok(adapter, 'Codex adapter is missing from the orchestrator registry.');
  const probe = await adapter.probe();
  assert.equal(probe.available, true, 'Codex CLI is not available.');
  assert.ok(probe.version, 'Codex CLI returned no version.');

  const store = new RunStore();
  try {
    const outcome = await new RunOrchestrator(
      store,
      codexAdapterRegistry,
    ).run(singleAgentCrossAgentReviewIr, { target: process.cwd() });
    assert.equal(outcome.status, 'completed', outcome.failureReason);
    assert.equal(store.getRun(outcome.runId)?.status, 'completed');

    const events = store.getEvents(outcome.runId);
    assert.deepEqual(
      events.map(({ seq }) => seq),
      Array.from({ length: events.length }, (_, index) => index + 1),
    );
    const artifacts = store.getArtifactsByRunId(outcome.runId);
    assert.equal(artifacts.length, 1, 'Live run did not emit one report.');
    assert.deepEqual(
      {
        id: artifacts[0]!.id,
        runId: artifacts[0]!.run_id,
        nodeRunId: artifacts[0]!.node_run_id,
        type: artifacts[0]!.type,
      },
      {
        id: outcome.artifactId,
        runId: outcome.runId,
        nodeRunId: outcome.nodeRunId,
        type: 'report',
      },
    );

    process.stdout.write(
      `${JSON.stringify({
        transport: 'codex app-server --listen stdio://',
        version: probe.version,
        outcome,
        eventCount: events.length,
        artifact: {
          id: artifacts[0]!.id,
          runId: artifacts[0]!.run_id,
          nodeRunId: artifacts[0]!.node_run_id,
          type: artifacts[0]!.type,
        },
      })}\n`,
    );
  } finally {
    store.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
