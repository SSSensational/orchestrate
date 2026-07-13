## Why

GitHub issues [#24](https://github.com/SSSensational/orchestrate/issues/24) and [#25](https://github.com/SSSensational/orchestrate/issues/25) both require an independent test-writer suite derived from the `workflow-ir` scenarios, but [#44](https://github.com/SSSensational/orchestrate/issues/44) records that the repository has no `acceptance/**` files and `pnpm acceptance` therefore succeeds without exercising those contracts. The missing suite leaves the completed M2/M3 behavior without the independently authored, deterministic evidence required by the repository constitution.

## What Changes

- Add a black-box `workflow-ir` acceptance suite under `acceptance/**`, derived only from #24, #25, and the source `workflow-ir` delta spec.
- Cover L1 success, strict unknown-field rejection, and the public structured-error contract from #24.
- Cover L2 success, duplicate ids, dangling edges, unreachable nodes, unresolved templates, missing agents, missing capabilities, valid transitive-upstream artifact references, and deterministic error ordering from #25.
- Include `#24` or `#25` in every test title and prove that the normal and acceptance commands collect the suite through their intended, disjoint routes.
- Deliver the implementation as one pure test PR whose diff adds only `acceptance/**` files.

## Capabilities

### New Capabilities

- `workflow-ir`: Adds the independent M2/M3 acceptance evidence required for the `workflow-ir` capability currently defined by `single-channel-workflow-slice`; it does not add or alter runtime behavior.

### Modified Capabilities

None. There is no archived `workflow-ir` living spec yet; this change adds an acceptance-focused delta for the in-flight capability without changing its L1/L2 contract.

## Impact

- Implementation scope is limited to newly added files under `acceptance/**`.
- No product source, existing tests, test configuration, documentation, dependencies, or other OpenSpec changes are part of the implementation PR.
- `pnpm test` continues to exclude `acceptance/**`; `pnpm acceptance` begins collecting and executing the new suite instead of succeeding with no tests.
- Any runtime defect exposed by the suite remains outside this change and must be handled by a separate issue such as [#46](https://github.com/SSSensational/orchestrate/issues/46).

## 验收判据

- [ ] Independent acceptance tests cover every #24 and #25 behavior enumerated in this proposal, and each test title contains its source issue tag (`#24` or `#25`).
- [ ] The #24 tests prove bundled-example L1 success, unknown-field rejection, and exact public error-object shape with non-empty `code` and `message`.
- [ ] The #25 tests prove bundled-example L2 success; duplicate id, dangling edge, unreachable node, unresolved template, missing agent, and missing capability failures; valid transitive-upstream references; and deeply equal, same-order errors on repeated validation.
- [ ] `pnpm test` exits successfully without collecting any new acceptance file or test, while `pnpm acceptance` collects and executes every new acceptance file and test.
- [ ] The implementation PR diff contains only added files below `acceptance/**` and passes the repository's pure-test `test-guard` rule.

## Non-goals

- Fixing `workflow-ir` product defects, including the separate cases tracked by #46.
- Changing product code, existing tests, Vitest or pnpm configuration, dependencies, documentation, or the source `single-channel-workflow-slice` change.
- Wiring additional CI jobs or per-issue grep enforcement beyond making every test title grep-addressable.
- Expanding workflow-ir behavior beyond the #24/#25 criteria and their existing source scenarios.
