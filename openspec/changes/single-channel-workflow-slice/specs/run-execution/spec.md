# run-execution spec delta

## ADDED Requirements

### Requirement: SQLite run persistence

The runtime SHALL persist workflow definitions, workflow runs, workflow node runs, agent tasks, artifacts, and run events in the six SQLite tables defined by PRD §11, with foreign-key enforcement enabled. Starting a run SHALL persist an immutable `ir_snapshot_json` before any node executes.

#### Scenario: Fresh database contains the Phase 1 schema

- **GIVEN** an empty database file
- **WHEN** the runtime store initializes it
- **THEN** tables named `workflow_definitions`, `workflow_runs`, `workflow_node_runs`, `agent_tasks`, `artifacts`, and `run_events` exist
- **AND** SQLite foreign-key enforcement is enabled for the connection

#### Scenario: Run freezes its input IR

- **GIVEN** a valid IR and an initialized store
- **WHEN** a run is created and the caller later mutates its in-memory IR object
- **THEN** the stored `ir_snapshot_json` remains structurally equal to the IR supplied at run creation
- **AND** no node execution starts before that snapshot is committed

### Requirement: Run and node state machines

The orchestrator SHALL enforce and persist the PRD §10 Phase 1 transitions. A run SHALL transition `created → running → completed | failed`; an `agent.run` node SHALL transition `pending → ready → running → completed | failed`; and an agent task SHALL transition `running → completed | failed | cancelled | timeout`. An invalid transition SHALL be rejected without changing persisted state.

#### Scenario: Single-agent run reaches completion

- **GIVEN** the bundled single-agent Cross-Agent Review IR and an adapter that completes successfully
- **WHEN** a run is started and allowed to finish
- **THEN** its node passes through `pending`, `ready`, `running`, and `completed` in order
- **AND** its agent task passes from `running` to `completed`
- **AND** the run passes through `created`, `running`, and `completed` in order

#### Scenario: Adapter failure fails node and run

- **GIVEN** a running single-agent node whose adapter result is `status: "failed"` with a failure reason
- **WHEN** the orchestrator handles that result
- **THEN** the agent task and node end in `failed`
- **AND** the run ends in `failed`
- **AND** persisted error data contains the adapter failure reason

#### Scenario: Invalid state transition is rejected

- **GIVEN** a persisted node in `pending`
- **WHEN** a caller attempts to transition it directly to `completed`
- **THEN** the operation returns a structured state-transition error
- **AND** the persisted node remains `pending`
- **AND** no completion event is appended

### Requirement: Append-only event log with contiguous per-run sequence

Every persisted run or node transition and every normalized session/text lifecycle observation SHALL append a `run_events` row in the same transaction as its associated state change. For each run, `seq` SHALL start at 1 and increase by exactly 1 without duplicates or gaps. SQLite SHALL reject UPDATE and DELETE operations against existing `run_events` rows.

#### Scenario: Completed run has contiguous causal events

- **GIVEN** a completed single-agent run
- **WHEN** its `run_events` rows are read ordered by `seq`
- **THEN** their sequence values are exactly `1, 2, 3, …, N`
- **AND** they include run-started, node-ready, node-started, session-captured, agent-text-delta, node-completed, and run-completed events in causal order
- **AND** every event's persisted run/node state is consistent with that event

#### Scenario: Existing event cannot be updated or deleted

- **GIVEN** a persisted `run_events` row
- **WHEN** any store path or direct SQL statement attempts to update or delete that row
- **THEN** SQLite rejects the statement
- **AND** rereading the row returns its original values

#### Scenario: Separate runs have independent sequences

- **GIVEN** two runs whose events are interleaved in wall-clock time
- **WHEN** events for each run are read independently
- **THEN** each run's first event has `seq = 1`
- **AND** each run has its own contiguous sequence with no cross-run ordering requirement

### Requirement: Final-text fallback creates a traceable artifact

When a successful `agent.run` result contains non-empty `finalText`, the orchestrator SHALL persist that text as a `report` artifact before completing the node. The artifact SHALL reference both the producing `workflow_node_run` and its `workflow_run`, and an `artifact_emitted` event SHALL identify the artifact.

#### Scenario: Completed node produces a traceable report

- **GIVEN** a single-agent run whose adapter completes with non-empty `finalText`
- **WHEN** the orchestrator commits node completion
- **THEN** exactly one `report` artifact contains that final text
- **AND** its `node_run_id` identifies the producing node run
- **AND** its `run_id` identifies the containing run
- **AND** `artifact_emitted` precedes `node_completed` in that run's event sequence
