# workflow-ir spec delta

## ADDED Requirements

### Requirement: Canonical IR schema validation (L1)

The system SHALL validate a workflow IR against a zod schema for `agent.workflow/v1`, rejecting unknown fields, and SHALL ship a hardcoded single-agent, acyclic Cross-Agent Review example IR that passes L1 validation.

#### Scenario: Bundled single-agent example passes L1

- **GIVEN** the bundled single-agent Cross-Agent Review example IR
- **WHEN** L1 schema validation runs on it
- **THEN** validation succeeds with zero errors

#### Scenario: Unknown field is rejected

- **GIVEN** an IR that adds a field not defined by the `agent.workflow/v1` schema
- **WHEN** L1 schema validation runs
- **THEN** validation fails
- **AND** the returned error list is non-empty

### Requirement: Graph-semantic validation (L2)

The system SHALL validate IR graph semantics: node ids are unique, every edge endpoint references an existing node, no node is unreachable, template references (`{{nodes.<id>.artifacts.<name>}}`) resolve to an upstream node's declared `output_artifacts`, and every referenced `agent` exists with capabilities that satisfy the node's requirements.

#### Scenario: Bundled single-agent example passes L2

- **GIVEN** the bundled single-agent Cross-Agent Review example IR
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation succeeds with zero errors

#### Scenario: Edge to a missing node fails L2

- **GIVEN** an otherwise valid IR whose edge targets a node id that does not exist
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails
- **AND** at least one error identifies the offending edge

#### Scenario: Unresolvable template reference fails L2

- **GIVEN** an IR whose node prompt references `{{nodes.<id>.artifacts.<name>}}` for an artifact not declared in any upstream node's `output_artifacts`
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails with an error identifying the offending node

### Requirement: Structured validation errors

Validation SHALL return a structured list in which each error carries a `code` and a human-readable `message`, and carries a `node` and/or `edge` locator when the error is attributable to one.

#### Scenario: Malformed IR yields structured errors

- **GIVEN** an IR with a dangling edge and an unknown field
- **WHEN** validation runs
- **THEN** the result is a list of error objects
- **AND** each object has `code` and `message` fields
- **AND** the dangling-edge error carries an `edge` locator and the schema error carries a `node` or field locator
