## Why

GitHub issue [#46](https://github.com/SSSensational/orchestrate/issues/46) records three reproducible Phase 1 validation bypasses: inherited object properties can impersonate registered agents, dotted node/artifact names can evade template-reference validation, and a root-reachable agent-only cycle can pass L2. These gaps violate the current `workflow-ir` contract and PRD requirements, so they must be closed before later phases build authoring and execution on top of the validator.

## What Changes

- Treat an agent as registered only when its id is an own property of the supplied registry.
- **BREAKING**: Define one explicit identifier grammar for node ids, edge endpoints, output-artifact names, and both identifier positions in `{{nodes.<id>.artifacts.<name>}}`; reject previously accepted identifiers outside that grammar at L1 and malformed node-artifact template candidates at L2.
- Reject every directed cycle in the Phase 1 `agent.run` graph. Add a deterministic, edge-located cycle diagnostic where a reachable cycle would otherwise pass, while preserving existing diagnostics for already-invalid unreachable cycles.
- Add independently authored `#46` acceptance coverage in a test-writer issue/PR before implementation, then add builder-owned unit coverage in a new test file without modifying existing tests or `acceptance/**`.
- Add a `workflow-ir` delta spec for the hardened contracts and preserve the existing #24/#25 public error shape, failure categories, and deterministic ordering.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-ir`: Tightens registry membership, identifier/template validation, and Phase 1 cycle rejection while retaining the existing L1/L2 and structured-error contracts.

## Impact

- Affected product implementation: `shared/src/workflow-ir.ts`.
- Affected verification: one new builder unit-test file under `shared/`, plus an earlier independent test-writer PR that only adds `acceptance/**` coverage.
- Affected specification: this change's `specs/workflow-ir/spec.md`, later synced to the `workflow-ir` living spec through the repository archive workflow.
- No new runtime dependency, public error field, node type, or agent capability is introduced.

## 验收判据

- [ ] An `agent: "toString"` node fails L2 against an ordinary empty object registry, and an inherited registry entry never counts as registration; a matching own entry still does.
- [ ] Node ids, edge endpoints, output-artifact names, and template node/artifact segments obey the same documented identifier grammar; valid references are resolved, invalid schema identifiers fail L1, and malformed node-artifact template candidates fail L2 with the referencing node and exact candidate in the diagnostic.
- [ ] A root-reachable cycle such as `root -> a -> b -> a` fails with a repeat-stable, edge-located cycle diagnostic; every other Phase 1 directed-cycle shape also fails validation.
- [ ] The bundled example and all existing #24/#25 tests retain their current results; repeated validation returns deeply equal errors in the same order and every error keeps exactly `node`, `edge`, `code`, and `message`.
- [ ] New `#46` black-box acceptance tests are authored first in a separate test-writer issue/PR, and the builder implementation adds only new unit tests without modifying existing tests or `acceptance/**`.
- [ ] The delta spec contains deterministic GIVEN/WHEN/THEN scenarios for all three bypasses and passes strict OpenSpec validation.

## Non-goals

- Implementing `human.gate`, controlled P4 cycles, `max_rounds` execution semantics, or any non-`agent.run` node type.
- Creating a general template engine, expression language, escaping mechanism, or new template namespace.
- Changing the grammar of agent ids, workflow names, input names, or other strings not used as node/artifact identifiers.
- Modifying existing builder tests, existing acceptance tests, archived changes, dependencies, or files outside the issue's product/test/spec scope.
