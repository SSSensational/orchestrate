# run-execution spec delta

## ADDED Requirements

### Requirement: Run and node state machine

Starting a run SHALL freeze the IR snapshot and advance `workflow_run` and `workflow_node_run` through the PRD §10 states — run: `created → running → completed` (or `failed`); agent.run node: `pending → ready → running → completed` (or `failed`) — persisting each transition.

#### Scenario: Single-agent run reaches completion

- **GIVEN** the bundled single-agent Cross-Agent Review IR and an available adapter
- **WHEN** a run is started and allowed to finish
- **THEN** the node passes through `ready`, `running`, and `completed` in order
- **AND** the run ends in `completed`
- **AND** the run's `ir_snapshot_json` equals the IR it was started with

#### Scenario: Adapter failure fails the node and run

- **GIVEN** a run whose single node's adapter execution ends with `status: "failed"`
- **WHEN** the run is stepped to termination
- **THEN** the node ends in `failed`
- **AND** the run ends in `failed` with a populated `error_json`

### Requirement: Append-only event log persisted to SQLite

Run execution SHALL persist `run_events` to SQLite append-only, with a strictly increasing per-run `seq` starting at 1 and no gaps, covering at least run lifecycle (`run_started` / `run_completed` or `run_failed`), node lifecycle (`node_ready` / `node_started` / `node_completed`), `session_captured`, and sampled `agent_text_delta` events.

#### Scenario: Events are contiguous and append-only

- **GIVEN** a completed run
- **WHEN** its `run_events` rows are read ordered by `seq`
- **THEN** the `seq` values are `1, 2, 3, …` with no gaps or duplicates
- **AND** the sequence contains `run_started`, `node_started`, `node_completed`, and `run_completed` in a causally valid order
- **AND** no previously written row's `data_json` has been mutated

### Requirement: Final-text artifact fallback traceable to node

When an `agent.run` node completes, its adapter `finalText` SHALL be persisted as a `report` artifact whose `node_run_id` references the producing node run and whose `run_id` references the run.

#### Scenario: Completed node produces a traceable report artifact

- **GIVEN** a completed single-agent run whose adapter returned non-empty `finalText`
- **WHEN** the `artifacts` table is read
- **THEN** there is a row of `type = "report"` whose `data_json` contains the final text
- **AND** its `node_run_id` matches the node run for the agent.run node
- **AND** its `run_id` matches the run
