# agent-adapter spec delta

## ADDED Requirements

### Requirement: Local Codex app-server adapter

The system SHALL provide an `AgentAdapter` that probes and drives a locally installed Codex CLI through `codex app-server` over its native stdio JSON-RPC transport. For every connection it SHALL complete `initialize`/`initialized` before `thread/start`, complete `thread/start` before `turn/start`, use a read-only workspace with no interactive approval, and capture `thread.sessionId` as soon as it is returned.

#### Scenario: Adapter probe reports local availability

- **GIVEN** a machine with the Codex CLI installed
- **WHEN** the adapter's `probe()` is called
- **THEN** it returns `available: true`
- **AND** it returns the installed Codex version as a non-empty string

#### Scenario: Live smoke run uses the real local app-server

- **GIVEN** a locally installed and authenticated Codex CLI and the bundled read-only smoke prompt
- **WHEN** the live adapter smoke command is run without a fixture or fake process
- **THEN** it spawns `codex app-server` and completes the required handshake in order
- **AND** it emits a `session` event whose id equals the returned `thread.sessionId`
- **AND** it emits at least one `text_delta` event from app-server notifications
- **AND** its result resolves with `status: "completed"` and non-empty `finalText`

#### Scenario: Unsupported server request fails closed

- **GIVEN** an app-server connection configured for read-only execution with no interactive approval
- **WHEN** app-server sends a server-initiated request that the Phase 1 adapter does not support
- **THEN** the adapter does not grant the requested permission
- **AND** execution ends with `status: "failed"` and a non-empty failure reason instead of hanging

### Requirement: Stable app-server events normalize to AgentEvent

The adapter SHALL normalize stable app-server notifications into the typed `AgentEvent` union, including session, agent-message text delta, tool-call status, and usage where present. It SHALL take final text from the completed agent-message item and SHALL use `turn/completed` to determine the result status; messages it cannot classify SHALL be emitted as `raw` without being dropped.

#### Scenario: Completed turn yields normalized stream and final text

- **GIVEN** an app-server message sequence containing `thread/started`, `item/agentMessage/delta`, a completed agent-message item, and `turn/completed`
- **WHEN** the adapter normalizes the sequence
- **THEN** the output contains a `session` event and the corresponding ordered `text_delta` events
- **AND** the result status matches the `turn/completed` status
- **AND** `finalText` equals the text in the completed agent-message item

#### Scenario: Unclassifiable notification falls back to raw

- **GIVEN** a valid JSON-RPC notification whose method is not recognized by the adapter
- **WHEN** it is normalized
- **THEN** it is emitted as a `raw` event carrying the original payload
- **AND** normalization does not throw

### Requirement: Table-driven normalization uses real recorded output

Adapter normalization SHALL have a table-driven test whose input fixture is a sanitized recording from a real Codex app-server run. The fixture metadata SHALL record the Codex CLI version and each case SHALL map input JSONL messages to the exact expected `AgentEvent` sequence and `AgentResult`.

#### Scenario: Recorded fixture matches expected normalized output

- **GIVEN** a committed sanitized fixture recorded from a real Codex app-server process and its expected-output table
- **WHEN** every fixture case is passed through normalization
- **THEN** each produced `AgentEvent` sequence exactly equals its expected sequence
- **AND** each produced result exactly equals its expected `AgentResult`
- **AND** the fixture metadata contains a non-empty Codex CLI version

#### Scenario: Fixture contains no recording secrets

- **GIVEN** the committed real-output fixture
- **WHEN** its JSONL payloads are inspected
- **THEN** they contain no access token, authorization header, home-directory path, repository remote URL, or user prompt content beyond the dedicated smoke prompt
