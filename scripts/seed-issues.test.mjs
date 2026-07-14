import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTasks } from './seed-issues-parser.mjs';

test('parses numbered tasks, keeps indented criteria under their task, and ignores blockquotes', () => {
  const tasks = parseTasks(`
## 1. First task

> context only; never enters the issue body

  - [ ] first criterion
  - [ ] second criterion

## 2. [test-writer] Second task

> - [ ] quoted pseudo-criterion

  - [ ] third criterion
`);

  assert.deepEqual(tasks, [
    { title: 'First task', subs: ['first criterion', 'second criterion'] },
    { title: '[test-writer] Second task', subs: ['third criterion'] },
  ]);
});
