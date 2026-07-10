# Local Agent Workflow Specification

## Purpose

Define the repository's local builder/reviewer orchestration, including stable AI GitHub identity and the bounded advisory-review repair loop.

## Requirements

### Requirement: AI GitHub writes use a stable bot identity

The local orchestration scripts SHALL require `AGENT_GH_TOKEN` for every AI-authored GitHub write and SHALL NOT fall back to the operator's active `gh` login.

#### Scenario: Bot token is missing

- **GIVEN** `AGENT_GH_TOKEN` is unset
- **WHEN** an AI-authored GitHub write is attempted through `ghAgent()`
- **THEN** the operation fails before invoking `gh`
- **AND** the error identifies the missing `AGENT_GH_TOKEN`

#### Scenario: Bot token is present

- **GIVEN** `AGENT_GH_TOKEN` is set
- **WHEN** an AI-authored GitHub write is attempted through `ghAgent()`
- **THEN** the child `gh` process receives that value as `GH_TOKEN`
- **AND** the operator's stored `gh` identity is not used for the write

### Requirement: Advisory reviewer selection prefers a different agent

When no reviewer is explicitly selected, the workflow SHALL choose the first registered agent different from the PR's builder. An explicit reviewer parameter or `agent:review:<name>` label SHALL take precedence over this default.

#### Scenario: Reviewer is not specified

- **GIVEN** a PR built by a registered agent
- **AND** no reviewer parameter or reviewer label is present
- **WHEN** advisory review starts
- **THEN** the reviewer is the first registered agent whose name differs from the builder

#### Scenario: Reviewer is explicitly specified

- **GIVEN** a reviewer parameter or `agent:review:<name>` label is present
- **WHEN** advisory review starts
- **THEN** the explicitly selected reviewer is used

### Requirement: Advisory review repair is bounded to one round

The advisory review SHALL remain outside the required checks. A first `PASS` SHALL stop automation and wait for human review. A first `CHANGES` SHALL return the complete advisory comment to the original builder in the same issue worktree and PR for at most one repair, rerun the existing deterministic checks, push the repair, and run at most one more advisory review. A second `CHANGES` or reviewer failure SHALL stop the automatic loop and leave final disposition to a human.

#### Scenario: First review passes

- **GIVEN** the implementation PR has completed its deterministic checks
- **WHEN** the first advisory reviewer returns `PASS`
- **THEN** no repair is started
- **AND** the PR waits for human final review

#### Scenario: First review requests changes

- **GIVEN** the first advisory reviewer returns `CHANGES` with a comment body
- **WHEN** the workflow handles the verdict
- **THEN** the original builder receives the complete comment in the existing issue worktree
- **AND** the builder updates the same PR at most once
- **AND** the existing deterministic checks run before the repaired branch is pushed and reviewed again

#### Scenario: Second review still requests changes

- **GIVEN** the original builder has completed the single advisory repair
- **WHEN** the second advisory reviewer returns `CHANGES`
- **THEN** the workflow performs no further automatic repair or review
- **AND** the PR waits for human final review

#### Scenario: Reviewer fails

- **GIVEN** the implementation PR exists
- **WHEN** the advisory reviewer exits without a valid verdict
- **THEN** the reviewer failure does not become a required gate
- **AND** the PR remains available for human final review

### Requirement: Review policy has offline deterministic coverage

The bot-identity and bounded-review decisions SHALL be covered by repeatable tests that require neither network access nor a live agent CLI.

#### Scenario: Policy tests run offline

- **GIVEN** no GitHub network access and no local agent session
- **WHEN** the review-policy tests run
- **THEN** they deterministically cover `PASS`, first `CHANGES`, second `CHANGES`, reviewer selection, and missing `AGENT_GH_TOKEN`
