import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve, ADAPTERS } from './agents.mjs';

test('codex builder argv uses only supported non-interactive flags', () => {
  const [cmd, args] = resolve('codex', 'build', 'do the thing');

  assert.equal(cmd, 'codex');
  assert.deepEqual(args, ['exec', '--sandbox', 'workspace-write', 'do the thing']);
});

test('codex builder never emits the removed --ask-for-approval flag', () => {
  const [, args] = resolve('codex', 'build', 'p');

  // Regression guard: `codex exec --help` (codex-cli 0.144.1) has no --ask-for-approval;
  // passing it makes the process exit at argument parsing before the model starts.
  assert.ok(!args.includes('--ask-for-approval'), 'argv must not contain --ask-for-approval');
});

test('codex builder keeps the workspace-write sandbox (unattended, no wider grant)', () => {
  const [, args] = resolve('codex', 'build', 'p');

  const i = args.indexOf('--sandbox');
  assert.ok(i >= 0, 'argv must set --sandbox');
  assert.equal(args[i + 1], 'workspace-write');
  // No broader escape hatches that would expand permissions beyond the workspace.
  assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
  assert.ok(!args.includes('danger-full-access'));
});

test('codex reviewer stays read-only', () => {
  const [cmd, args] = resolve('codex', 'review', 'look');

  assert.equal(cmd, 'codex');
  assert.deepEqual(args, ['exec', '--sandbox', 'read-only', 'look']);
});

test('codex adapter is registered with a git author identity', () => {
  assert.ok(ADAPTERS.codex);
  assert.equal(ADAPTERS.codex.gitAuthor.name, 'Codex');
});
