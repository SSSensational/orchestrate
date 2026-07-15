# workflow-ir Specification

## Purpose

Define the `agent.workflow/v1` intermediate representation: its strict L1 zod schema, L2 graph-semantic validation, and the structured error shape shared by both layers.

## Requirements

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

### Requirement: Workflow identifier grammar

Every node `id`, edge `from` and `to`, and output-artifact name SHALL match `^[A-Za-z0-9_-]+$`. The node-id and artifact-name segments in `{{nodes.<id>.artifacts.<name>}}` SHALL use the same grammar.

#### Scenario: Allowed identifiers pass both validation layers

- **GIVEN** a producer id `producer_v2`, a consumer id `consumer-2`, and an output artifact `report-v1`
- **AND** the consumer references `{{nodes.producer_v2.artifacts.report-v1}}` across an edge from the producer
- **WHEN** L1 and then L2 validation run
- **THEN** both layers succeed with zero errors

#### Scenario: Dotted declarations fail L1 with their locator

- **GIVEN** otherwise valid IR values with a dotted node id, edge endpoint, or output-artifact name
- **WHEN** L1 validation runs
- **THEN** every dotted identifier is rejected
- **AND** a node or artifact error locates its declaring node
- **AND** an endpoint error locates its exact edge

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

### Requirement: Agent registry membership uses own properties

L2 SHALL treat an agent id as registered only when the supplied registry has an own property for that exact id. An inherited property MUST NOT satisfy registration, while an own property whose value supplies the required capabilities SHALL remain valid even when its name collides with an object-prototype property.

#### Scenario: Inherited registry entry is rejected

- **GIVEN** an otherwise valid node whose agent id exists only on the registry's custom prototype
- **WHEN** L2 validation runs
- **THEN** validation fails with an unregistered-agent error located to that node

#### Scenario: Own prototype-colliding entry is accepted

- **GIVEN** an otherwise valid node whose agent id is `toString`
- **AND** the registry has its own `toString` property containing satisfying capabilities
- **WHEN** L2 validation runs
- **THEN** validation succeeds with zero errors

### Requirement: Node-artifact template candidates have strict syntax

L2 SHALL inspect every literal `{{nodes.` occurrence in prompt order. Each candidate MUST terminate at the next `}}` and exactly match `{{nodes.<id>.artifacts.<name>}}` using the workflow identifier grammar. A malformed or unterminated candidate SHALL produce a distinct syntax-category error located to the referencing node and containing the exact candidate; a well-formed candidate SHALL continue through transitive-upstream artifact resolution.

#### Scenario: Dotted template segment fails syntax validation

- **GIVEN** an L1-valid IR whose consumer prompt contains a dotted node-id or artifact-name segment in a node-artifact candidate
- **WHEN** L2 validation runs
- **THEN** validation fails with a syntax-category error located to the consumer
- **AND** the error message contains the exact malformed candidate

#### Scenario: Unterminated template candidate fails syntax validation

- **GIVEN** an L1-valid IR whose consumer prompt ends with `{{nodes.producer.artifacts.report`
- **WHEN** L2 validation runs
- **THEN** validation fails with a syntax-category error located to the consumer
- **AND** the error message contains the exact unterminated candidate

### Requirement: Phase 1 workflows are acyclic

Every Phase 1 workflow graph SHALL be acyclic. L2 MUST reject a cycle reachable from a root with a cycle-category error located to the deterministic back edge selected by node and edge declaration order. A cycle whose members are all unreachable from every root SHALL continue to fail only through the existing node-located unreachable diagnostics.

#### Scenario: Root-reachable cycle is rejected

- **GIVEN** nodes `root`, `a`, and `b` with edges `root -> a`, `a -> b`, and `b -> a`
- **WHEN** L2 validation runs
- **THEN** validation fails with a cycle-category error located to edge `b -> a`

#### Scenario: Root-reachable self-loop is rejected

- **GIVEN** a reachable node `a` with an edge `a -> a`
- **WHEN** L2 validation runs
- **THEN** validation fails with a cycle-category error located to edge `a -> a`

#### Scenario: Disconnected cycle retains unreachable diagnostics

- **GIVEN** a valid root plus a disconnected node `orphan` with an edge `orphan -> orphan`
- **WHEN** L2 validation runs
- **THEN** validation fails with the existing unreachable error located to `orphan`
- **AND** no cycle-category error is returned for the disconnected self-loop

### Requirement: Structured validation errors

Every validation failure SHALL return an ordered list of error objects with exactly the public locator fields `node` and `edge` plus non-empty string fields `code` and `message`. `node` and `edge` SHALL be nullable; an error attributable to a node or edge SHALL populate the applicable locator, and document-level errors SHALL set both locators to null.

#### Scenario: L1 failure yields consistently shaped errors

