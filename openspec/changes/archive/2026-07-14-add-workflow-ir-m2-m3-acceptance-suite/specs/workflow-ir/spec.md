## ADDED Requirements

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
