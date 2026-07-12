# run-ui spec delta

## ADDED Requirements

### Requirement: Realtime run read API

The server SHALL expose a loopback HTTP endpoint that starts the bundled workflow and read endpoints for its persisted run snapshot and artifacts. It SHALL expose a WebSocket event stream sourced from persisted `run_events`; a client connecting with its last received `seq` SHALL receive every later persisted event in order before receiving new live events.

#### Scenario: Start endpoint returns a persisted run

- **GIVEN** the server is ready and the bundled example IR is valid
- **WHEN** a client requests a run through the start endpoint
- **THEN** the response identifies a persisted run in `created` or `running` state
- **AND** the run snapshot endpoint returns the bundled IR as `ir_snapshot_json`

#### Scenario: WebSocket streams persisted events in sequence

- **GIVEN** a client subscribed to a newly started run from `seq = 0`
- **WHEN** the run emits lifecycle and agent text events
- **THEN** the client receives each event in strictly increasing `seq` order
- **AND** every received event can be read from SQLite with the same run id, seq, type, and data

#### Scenario: Reconnect catches up without loss or duplication

- **GIVEN** a client that disconnects after acknowledging `seq = K` while its run continues
- **WHEN** it reconnects with `after_seq = K`
- **THEN** the first replayed event has `seq = K + 1` when such an event exists
- **AND** all events through the current persisted maximum are delivered exactly once and in order before live delivery resumes

### Requirement: Electron thin shell owns the server process lifecycle

The Electron app SHALL start the runtime server as a separate Node child process bound only to loopback, wait for an explicit readiness message containing its actual port, and then open the run UI. Closing the app SHALL terminate that child process. Workflow validation, orchestration, adapter execution, and SQLite access SHALL remain outside the Electron main process.

#### Scenario: Desktop launch starts one ready server and one window

- **GIVEN** the built desktop application and no pre-existing runtime server
- **WHEN** the Electron app launches
- **THEN** it starts exactly one runtime server child process bound to a loopback address
- **AND** it waits for the child's readiness message before the run UI makes API requests
- **AND** it opens exactly one application window connected to that reported server origin

#### Scenario: Desktop shutdown terminates its server child

- **GIVEN** a launched Electron app with a live runtime server child process
- **WHEN** the application exits normally
- **THEN** the child process terminates within the configured shutdown grace period
- **AND** its loopback port no longer accepts connections

### Requirement: Read-only React Flow run canvas

Inside the Electron window, the UI SHALL render the bundled IR as a React Flow canvas. Nodes and edges SHALL NOT be addable, deletable, reconnectable, or draggable. Each node SHALL expose its current PRD §10 status as visible text and a stable status-color token; the UI SHALL also display the selected run's incremental agent text and persisted final artifact.

#### Scenario: Canvas structure is read-only

- **GIVEN** the bundled single-agent IR is open in the Electron window
- **WHEN** the user attempts to drag its node, create or reconnect an edge, or delete a graph element
- **THEN** node positions and the IR node/edge sets remain unchanged
- **AND** no mutation request is sent to the server

#### Scenario: Node status color follows persisted state

- **GIVEN** a started single-agent run displayed on the canvas
- **WHEN** its node progresses from `running` to `completed`
- **THEN** the node's visible status text changes from `running` to `completed`
- **AND** its status-color token changes to the token defined for `completed`
- **AND** its machine-readable `data-status` equals `completed`

#### Scenario: Live agent text is displayed incrementally

- **GIVEN** a displayed running node and two persisted `agent_text_delta` events with consecutive seq values
- **WHEN** those events arrive through the WebSocket stream
- **THEN** the text panel displays both deltas in sequence without waiting for run completion
- **AND** each delta appears exactly once

#### Scenario: Final artifact is displayed with provenance

- **GIVEN** a completed run with a persisted `report` artifact
- **WHEN** the run UI receives completion and reads artifacts
- **THEN** it displays the report's complete text
- **AND** it displays the id of the producing workflow node
- **AND** the displayed artifact id, run id, and node-run id match persisted provenance

#### Scenario: Reconnected UI converges to uninterrupted state

- **GIVEN** two clients viewing the same run, one of which disconnects and later reconnects with its last seq
- **WHEN** catch-up completes
- **THEN** both clients show the same node status, accumulated text, and artifact content

### Requirement: Phase 1 UI excludes authoring and later-phase controls

The Phase 1 desktop UI SHALL NOT expose controls for editing or saving the IR, human-gate decisions, retries, recovery, or timeline replay.

#### Scenario: Later-phase controls are absent

- **GIVEN** the Electron run UI is open
- **WHEN** its available controls and accessibility tree are inspected
- **THEN** there is no control that adds, deletes, reconnects, edits, or saves workflow graph content
- **AND** there is no human-gate, retry, recovery, or replay-timeline control