- **GIVEN** an IR with an unknown field on a node
- **WHEN** L1 schema validation runs
- **THEN** the result is a non-empty ordered list of error objects
- **AND** every error object contains the keys `node`, `edge`, `code`, and `message`
- **AND** every `code` and `message` is a non-empty string
- **AND** the unknown-field error has a non-null `node`

#### Scenario: L2 failure yields consistently shaped errors

- **GIVEN** an IR that passes L1 schema validation and whose edge target references a missing node id
- **WHEN** L2 graph-semantic validation runs
- **THEN** the result is a non-empty ordered list of error objects
- **AND** every error object contains the keys `node`, `edge`, `code`, and `message`
- **AND** every `code` and `message` is a non-empty string
- **AND** the dangling-edge error has a non-null `edge`

#### Scenario: Repeated validation is deterministic

- **GIVEN** the same invalid IR and the same agent registry
- **WHEN** validation is run twice
- **THEN** both runs return deeply equal error lists in the same order

### Requirement: Independent M2 L1 acceptance coverage

The repository SHALL contain independently authored black-box acceptance tests for the #24 L1 contract. Every test derived from this requirement MUST include `#24` in its full test title and MUST assert the public result without relying on product implementation files or builder unit tests.

#### Scenario: #24 bundled example passes L1 unchanged

- **GIVEN** the repository's bundled single-agent Cross-Agent Review example IR
- **WHEN** the acceptance test validates that unmodified value with L1
- **THEN** validation succeeds with zero errors
- **AND** the validated value is deeply structurally equal to the input value
- **AND** the full Vitest test title contains `#24`

#### Scenario: #24 unknown node field is rejected by L1

- **GIVEN** a deep copy of the bundled example IR with exactly one unknown field added to a known agent node
- **WHEN** the acceptance test validates that value with L1
- **THEN** validation fails with a non-empty ordered error list
- **AND** at least one error has a non-null `node` equal to the modified node's id
- **AND** that error has non-empty string `code` and `message` values
- **AND** the full Vitest test title contains `#24`

#### Scenario: #24 L1 errors expose the exact public shape

- **GIVEN** a deep copy of the bundled example IR with exactly one unknown field added to a known agent node
- **WHEN** the acceptance test validates that value with L1
- **THEN** every returned error object's complete key set is exactly `node`, `edge`, `code`, and `message`
- **AND** every `node` and `edge` value is either null or a non-empty string
- **AND** every `code` and `message` value is a non-empty string
- **AND** the error for the unknown field has `node` equal to the modified node's id and `edge` equal to null
- **AND** the full Vitest test title contains `#24`

### Requirement: Independent M3 L2 acceptance coverage

The repository SHALL contain independently authored black-box acceptance tests for the #25 L2 graph-semantic contract. Every test derived from this requirement MUST include `#25` in its full test title. Each failure test MUST validate the identical IR and registry twice, MUST receive deeply equal error lists, and MUST assert a non-empty public error code plus the applicable locator. Tests for an unresolved template, missing agent, or missing capability MUST also assert that the message contains the exact offending value. Error codes MUST identify their failure category: the codes observed for different L2 failure categories MUST be pairwise distinct and repeat-stable, while literal code spellings remain unspecified.

#### Scenario: #25 bundled example and Codex registry pass L2

- **GIVEN** the bundled single-agent Cross-Agent Review example IR and a registry containing the Codex agent and all capabilities required by its node
- **WHEN** the acceptance test validates the IR with L2
- **THEN** validation succeeds with zero errors
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 duplicate node id is rejected

- **GIVEN** an otherwise L1-valid IR containing two nodes with the same non-empty id
- **WHEN** the acceptance test validates the identical IR and registry twice with L2
- **THEN** both runs fail with deeply equal non-empty ordered error lists
- **AND** at least one error has `node` equal to the duplicated id, `edge` equal to null, and a non-empty string `code`
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 dangling edge endpoint is rejected with structured errors

- **GIVEN** an otherwise L1-valid IR with one edge whose target is the non-existent node id `missing-target`
- **WHEN** the acceptance test validates the identical IR and registry twice with L2
- **THEN** both runs fail with deeply equal non-empty ordered error lists
- **AND** at least one error has `node` equal to null, a non-empty string `code`, and an `edge` deeply equal to the offending edge's exact `from`/`to` pair
- **AND** every returned error object's complete key set is exactly `node`, `edge`, `code`, and `message`
- **AND** every returned `code` and `message` is a non-empty string
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 unreachable node is rejected

- **GIVEN** an otherwise L1-valid IR with one node whose non-empty id is `unreachable` and for which no path exists from any declared root
- **WHEN** the acceptance test validates the identical IR and registry twice with L2
- **THEN** both runs fail with deeply equal non-empty ordered error lists
- **AND** at least one error has `node` equal to `unreachable`, `edge` equal to null, and a non-empty string `code`
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 unresolved upstream artifact template is rejected

