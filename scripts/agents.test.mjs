import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ADAPTERS } from './agents.mjs';

test('codex builder argv uses only supported non-interactive flags', () => {
  const [cmd, args] = resolve('codex', 'build', 'do the thing');

  assert.equal(cmd, 'codex');
  assert.deepEqual(args, [
    'exec', '--sandbox', 'workspace-write',
    '-c', 'sandbox_workspace_write.network_access=true',
    'do the thing',
  ]);
});

test('codex builder never emits the removed --ask-for-approval flag', () => {
  const [, args] = resolve('codex', 'build', 'p');

  // Regression guard: `codex exec --help` (codex-cli 0.144.1) has no --ask-for-approval;
  // passing it makes the process exit at argument parsing before the model starts.
  assert.ok(!args.includes('--ask-for-approval'), 'argv must not contain --ask-for-approval');
});

test('codex builder keeps the workspace-write sandbox: registry network, no full access', () => {
  const [, args] = resolve('codex', 'build', 'p');

  const i = args.indexOf('--sandbox');
  assert.ok(i >= 0, 'argv must set --sandbox');
  assert.equal(args[i + 1], 'workspace-write');
  // Registry network so pnpm can fetch newly introduced deps (issue #30);
  // still no escape hatches that would expand writes beyond the worktree.
  assert.ok(args.includes('sandbox_workspace_write.network_access=true'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('danger-full-access'));
});

test('codex reviewer can run verification: workspace-write sandbox with registry network', () => {
  const [cmd, args] = resolve('codex', 'review', 'look');

  assert.equal(cmd, 'codex');
  assert.deepEqual(args, [
    'exec', '--sandbox', 'workspace-write',
    '-c', 'sandbox_workspace_write.network_access=true',
    'look',
  ]);
  // Verification, not a blank check: no full-access escape hatches.
  assert.ok(!args.includes('danger-full-access'));
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('claude reviewer gets a Bash allowlist, not a permission bypass', () => {
  const [cmd, args] = resolve('claude', 'review', 'look');

  assert.equal(cmd, 'claude');
  assert.ok(!args.includes('bypassPermissions'), 'reviewer must not bypass permissions');
  const i = args.indexOf('--allowedTools');
  assert.ok(i >= 0, 'argv must set --allowedTools');
  assert.match(args[i + 1], /Bash\(pnpm:\*\)/, 'allowlist must cover pnpm verification commands');
  assert.ok(!/\bgh\b/.test(args[i + 1]), 'allowlist must not grant gh');
});

test('claude reviewer mounts Playwright MCP over CDP for GUI verification', () => {
  const [, args] = resolve('claude', 'review', 'look');

  const m = args.indexOf('--mcp-config');
  assert.ok(m >= 0, 'argv must set --mcp-config');
  const config = JSON.parse(args[m + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ['playwright']);
  assert.ok(config.mcpServers.playwright.args.includes('--cdp-endpoint'), 'must attach via CDP, not launch its own browser');
  assert.ok(args.includes('--strict-mcp-config'), 'must not inherit ambient MCP servers');
  const a = args.indexOf('--allowedTools');
  assert.match(args[a + 1], /mcp__playwright/, 'allowlist must grant the playwright MCP tools');
});

test('codex adapter is registered with a git author identity', () => {
  assert.ok(ADAPTERS.codex);
  assert.equal(ADAPTERS.codex.gitAuthor.name, 'Codex');
});
