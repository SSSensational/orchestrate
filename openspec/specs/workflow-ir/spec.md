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

### Requirement: Workflow identifiers and node-artifact templates share one grammar

The identifier grammar for every node `id`, edge `from` and `to`, output-artifact name, and the `<id>` and `<name>` segments of `{{nodes.<id>.artifacts.<name>}}` SHALL be `^[A-Za-z0-9_-]+$`. L1 SHALL reject any declared identifier or edge endpoint outside this grammar. In every agent prompt, each literal `{{nodes.` occurrence MUST terminate at the next `}}` and MUST exactly match `{{nodes.<id>.artifacts.<name>}}` with both segments conforming to the grammar. L2 SHALL reject a malformed or unterminated candidate with a distinct syntax-category error that locates the referencing node and includes the exact candidate; every well-formed candidate SHALL be processed by the existing transitive-upstream artifact-resolution rule.

#### Scenario: #46 Allowed underscore and hyphen identifiers resolve end to end

- **GIVEN** a two-node IR with producer id `producer_v2`, consumer id `consumer-2`, an edge from `producer_v2` to `consumer-2`, and producer output artifact `report-v1`
- **AND** the consumer prompt contains `{{nodes.producer_v2.artifacts.report-v1}}`
- **AND** the registry has satisfying own entries for both nodes' agents
- **WHEN** L1 validation runs and its successful output is then validated by L2
- **THEN** both layers succeed with zero errors

#### Scenario: #46 Dotted declared identifiers fail L1

- **GIVEN** three independently validated IR values that respectively use `producer.v2` as a node id, `producer.v2` as an edge endpoint, and `report.v1` as an output-artifact name
- **WHEN** each value is validated twice by L1
- **THEN** every run fails with a deeply equal non-empty ordered error list for its matching input
- **AND** the invalid node id and artifact name errors locate their declaring nodes
- **AND** the invalid edge-endpoint error locates the exact offending edge

#### Scenario: #46 Dotted node or artifact template segment fails L2 syntax validation

- **GIVEN** two L1-valid acyclic IR values whose consumer prompts respectively contain `{{nodes.producer.v2.artifacts.report}}` and `{{nodes.producer.artifacts.report.v1}}`
- **WHEN** each IR is validated twice by L2 with satisfying own registry entries
- **THEN** every run fails with a deeply equal non-empty ordered error list for its matching input
- **AND** each IR has a syntax-category error whose `node` is the consumer id and whose `edge` is null
- **AND** each syntax error message contains its exact malformed template candidate

#### Scenario: #46 Unterminated node-artifact candidate fails L2 syntax validation

- **GIVEN** an L1-valid acyclic IR whose consumer prompt ends with `{{nodes.producer.artifacts.report` and whose registry entries are satisfying and own
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails with a syntax-category error located to the consumer node
- **AND** the error message contains the exact unterminated candidate `{{nodes.producer.artifacts.report`

#### Scenario: #46 Well-formed but unresolved reference is not skipped

- **GIVEN** an L1-valid edge `producer_v2 -> consumer` where `producer_v2` declares only `report` and the consumer prompt contains `{{nodes.producer_v2.artifacts.missing-report}}`
- **AND** the registry has satisfying own entries for both nodes' agents
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails with an unresolved-template error located to `consumer`
- **AND** the error message contains the exact reference `{{nodes.producer_v2.artifacts.missing-report}}`

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

L2 SHALL treat an agent id as registered only when the supplied registry has an own property for that exact id. A property inherited from `Object.prototype` or any custom prototype MUST NOT satisfy registration. An own property whose value supplies the required capabilities SHALL continue through the existing capability validation.

#### Scenario: #46 Object prototype name is not a registered agent

- **GIVEN** an otherwise valid single-node IR whose node id is `review`, whose agent id is `toString`, and whose required-capability list is empty
- **AND** the agent registry is an ordinary empty object with no own `toString` property
- **WHEN** L2 validates the identical IR and registry twice
- **THEN** both runs fail with deeply equal ordered error lists
- **AND** at least one error has `node` equal to `review`, `edge` equal to null, and a code identifying an unregistered agent
- **AND** that error's message contains the exact agent id `toString`

#### Scenario: #46 Custom prototype entry is not a registered agent

- **GIVEN** an otherwise valid single-node IR whose node id is `review`, whose agent id is `prototype-agent`, and whose required-capability list is empty
- **AND** the registry inherits a complete capability object for `prototype-agent` but has no own property for that id
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails with an unregistered-agent error located to node `review`
- **AND** the error message contains the exact agent id `prototype-agent`

#### Scenario: #46 Own property with a prototype-colliding name is accepted

- **GIVEN** an otherwise valid single-node IR whose agent id is `toString` and whose declared requirements are all satisfied
- **AND** the registry has its own `toString` property containing a complete satisfying capability object
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation succeeds with zero errors

### Requirement: Phase 1 rejects every directed cycle

Every Phase 1 workflow graph SHALL be acyclic because its schema contains no `human.gate` node capable of satisfying the controlled-cycle contract. L2 MUST fail every graph containing a directed cycle. A cycle reachable from a root SHALL produce at least one cycle-category error located to an exact edge in that cycle. A cycle whose members are all unreachable from every root SHALL continue to fail through the existing node-located unreachable diagnostics and SHALL NOT return an additional cycle-category error.

