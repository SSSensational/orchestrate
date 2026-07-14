## 1. Fix successful output from the issue worktree helper

- [ ] Change only `scripts/worktree.sh`; do not modify `scripts/watch.mjs`, `scripts/dispatch.mjs`, product code, existing tests, or `acceptance/**`.
- [ ] In an isolated temporary Git repository with an initial commit, `scripts/worktree.sh 48` exits 0 and creates `../<repository-name>-issue-48` on branch `issue/48`.
- [ ] Captured stdout reports `worktree 就绪：../<repository-name>-issue-48（分支 issue/48）`, includes `cd ../<repository-name>-issue-48 && codex`, and includes `git worktree remove ../<repository-name>-issue-48`.
- [ ] Captured stderr contains no `unbound variable` diagnostic, and the temporary worktree can be removed with the printed cleanup command.
