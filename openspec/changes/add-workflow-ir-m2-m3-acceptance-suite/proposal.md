## Why

GitHub issues [#24](https://github.com/SSSensational/orchestrate/issues/24) and [#25](https://github.com/SSSensational/orchestrate/issues/25) both require an independent test-writer suite derived from the `workflow-ir` scenarios, but [#44](https://github.com/SSSensational/orchestrate/issues/44) records that the repository has no `acceptance/**` files and `pnpm acceptance` therefore succeeds without exercising those contracts. The missing suite leaves the completed M2/M3 behavior without the independently authored, deterministic evidence required by the repository constitution.

## What Changes

- Add a dedicated test-writer dispatch path to the orchestration scripts, since the existing dispatcher forbids builders from touching `acceptance/**` and never runs `pnpm acceptance` in its local checks.
- Add a black-box `workflow-ir` acceptance suite under `acceptance/**`, derived only from #24, #25, and the source `workflow-ir` delta spec, delivered through that test-writer path.
- Cover L1 success, strict unknown-field rejection, and the public structured-error contract from #24.
- Cover L2 success, duplicate ids, dangling edges, unreachable nodes, unresolved templates, missing agents, missing capabilities, valid transitive-upstream artifact references, and deterministic error ordering from #25.
- Prove that the six L2 failure categories return pairwise-distinct, repeat-stable public error codes, without fixing literal spellings.
- Include `#24` or `#25` in every test title and prove that the normal and acceptance commands collect the suite through their intended, disjoint routes.
- Wire the acceptance suite into the deterministic gates (absorbing issue [#45](https://github.com/SSSensational/orchestrate/issues/45)): `pnpm acceptance` fails when zero tests are collected, and the required `ci` check executes the suite.
- Deliver as three sequential PRs: a scripts-only PR for the test-writer path, one pure test PR whose diff adds only `acceptance/**` files, and one CI-wiring PR limited to `package.json`, `vitest.acceptance.config.ts`, and `.github/workflows/ci.yml`.

## Capabilities

### New Capabilities

- `workflow-ir`: Adds the independent M2/M3 acceptance evidence required for the `workflow-ir` capability currently defined by `single-channel-workflow-slice`; it does not add or alter runtime behavior.
- `build-pipeline`: The acceptance command fails when it collects zero tests, and the required `ci` check executes the acceptance suite; the existing test/acceptance routing split is unchanged.

### Modified Capabilities

None. There is no archived `workflow-ir` living spec yet; this change adds an acceptance-focused delta for the in-flight capability without changing its L1/L2 contract.

## Impact

- Task 1's implementation PR modifies only `scripts/**` and necessary operational docs.
- Task 2's implementation PR adds only files under `acceptance/**`; no product source, existing tests, configuration, documentation, dependencies, or other OpenSpec changes are part of it.
- Task 3's implementation PR modifies only `package.json`, `vitest.acceptance.config.ts`, and `.github/workflows/ci.yml`.
- `pnpm test` continues to exclude `acceptance/**`; `pnpm acceptance` begins collecting and executing the new suite, fails on zero tests, and becomes enforced by the required `ci` check.
- Standalone issue [#45](https://github.com/SSSensational/orchestrate/issues/45) is absorbed by task 3 and is closed by that task's merged implementation PR via `Closes #45`, per the repository's merged-PR-only closure rule.
- Any runtime defect exposed by the suite remains outside this change and must be handled by a separate issue such as [#46](https://github.com/SSSensational/orchestrate/issues/46).

## 验收判据

- [ ] Independent acceptance tests cover every #24 and #25 behavior enumerated in this proposal, and each test title contains its source issue tag (`#24` or `#25`).
- [ ] The #24 tests prove bundled-example L1 success, unknown-field rejection, and exact public error-object shape with non-empty `code` and `message`.
- [ ] The #25 tests prove bundled-example L2 success; duplicate id, dangling edge, unreachable node, unresolved template, missing agent, and missing capability failures; valid transitive-upstream references; and deeply equal, same-order errors on repeated validation.
- [ ] The #25 tests prove the six L2 failure categories return pairwise-distinct, repeat-stable error codes without asserting literal spellings.
- [ ] `pnpm test` exits successfully without collecting any new acceptance file or test, while `pnpm acceptance` collects and executes every new acceptance file and test.
- [ ] `pnpm acceptance` exits non-zero when it collects zero tests, and the required `ci` check executes the suite with `#24`/`#25`-tagged titles visible in its log.
- [ ] The test-writer dispatch path permits only added `acceptance/**` files, runs `pnpm acceptance` in its local checks, and is selectable by seed/watch.
- [ ] Task 1's PR diff modifies only `scripts/**` and operational docs; task 2's PR diff contains only added files below `acceptance/**` and passes the repository's pure-test `test-guard` rule; task 3's PR diff modifies only the three build-pipeline files named above.

## Non-goals

- Fixing `workflow-ir` product defects, including the separate cases tracked by #46.
- Changing product code, existing tests, or the source `single-channel-workflow-slice` change; script edits are limited to task 1's dispatch path, and configuration/CI edits are limited to task 3's three files.
- Publishing literal error-code spellings; only pairwise distinctness and repeat stability are asserted.
- Wiring per-issue grep enforcement into CI beyond making every test title grep-addressable.
- Expanding workflow-ir behavior beyond the #24/#25 criteria and their existing source scenarios.
