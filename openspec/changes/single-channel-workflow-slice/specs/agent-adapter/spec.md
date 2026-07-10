# agent-adapter spec delta

## ADDED Requirements

### Requirement: Local Claude Code adapter

The system SHALL provide an AgentAdapter that probes and drives a local Claude Code session over its native headless channel (`claude -p --output-format stream-json --input-format stream-json`), exposing an async event stream of normalized `AgentEvent`s and a result promise, and SHALL capture the session id the first time it appears in the stream.

#### Scenario: Adapter probe reports availability

- **GIVEN** a machine with the Claude Code CLI installed
- **WHEN** the adapter's `probe()` is called
- **THEN** it returns `available: true` with a version string

#### Scenario: Execute streams events and returns a result

- **GIVEN** the adapter is asked to execute a prompt in a read-only workspace
- **WHEN** the session runs to completion
- **THEN** the event stream yields at least one `session` event and one or more `text_delta` events
- **AND** the result promise resolves with `status: "completed"` and a non-empty `finalText`
- **AND** the captured `sessionId` matches the id from the `session` event

### Requirement: Table-driven event normalization from recorded output

Adapter event-stream normalization SHALL be covered by a table-driven test whose fixtures are real recorded Claude Code headless output; each fixture maps to the expected `AgentEvent` sequence, and any line that cannot be classified SHALL be surfaced as a `raw` event rather than dropped or throwing.

#### Scenario: Recorded fixture normalizes to expected events

- **GIVEN** a fixture of recorded Claude Code NDJSON output
- **WHEN** it is fed through the adapter's normalization
- **THEN** the produced `AgentEvent` sequence equals the fixture's expected sequence
- **AND** every discriminated `type` in the output is a valid `AgentEvent` member

#### Scenario: Unclassifiable line falls back to raw

- **GIVEN** a recorded line that matches no known event shape
- **WHEN** it is normalized
- **THEN** it is emitted as a `raw` event carrying the original payload
- **AND** normalization does not throw
