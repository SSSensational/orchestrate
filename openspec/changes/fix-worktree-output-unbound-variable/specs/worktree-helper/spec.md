## ADDED Requirements

### Requirement: Issue worktree naming contract

The local worktree helper SHALL create a new Git branch named `issue/<n>` and attach it to a worktree at `../<repository-name>-issue-<n>`, where `<n>` is the issue-number argument and `<repository-name>` is the basename of the invocation directory.

#### Scenario: Helper creates the contracted branch and directory

- **GIVEN** an isolated temporary Git repository named `fixture-repo` with an initial commit, no `issue/48` branch, and no sibling `fixture-repo-issue-48` directory
- **WHEN** `scripts/worktree.sh 48` is invoked with `fixture-repo` as the working directory
- **THEN** a Git worktree exists at `../fixture-repo-issue-48`
- **AND** that worktree's checked-out branch is `issue/48`

### Requirement: Successful worktree result reporting

After Git successfully creates the requested worktree, the local worktree helper SHALL exit with status 0 and SHALL print the relative worktree path and branch name, an agent launch example that changes to that path, and a cleanup command that removes that path. The output stage MUST NOT evaluate text adjacent to the path variable as another variable.

#### Scenario: Successful invocation reports usable follow-up commands

- **GIVEN** an isolated temporary Git repository named `fixture-repo` with an initial commit, no `issue/48` branch, and no sibling `fixture-repo-issue-48` directory
- **WHEN** `scripts/worktree.sh 48` is invoked with `fixture-repo` as the working directory and stdout and stderr are captured
- **THEN** the process exits with status 0
- **AND** stdout contains `worktree 就绪：../fixture-repo-issue-48（分支 issue/48）`
- **AND** stdout contains `cd ../fixture-repo-issue-48 && codex`
- **AND** stdout contains `git worktree remove ../fixture-repo-issue-48`
- **AND** stderr does not contain `unbound variable`
