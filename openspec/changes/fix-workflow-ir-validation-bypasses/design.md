## Context

Issue [#46](https://github.com/SSSensational/orchestrate/issues/46) was reproduced from the current validator implementation:

- L1 accepts every non-empty node id, edge endpoint, and output-artifact name, while L2's template regex excludes dots and therefore never examines a dotted reference ([schema and matcher](../../../shared/src/workflow-ir.ts#L28-L42), [reference loop](../../../shared/src/workflow-ir.ts#L247-L266)).
- L2 reads `registry[node.agent]` and treats a truthy inherited value as capabilities ([registry lookup](../../../shared/src/workflow-ir.ts#L268-L287)). ECMAScript ordinary property access follows the prototype chain after an own-property miss, whereas `Object.hasOwn` tests only the named object's own property ([ECMAScript 2026 `OrdinaryGet`](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-ordinaryget), [`Object.hasOwn`](https://tc39.es/ecma262/2026/multipage/fundamental-objects.html#sec-object.hasown)).
- Reachability starts at zero-indegree roots, so `root -> a -> b -> a` marks all three nodes reachable and produces no error ([reachability pass](../../../shared/src/workflow-ir.ts#L218-L242)). PRD §8 and §14 require every cycle to contain `human.gate`, while Phase 1 supports only the acyclic single-agent slice and defers gates/controlled cycles to Phase 4 ([PRD](../../../docs/PRD.md#8-canonical-ir-agentworkflowv1), [roadmap](../../../docs/PRD.md#19-实施路线每-phase-一个可展示-checkpoint)).

The existing `workflow-ir` living spec requires L1-before-L2, transitive upstream template resolution, exact structured-error fields, and deterministic ordering ([living spec](../../specs/workflow-ir/spec.md)). Existing #24/#25 tests are compatibility constraints. In particular, one builder fixture contains a disconnected self-loop and asserts the exact existing sequence `duplicate -> dangling -> unreachable -> unresolved-template -> missing-capability` ([unit fixture](../../../shared/workflow-ir-l2.test.ts#L25-L63)); existing tests cannot be edited by this change.

## Goals / Non-Goals

**Goals:**

- Close all three bypasses at their shared validation boundaries.
- Make identifier and template syntax mechanically decidable without adding a template dependency.
- Make every Phase 1 directed cycle invalid and give newly rejected reachable cycles a stable edge locator.
- Preserve existing #24/#25 results, error shape, and ordering while adding deterministic new categories.
- Keep acceptance authorship separate and make the test-writer PR precede builder implementation.

**Non-Goals:**

- Implement `human.gate`, controlled-cycle execution, or `max_rounds` runtime behavior.
- Add escaping, expressions, arbitrary template namespaces, or a general parser.
- Change agent-id, workflow-name, input-name, or other unrelated string contracts.
- Rewrite existing tests or retroactively edit archived changes.

## Decisions

### 1. Use one delimiter-safe ASCII identifier grammar

Node ids, edge `from`/`to` values, and every `output_artifacts` name will use `^[A-Za-z0-9_-]+$`. Both variable portions of a node-artifact reference use the same grammar, so the only dots in `{{nodes.<id>.artifacts.<name>}}` are structural delimiters. The grammar retains every identifier used by the bundled IR and #24/#25 fixtures, including underscore and hyphen forms.

L1 will reuse one schema for declared identifiers and edge endpoints. L2 will treat every literal `{{nodes.` occurrence in an agent prompt as a candidate: the candidate must terminate at the next `}}` and match the complete node-artifact form. A malformed or unterminated candidate produces a distinct node-located syntax error containing the exact candidate; an exact candidate continues through the existing upstream/declaration resolution path in prompt order.

Expanding the current capture groups to accept dots was rejected because the dot is already the namespace separator, so `nodes.producer.v2.artifacts.report.v1` cannot be split unambiguously without inventing escaping. A general template parser was rejected because Phase 1 has one fixed reference form.

### 2. Require an own registry property before reading capabilities

L2 will first call the Node 22 native `Object.hasOwn(registry, node.agent)`. Only then will it read and validate capabilities through the existing path. This accepts an intentionally registered own key such as `toString` while rejecting both `Object.prototype.toString` and custom prototype entries.

Using `in` or direct indexing was rejected because both traverse prototypes. Calling `registry.hasOwnProperty` was rejected because a registry can shadow that name; changing all registries to null-prototype objects would move the trust-boundary fix to every caller instead of the shared validator.

### 3. Add cycle diagnostics only where reachability does not already reject the cycle

After valid-edge adjacency and the existing reachable set are built, L2 will run a color-marked depth-first traversal over reachable nodes. Node declaration order and edge declaration order define traversal order. An edge to a currently visiting node is a deterministic back edge and produces a cycle-category error whose `edge` is that exact `{from, to}` pair. A reachable self-loop is its own back edge.

Every directed cycle is then invalid: a root-reachable cycle receives the new cycle diagnostic, while a source-less/disconnected cycle continues to receive the existing node-located `unreachable` diagnostics. The latter intentionally receives no additional cycle error, preserving the exact #25 builder fixture without weakening rejection.

Kahn-only detection was rejected because leftover nodes do not identify a specific offending edge. Strongly connected component enumeration was rejected because Phase 1 needs rejection and one stable repair locator, not a complete cycle inventory.

### 4. Preserve validation phase and error order

The existing order remains duplicate ids, dangling endpoints, unreachable nodes, template diagnostics, and registry/capability diagnostics. Reachable-cycle errors are inserted after reachability diagnostics and before template diagnostics; template candidates remain node order then prompt order. Existing fixtures that contain no newly rejected reachable cycle or malformed candidate therefore return byte-for-byte equal error lists.

The test-writer task will first add black-box `#46` cases under `acceptance/**` from the delta spec. The later builder task will modify `shared/src/workflow-ir.ts` and add a new unit-test file under `shared/`; it will not modify any existing test or acceptance file.

## Risks / Trade-offs

- **[Previously accepted dotted or non-ASCII identifiers become invalid at L1]** → This is an intentional contract correction; all checked-in IR and #24/#25 fixtures already satisfy the selected grammar, and the proposal marks the change as breaking for undocumented external inputs.
- **[A prompt that literally documents text beginning with `{{nodes.` is interpreted as a template candidate]** → Phase 1 defines that prefix as reserved syntax; escaping and literal-template authoring remain out of scope until a demonstrated use case requires them.
- **[Disconnected cycles retain `unreachable` rather than gaining a cycle-specific code]** → They remain deterministically rejected and node-located, while avoiding a forbidden change to the exact existing error list. Reachable cycles—the actual bypass—receive an explicit cycle category and edge locator.
- **[DFS may report more than one back edge in a graph with several reachable cycles]** → Declaration/edge order makes the list deterministic; the contract requires rejection and actionable locators, not a minimal cycle basis.

## Migration Plan

1. Land the independent test-writer issue/PR containing only new `acceptance/**` tests derived from this delta.
2. Land the builder issue/PR with the shared validator changes and a new builder unit-test file; run the existing #24/#25 suites unchanged.
3. After all change issues close, use the repository's archive workflow to sync this delta into the `workflow-ir` living spec.

No persisted data migration or runtime rollout step is required. Reverting the validator change also reverts its new unit tests; the independently landed acceptance tests remain as visible evidence that the bypass has returned.

## Open Questions

None.