- **GIVEN** an otherwise L1-valid IR whose consumer node prompt contains `{{nodes.producer.artifacts.missing-report}}`, where `producer` is transitively upstream but does not declare `missing-report` in `output_artifacts`
- **WHEN** the acceptance test validates the identical IR and registry twice with L2
- **THEN** both runs fail with deeply equal non-empty ordered error lists
- **AND** at least one error has `node` equal to the consumer node's id, `edge` equal to null, and a non-empty string `code`
- **AND** that error's message contains the exact reference `{{nodes.producer.artifacts.missing-report}}`
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 missing agent is rejected

- **GIVEN** an otherwise L1-valid IR with one node referencing the agent id `unregistered-agent` and a registry with no own entry for that id
- **WHEN** the acceptance test validates the identical IR and registry twice with L2
- **THEN** both runs fail with deeply equal non-empty ordered error lists
- **AND** at least one error has `node` equal to that node's id, `edge` equal to null, and a non-empty string `code`
- **AND** that error's message contains the exact agent id `unregistered-agent`
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 missing agent capability is rejected

- **GIVEN** an otherwise L1-valid IR with one node requiring the schema-legal capability `fork` from its registered agent, whose declared capabilities set `fork` to false
- **WHEN** the acceptance test validates the identical IR and registry twice with L2
- **THEN** both runs fail with deeply equal non-empty ordered error lists
- **AND** at least one error has `node` equal to that node's id, `edge` equal to null, and a non-empty string `code`
- **AND** that error's message contains the exact capability `fork`
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 transitive upstream artifact reference resolves

- **GIVEN** an L1-valid three-node chain `producer -> relay -> consumer`, where `producer` declares `report` in `output_artifacts` and `consumer` references `{{nodes.producer.artifacts.report}}` in its prompt
- **AND** the registry contains every referenced agent with every capability required by the three nodes
- **WHEN** the acceptance test validates the IR with L2
- **THEN** validation succeeds with zero errors even though `producer` is not the direct predecessor of `consumer`
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 repeated L2 validation is deterministic

- **GIVEN** one L1-valid IR whose edge targets the non-existent id `missing-target` and whose reachable node requires the schema-legal capability `fork` from a registered agent that declares `fork` as false, plus one unchanged agent registry
- **WHEN** the acceptance test validates the same IR and registry twice with L2
- **THEN** each run returns an ordered list containing at least the dangling-edge and missing-capability errors
- **AND** the two complete error lists are deeply equal, including list order and every `node`, `edge`, `code`, and `message` value
- **AND** the full Vitest test title contains `#25`

#### Scenario: #25 distinct failure categories yield distinct stable codes

- **GIVEN** six otherwise L1-valid IR/registry fixtures, each exhibiting exactly one L2 failure category: duplicate id, dangling edge, unreachable node, unresolved template, missing agent, and missing capability
- **WHEN** the acceptance test validates each fixture twice with L2
- **THEN** every category yields at least one error whose `code` is a non-empty string
- **AND** the codes observed for the six categories are pairwise distinct
- **AND** each category's observed codes are identical across both runs
- **AND** no assertion fixes a literal code spelling
- **AND** the full Vitest test title contains `#25`

### Requirement: Acceptance-suite runner isolation and pure-test scope

The workflow-ir acceptance suite MUST be stored only in newly added `acceptance/**` files. Existing product, test, configuration, documentation, dependency, and OpenSpec files MUST remain unchanged in its implementation PR; the normal test command MUST exclude the suite, and the acceptance command MUST collect and execute all of it.

#### Scenario: #24/#25 suite is excluded from the normal test command

- **GIVEN** all new workflow-ir acceptance files and their issue-tagged test titles are present under `acceptance/**`
- **WHEN** `pnpm test` runs from the repository root
- **THEN** the command exits successfully
- **AND** no new acceptance file or issue-tagged acceptance test title is collected or executed

#### Scenario: #24/#25 suite is collected by the acceptance command

- **GIVEN** all new workflow-ir acceptance files and their issue-tagged test titles are present under `acceptance/**`
- **WHEN** `pnpm acceptance` runs from the repository root
- **THEN** every new acceptance file and every test derived from this delta is collected and executed
- **AND** the command exits successfully when the workflow-ir contract conforms

#### Scenario: #24/#25 implementation diff is a pure test addition

- **GIVEN** the implementation branch is compared with its base commit
- **WHEN** the changed-path set and change status are inspected
- **THEN** every changed path is below `acceptance/**`
- **AND** every changed path has added status
- **AND** the repository's pure-test `test-guard` check passes
