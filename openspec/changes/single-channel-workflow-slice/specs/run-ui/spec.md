# run-ui spec delta

## ADDED Requirements

### Requirement: Read-only run view

The web UI SHALL provide a read-only view of a run that displays each node's current status, the agent's live text stream, and the final artifact, consuming `run_events` over WebSocket with seq-based catch-up on reconnect. The Phase 1 UI SHALL NOT expose canvas editing, human-gate forms, or a replay timeline.

#### Scenario: Node status is visible and reflects state

- **GIVEN** a started run for the single-agent IR
- **WHEN** the run view is opened
- **THEN** the node is rendered with a status indicator
- **AND** the indicator updates from `running` to `completed` as the run progresses

#### Scenario: Live agent text stream is shown

- **GIVEN** a running node whose adapter emits `text_delta` events
- **WHEN** the run view is open
- **THEN** the streamed text appears incrementally in the UI as events arrive

#### Scenario: Final artifact is shown after completion

- **GIVEN** a completed run that produced a `report` artifact
- **WHEN** the run view is open
- **THEN** the final report artifact's content is displayed and attributed to its node

#### Scenario: Reconnect catches up by seq

- **GIVEN** a run view whose WebSocket connection drops and reconnects mid-run
- **WHEN** it reconnects with the last received `seq`
- **THEN** it receives the missed events and the rendered state matches a client that never disconnected
