## Context

The M2/M3 runtime behavior is already described by `openspec/changes/single-channel-workflow-slice/specs/workflow-ir/spec.md` and was delivered through GitHub issues [#24](https://github.com/SSSensational/orchestrate/issues/24) and [#25](https://github.com/SSSensational/orchestrate/issues/25). Issue [#44](https://github.com/SSSensational/orchestrate/issues/44) records the evidence gap: no independently authored `acceptance/**` suite exists, so the dedicated command can pass without evaluating workflow-ir.

The relevant test routing already exists in `vitest.config.ts`, `vitest.acceptance.config.ts`, and the root `package.json`: the normal config excludes `acceptance/**`, while the acceptance config includes it. The orchestration scripts, however, have no test-writer path: `scripts/dispatch.mjs` forbids builders from touching `acceptance/**` and its local check loop never runs `pnpm acceptance`. Task 1 adds that path; task 2 supplies the tests through it without changing test configuration; task 3 then wires `pnpm acceptance` into the required `ci` gate and removes the zero-test success path (absorbing issue [#45](https://github.com/SSSensational/orchestrate/issues/45)), so the suite is deterministic evidence rather than an optional command. Issue [#46](https://github.com/SSSensational/orchestrate/issues/46) separately owns known runtime corrections and explicitly requires independent acceptance coverage to remain outside its product-code PR.

The source issue and delta specify stable semantic error categories but do not publish literal error-code strings. This proposal therefore does not invent new string values: tests identify the relevant error by its observable failure, exact offending id/reference, and locator. The category-identification property the source contract requires is asserted structurally: codes for different failure categories must be pairwise distinct, and repeated validation of identical input must return identical codes and identically ordered lists.

## Goals / Non-Goals

**Goals:**

- Produce black-box evidence for every #24/#25 behavior selected by #44.
- Preserve test-author independence by deriving cases only from the two source issues and the source delta, never from product implementation or builder tests.
- Make provenance and runner collection mechanically observable.
- Make the suite enforced by the required deterministic gates, not just runnable on demand.
- Make the suite deliverable through the pipeline: a test-writer dispatch path whose workspace and check contract match `acceptance/**` ownership.
- Keep the test delivery atomic as one added-files-only acceptance PR, with the dispatch path and CI wiring each in their own PR.

**Non-Goals:**

- Correct or broaden workflow-ir runtime behavior.
- Change product source, dependencies, existing tests, or other OpenSpec artifacts; script edits are limited to task 1's dispatch path, and configuration/CI edits are limited to task 3's three build-pipeline files.
- Define new literal public error codes that #24/#25 did not specify.

## Decisions

### 1. Treat the suite as black-box contract evidence

Each acceptance case will arrange inputs using the public workflow-ir surface and assert only behavior stated by #24, #25, and the source delta. It will not copy private helpers, mirror implementation branches, or use builder unit tests as fixtures.

The rejected alternative is white-box derivation from `shared/src/workflow-ir.ts` or existing unit tests. That would make the suite reproduce the implementation rather than independently evaluate the prior contract, contrary to `docs/constitution.md` §4 and #44's explicit source boundary.

### 2. Map each selected behavior to an issue-tagged test case

L1 cases carry `#24`; L2 cases carry `#25`. Parameterized cases are permitted only when every expanded test title still contains the applicable tag and remains individually visible in Vitest output. Shared builders may live inside newly added `acceptance/**` files, but must not weaken the per-scenario assertions in the delta.

The rejected alternative is one broad “workflow-ir validates” test. It would obscure which source criterion failed and would not support the planned per-issue title grep described by #44.

### 3. Verify runner isolation and diff purity without configuration edits in the test PR

The delivered tree must satisfy both existing commands: `pnpm test` collects none of the new paths/titles, and `pnpm acceptance` collects and executes all of them. Task 2's implementation diff is checked independently and must contain only added `acceptance/**` paths.

The rejected alternative is modifying Vitest config inside the test PR to force collection. Current configuration already expresses the required split; changing it there would invalidate the pure-test PR boundary that `test-guard` enforces.

### 4. Wire the acceptance gate inside this change

Without CI wiring the suite never enters a deterministic gate: the required `ci` runs only `pnpm test` (which excludes `acceptance/**`), and `pnpm acceptance` exits 0 when it collects zero tests. Task 3 therefore absorbs issue #45: remove the zero-test success path and execute the acceptance command in the required `ci` workflow, as a separate PR after the pure-test PR merges so `test-guard`'s ownership rules stay intact.

The rejected alternative is leaving the wiring to standalone issue #45. That sequencing leaves a window in which the evidence exists but nothing enforces it, and this change would not achieve its stated Why.

### 5. Add a test-writer dispatch path before the suite task

`scripts/dispatch.mjs` instructs builders never to create or modify `acceptance/**`, and its local check loop runs typecheck/lint/test but never `pnpm acceptance`, so the suite cannot be delivered through the existing automation without violating ownership rules. Task 1 adds an explicitly selected test-writer role with an inverted workspace contract — only added `acceptance/**` files are allowed — and a local check loop that runs `pnpm typecheck`, `pnpm lint`, and `pnpm acceptance`, reusing the existing worktree, PR, refeed, and advisory-review flow.

The rejected alternative is hand-crafting the suite PR outside the pipeline. That bypasses dispatch's discipline for exactly the artifact whose independence matters most, and leaves nothing reusable for future test-writer issues.

## Risks / Trade-offs

- **[The public contract omits literal error-code spellings]** → Assert pairwise-distinct, repeat-stable codes across failure categories instead of literal values; leave any literal code-value contract to a separate spec change.
- **[A newly exposed product defect makes acceptance red]** → Record and resolve the defect in its own product issue/PR; do not weaken the acceptance case or patch product code in this change.
- **[Parameterized tests hide issue provenance]** → Require the expanded Vitest title of every case to contain exactly one source tag, `#24` or `#25`.
- **[Helper reuse accidentally depends on private implementation]** → Keep all new helper code inside `acceptance/**` and exercise only public package/example entry points.

## Migration Plan

Task 1 wires the test-writer dispatch path in a scripts-only PR; task 2 adds the suite in one pure-test PR; task 3 wires the acceptance gate in a follow-up PR limited to `package.json`, `vitest.acceptance.config.ts`, and `.github/workflows/ci.yml`. Each PR runs `pnpm test` and `pnpm acceptance` and verifies its changed-path set before review. Rollback reverts any PR independently; there is no product or data migration.

## Open Questions

None. Literal error-code spellings and the runtime defects tracked by #46 are explicitly outside this change.
