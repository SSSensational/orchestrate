## Why

GitHub issue [#48](https://github.com/SSSensational/orchestrate/issues/48) records that `scripts/worktree.sh 44` creates the requested branch and worktree, then fails while printing the result because the unbraced parameter expansion consumes adjacent text as part of the variable name. GNU Bash documents braces as the way to delimit a parameter from following characters, so the helper must delimit this output expansion and complete successfully after worktree creation ([Bash Reference Manual](https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html)).

## What Changes

- Make `scripts/worktree.sh` print the created worktree path, `issue/<n>` branch, agent launch example, and cleanup command without evaluating an unintended variable.
- Preserve the existing `issue/<n>` branch name and `../<repository-name>-issue-<n>` worktree directory name.
- Add deterministic coverage that executes the helper in an isolated temporary Git repository and asserts both repository state and observable output.

## Capabilities

### New Capabilities

- `worktree-helper`: Defines the local issue-worktree helper's naming contract and successful command-line behavior.

### Modified Capabilities

None.

## Impact

- Affected implementation: `scripts/worktree.sh` only.
- Affected behavior: local creation of issue branches/worktrees and the helper's stdout and exit status.
- APIs, product runtime, dependencies, `scripts/watch.mjs`, and `scripts/dispatch.mjs` are unchanged.

## 验收判据

- [ ] In an isolated temporary Git repository, invoking `scripts/worktree.sh <n>` creates a usable worktree at `../<repository-name>-issue-<n>` on a new `issue/<n>` branch.
- [ ] The invocation exits with status 0 and stdout contains the exact created worktree path, branch name, agent launch example using that path, and cleanup command using that path; stderr contains no `unbound variable` diagnostic.
- [ ] The branch and directory names remain `issue/<n>` and `../<repository-name>-issue-<n>` respectively.
- [ ] The implementation changes no file outside `scripts/worktree.sh`; acceptance coverage remains owned separately under `acceptance/**`.

## Non-goals

- Changing watch, dispatch, review, seeding, or product-runtime behavior.
- Changing the existing branch or worktree directory naming contract.
- Adding dependencies or redesigning worktree lifecycle management.
- Creating or modifying acceptance tests in the implementation task.
