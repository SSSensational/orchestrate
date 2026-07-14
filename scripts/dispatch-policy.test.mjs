import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  invalidTestWriterChanges,
  isTestWriterIssue,
  localCheckNames,
  testWriterTaskContext,
} from './dispatch-policy.mjs';

test('selects test-writer only from its role label or title marker', () => {
  assert.equal(isTestWriterIssue({ title: 'plain', labels: ['role:test-writer'] }), true);
  assert.equal(isTestWriterIssue({ title: '[TEST-WRITER] suite', labels: [] }), true);
  assert.equal(isTestWriterIssue({ title: 'ordinary builder', labels: ['agent:build:codex'] }), false);
});

test('test-writer context contains criteria and delta specs, not other issue prose', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dispatch-policy-'));
  const specDir = join(cwd, 'openspec/changes/example/specs/workflow-ir');
  mkdirSync(specDir, { recursive: true });
  writeFileSync(join(specDir, 'spec.md'), 'delta contract');
  try {
    const context = testWriterTaskContext(cwd, {
      title: '[test-writer] suite（workflow-ir）',
      body: 'internal preface\n\n## 验收判据\n- [ ] public behavior\n\n## Notes\nprivate note',
      labels: [{ name: 'change:example' }],
    });

    assert.match(context, /public behavior/);
    assert.match(context, /delta contract/);
    assert.doesNotMatch(context, /internal preface|private note/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('test-writer checks and changed-path contract are role-specific', () => {
  assert.deepEqual(localCheckNames(true), ['typecheck', 'lint', 'acceptance']);
  assert.deepEqual(localCheckNames(false), ['typecheck', 'lint', 'test']);
  assert.deepEqual(invalidTestWriterChanges([{ status: 'A', path: 'acceptance/workflow.test.ts' }]), []);
  assert.deepEqual(invalidTestWriterChanges([
    { status: 'M', path: 'acceptance/existing.test.ts' },
    { status: 'A', path: 'shared/out-of-scope.ts' },
  ]), [
    { status: 'M', path: 'acceptance/existing.test.ts' },
    { status: 'A', path: 'shared/out-of-scope.ts' },
  ]);
});
