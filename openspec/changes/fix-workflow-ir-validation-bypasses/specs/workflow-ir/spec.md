## ADDED Requirements

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
- **AND** no cycle-category error is returned for the unreachable self-loop

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