#### Scenario: #46 Root-reachable multi-node cycle is rejected

- **GIVEN** an otherwise valid L1-valid graph with nodes `root`, `a`, and `b` and edges `root -> a`, `a -> b`, and `b -> a`
- **AND** the registry has satisfying own entries for every referenced agent
- **WHEN** L2 validates the identical IR and registry twice
- **THEN** both runs fail with deeply equal ordered error lists
- **AND** at least one error has `node` equal to null, `edge` deeply equal to `{ "from": "b", "to": "a" }`, and a code identifying a Phase 1 cycle

#### Scenario: #46 Root-reachable self-loop is rejected

- **GIVEN** an otherwise valid L1-valid graph with nodes `root` and `a` and edges `root -> a` and `a -> a`
- **AND** the registry has satisfying own entries for every referenced agent
- **WHEN** L2 graph-semantic validation runs
- **THEN** validation fails with a cycle-category error whose `edge` is deeply equal to `{ "from": "a", "to": "a" }`
- **AND** that error has `node` equal to null and non-empty `code` and `message` values

#### Scenario: #46 Disconnected self-loop retains the existing unreachable diagnostic

- **GIVEN** an otherwise valid L1-valid graph containing a valid root node plus a disconnected node `orphan` with the self-edge `orphan -> orphan`
- **WHEN** L2 validates the identical IR and registry twice
- **THEN** both runs fail with deeply equal ordered error lists
- **AND** at least one existing unreachable error has `node` equal to `orphan` and `edge` equal to null
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

### Requirement: Validator hardening preserves public compatibility and determinism

The new identifier, template-syntax, registry-membership, and reachable-cycle diagnostics SHALL retain the public error object contract of exactly `node`, `edge`, `code`, and `message`, with non-empty `code` and `message`. Revalidating an unchanged IR and registry SHALL return deeply equal errors in the same order. The bundled IR and existing #24/#25 valid behaviors SHALL remain successful, and existing #24/#25 invalid fixtures that do not exercise a new bypass SHALL retain their prior error categories and relative ordering.

#### Scenario: #46 Bundled and transitive-upstream behaviors remain valid

- **GIVEN** the bundled single-agent IR and its satisfying own Codex registry entry, plus the existing #25 acyclic transitive-upstream reference fixture
- **WHEN** each input is validated through its applicable L1 and L2 layers
- **THEN** the bundled input and transitive-upstream fixture both succeed with zero errors

#### Scenario: #46 Existing mixed builder fixture keeps its exact category sequence

- **GIVEN** the existing #25 builder fixture containing, in its current declaration order, a duplicate node id, one dangling edge, one disconnected self-loop node, one unresolved well-formed template, and one missing capability
- **WHEN** L2 validates the identical fixture and registry twice
- **THEN** both complete error lists are deeply equal
- **AND** the lists contain exactly five errors ordered by category as duplicate node id, missing edge endpoint, unreachable node, unresolved template, and missing capability
- **AND** no additional cycle-category error is present for the disconnected self-loop

#### Scenario: #46 New multi-error diagnostics keep the public shape and order

- **GIVEN** one L1-valid IR containing a root-reachable cycle, a malformed node-artifact template candidate, and an agent id absent as an own registry property
- **WHEN** L2 validates the identical IR and registry twice
- **THEN** the two complete error lists are deeply equal in list order and every field value
- **AND** every error object's complete key set is exactly `node`, `edge`, `code`, and `message`
- **AND** every `code` and `message` is a non-empty string
- **AND** the cycle, malformed-template, and unregistered-agent failures have pairwise distinct category codes

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

### Requirement: Independent #46 acceptance coverage follows implementation

The builder PR MUST NOT create, modify, or delete any `acceptance/**` file or modify an existing test. After the builder PR merges, black-box acceptance tests for this change SHALL be authored from issue #46 and this delta spec in a dedicated test-writer issue/PR. Every new test derived from this delta MUST include `#46` in its full title. The test-writer PR MUST only add files below `acceptance/**` and MUST NOT inspect or change product implementation or builder unit tests.

#### Scenario: #46 Test-writer change is a later pure acceptance addition

- **GIVEN** the test-writer branch for this change is compared with its base and its PR history is inspected
- **WHEN** changed paths, change statuses, and merge order are evaluated
- **THEN** every changed path is a newly added file below `acceptance/**`
- **AND** every new full test title contains `#46`
- **AND** the builder implementation PR is merged before the test-writer run begins

#### Scenario: #46 Acceptance runner isolation remains enforced

- **GIVEN** the independently authored #46 acceptance files are present
- **WHEN** `pnpm test` and `pnpm acceptance` are run separately
- **THEN** `pnpm test` does not collect any #46 acceptance test
- **AND** `pnpm acceptance` collects every #46 acceptance test
- **AND** `pnpm acceptance` exits successfully only when all three bypass contracts and the compatibility scenarios conform

#### Scenario: #46 Builder test diff respects ownership

- **GIVEN** the builder implementation branch is compared with its base
- **WHEN** its changed test paths and statuses are inspected
- **THEN** it adds builder-owned unit coverage in a new file under `shared/`
- **AND** it does not modify or delete any existing test
- **AND** it does not create, modify, or delete any file below `acceptance/**`
