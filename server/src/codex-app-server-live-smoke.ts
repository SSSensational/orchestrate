import assert from 'node:assert/strict';

import {
  CODEX_APP_SERVER_SMOKE_PROMPT,
  CodexAppServerAdapter,
} from './codex-app-server-adapter.js';

async function main(): Promise<void> {
  const adapter = new CodexAppServerAdapter();
  const probe = await adapter.probe();
  assert.equal(probe.available, true, 'Codex CLI is not available.');
  assert.ok(probe.version, 'Codex CLI returned no version.');

  const execution = adapter.execute({
    taskId: `live-smoke-${Date.now()}`,
    prompt: CODEX_APP_SERVER_SMOKE_PROMPT,
    workspace: { path: process.cwd(), mode: 'shared_readonly' },
    permissions: {
      filesystem: 'read',
      commands: 'none',
      network: false,
      mcp_servers: [],
    },
    mcpConfig: [],
    timeoutSeconds: 120,
  });

  let sawSession = false;
  let sawTextDelta = false;
  for await (const event of execution.events) {
    if (event.type === 'session') sawSession = true;
    if (event.type === 'text_delta') sawTextDelta = true;
    process.stdout.write(`${JSON.stringify({ event })}\n`);
  }

  const result = await execution.result;
  process.stdout.write(
    `${JSON.stringify({ transport: 'codex app-server --listen stdio://', version: probe.version, result })}\n`,
  );
  assert.equal(sawSession, true, 'Live run emitted no session event.');
  assert.equal(sawTextDelta, true, 'Live run emitted no text_delta event.');
  assert.equal(result.status, 'completed');
  assert.ok(result.finalText?.trim(), 'Live run returned empty finalText.');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
