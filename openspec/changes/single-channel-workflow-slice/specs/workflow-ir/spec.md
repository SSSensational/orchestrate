# workflow-ir spec delta

## ADDED Requirements

### Requirement: Canonical IR schema validation (L1)

The system SHALL define a strict zod schema and inferred TypeScript types for `agent.workflow/v1`. L1 validation SHALL reject unknown fields, and the repository SHALL include a hardcoded, single-agent, acyclic Cross-Agent Review example IR that passes the schema without coercion.

#### Scenario: Bundled single-agent example passes L1

- **GIVEN** the bundled single-agent Cross-Agent Review example IR loaded from the repository
- **WHEN** L1 schema validation runs
- **THEN** validation succeeds with zero errors
- **AND** the validated value is structurally equal to the input value

#### Scenario: Unknown field is rejected

- **GIVEN** a copy of the bundled IR with one unknown field added to an agent node
- **WHEN** L1 schema validation runs
- **THEN** validation fails
- **AND** at least one returned error has a non-empty code and message and locates that node

### Requirement: Graph-semantic validation (L2)

The system SHALL validate Phase 1 graph semantics after L1 succeeds: node ids are unique; every edge endpoint references an existing node; every node is reachable from a root; template references of the form `{{nodes.<id>.artifacts.<name>}}` resolve to a transitively upstream node's declared `output_artifacts`; and every referenced agent exists with capabilities satisfying the node requirements.

#### Scenario: Bundled single-agent example passes L2

- **GIVEN** the bundled single-agent Cross-Agent Review example IR and a registry containing its Codex agent definition
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation succeeds with zero errors

#### Scenario: Duplicate node id fails L2

- **GIVEN** an otherwise valid IR containing two nodes with the same id
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails
- **AND** at least one error has a non-null `node` locator for the duplicated id
- **AND** the error code identifies a duplicate node id

#### Scenario: Edge to a missing node fails L2

- **GIVEN** an otherwise valid IR whose edge target references a missing node id
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails
- **AND** at least one error has a non-null `edge` locator for that exact edge
- **AND** the error code identifies a missing edge endpoint

#### Scenario: Unreachable node fails L2

- **GIVEN** an otherwise valid IR with one node that has no path from any root node
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails
- **AND** at least one error has a non-null `node` locator for the unreachable node

#### Scenario: Unresolvable template reference fails L2

- **GIVEN** an IR whose node prompt references an artifact not declared by a transitively upstream node
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails
- **AND** at least one error locates the referencing node and identifies the unresolved reference in its message

#### Scenario: Missing agent capability fails L2

- **GIVEN** an otherwise valid IR whose node requires a capability absent from its registered agent
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails
- **AND** at least one error locates that node and identifies the missing capability

### Requirement: Structured validation errors

Every validation failure SHALL return an ordered list of error objects with exactly the public locator fields `node` and `edge` plus non-empty string fields `code` and `message`. `node` and `edge` SHALL be nullable; an error attributable to a node or edge SHALL populate the applicable locator, and document-level errors SHALL set both locators to null.

#### Scenario: Mixed invalid IR yields consistently shaped errors

- **GIVEN** an IR with an unknown field on a node and an edge targeting a missing node
- **WHEN** validation runs
- **THEN** the result is a non-empty ordered list of error objects
- **AND** every error object contains the keys `node`, `edge`, `code`, and `message`
- **AND** every `code` and `message` is a non-empty string
- **AND** the unknown-field error has a non-null `node`
- **AND** the dangling-edge error has a non-null `edge`

#### Scenario: Repeated validation is deterministic

- **GIVEN** the same invalid IR and the same agent registry
- **WHEN** validation is run twice
- **THEN** both runs return deeply equal error lists in the same order
