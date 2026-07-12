import test from 'node:test';
import assert from 'node:assert/strict';
import { runCapture } from './agents.mjs';

test('runCapture returns stdout and exit status without a timeout', async () => {
  const r = await runCapture(['bash', ['-c', 'echo hi']], process.cwd());

  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'hi');
  assert.equal(r.timedOut, false);
});

test('runCapture kills the whole process tree on timeout (no zombie reviewers)', async () => {
  // Simulates an agent CLI that spawns its own children (shells / MCP servers) and hangs:
  // the background sleep is the grandchild that used to survive as an orphan.
  const r = await runCapture(
    ['bash', ['-c', 'sleep 300 & echo "GRANDCHILD=$!"; wait']],
    process.cwd(), { timeoutMs: 500 },
  );

  assert.equal(r.timedOut, true);
  const pid = Number(r.stdout.match(/GRANDCHILD=(\d+)/)?.[1]);
  assert.ok(pid > 0, 'grandchild pid must have been captured');
  await new Promise((res) => setTimeout(res, 300)); // allow signal delivery
  assert.throws(() => process.kill(pid, 0), 'grandchild must be dead after tree kill');
});
