# orchestration Specification

## Purpose

Define the issue-driven orchestration layer: how the seeder turns a change's tasks into issues and how the dispatcher assigns role-specific contracts to runs.

## Requirements

### Requirement: Test-writer dispatch role

The orchestration dispatcher SHALL support an explicitly selected test-writer role, chosen when the source issue carries a `role:test-writer` label or a `[test-writer]` title marker. A test-writer run SHALL derive its prompt only from the source issue's acceptance criteria and the referenced delta specs, SHALL forbid reading product implementation and existing unit tests, SHALL restrict workspace changes to added `acceptance/**` files, and SHALL run `pnpm typecheck`, `pnpm lint`, and `pnpm acceptance` in its local check loop. Issues without the marker SHALL keep the existing builder contract, including its prohibition on touching `acceptance/**`.

#### Scenario: Marked issue is dispatched under the test-writer contract

- **GIVEN** a ready issue whose title contains `[test-writer]` or that carries the `role:test-writer` label
- **WHEN** the dispatcher runs for that issue
- **THEN** the run's instructions restrict workspace changes to added `acceptance/**` files
- **AND** the instructions forbid reading product implementation files and existing unit tests
- **AND** the local check loop runs `pnpm typecheck`, `pnpm lint`, and `pnpm acceptance`

#### Scenario: Out-of-scope test-writer change fails before a PR opens

- **GIVEN** a test-writer run whose working tree modifies any path outside added `acceptance/**` files
- **WHEN** the local checks for that run execute
- **THEN** the run fails locally
- **AND** no pull request is opened from that state

#### Scenario: Unmarked issues keep the ordinary builder contract

- **GIVEN** a ready issue without the `role:test-writer` label or `[test-writer]` title marker
- **WHEN** the dispatcher runs for that issue
- **THEN** the run uses the existing builder contract
- **AND** creating or modifying `acceptance/**` remains forbidden

### Requirement: Seeder preserves task structure

The issue seeder SHALL create exactly one issue per numbered top-level task in a change's `tasks.md`, SHALL copy each task's indented checklist items into that issue's acceptance-criteria section, and SHALL exclude blockquote lines from issue bodies. This parsing behavior SHALL be covered by a deterministic regression test.

#### Scenario: Numbered tasks with indented criteria seed one issue each

- **GIVEN** a `tasks.md` containing numbered `## N.` task headings, indented `- [ ]` checklist items, and blockquote annotation lines
- **WHEN** the seeder parses it
- **THEN** the parsed task count equals the number of numbered headings
- **AND** every indented checklist item is attributed to its enclosing task
- **AND** no blockquote line appears in any parsed task title or criteria

### Requirement: Proposal pull requests receive advisory review

After the proposer creates a proposal pull request, the watch process SHALL run `review.mjs` in the same concurrency slot before releasing the source issue claim. Unless a reviewer is explicitly selected, the reviewer SHALL differ from the proposer. PASS, CHANGES, and reviewer failure SHALL all be terminal for the proposal: the watch process MUST clear `wip`, release the slot, and MUST NOT revise the proposal automatically. Reviewer failure SHALL retain the existing fail-open advisor status and human handoff behavior. Implementation pull requests SHALL retain their existing single revision and re-review allowance.

#### Scenario: Successful proposal creation starts advisory review

- **GIVEN** a ready source issue whose proposer successfully opens a proposal pull request
- **WHEN** the proposer process exits successfully
- **THEN** watch invokes `review.mjs` for that proposal pull request
- **AND** the proposal remains claimed until the reviewer exits

#### Scenario: Proposal reviewer selection preserves independence and overrides

- **GIVEN** a proposal created by one configured agent
- **WHEN** no reviewer is explicitly selected
- **THEN** watch selects the first configured reviewer different from the proposer
- **AND** an explicit `--reviewer` selection takes precedence when present

#### Scenario: Proposal review outcomes do not trigger automatic revision

- **GIVEN** a proposal advisory review that returns PASS, CHANGES, or a failure exit
- **WHEN** watch handles the reviewer exit
- **THEN** watch clears `wip` and releases the concurrency slot
- **AND** watch does not dispatch a proposal revision
- **AND** reviewer failure leaves `advisor-review` fail-open with a human handoff
- **AND** the implementation pull-request review path retains its existing one-revision limit
