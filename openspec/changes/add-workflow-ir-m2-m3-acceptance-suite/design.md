## Context

The M2/M3 runtime behavior is already described by `openspec/changes/single-channel-workflow-slice/specs/workflow-ir/spec.md` and was delivered through GitHub issues [#24](https://github.com/SSSensational/orchestrate/issues/24) and [#25](https://github.com/SSSensational/orchestrate/issues/25). Issue [#44](https://github.com/SSSensational/orchestrate/issues/44) records the evidence gap: no independently authored `acceptance/**` suite exists, so the dedicated command can pass without evaluating workflow-ir.

The relevant test routing already exists in `vitest.config.ts`, `vitest.acceptance.config.ts`, and the root `package.json`: the normal config excludes `acceptance/**`, while the acceptance config includes it. This change must supply tests without changing that configuration. Issue [#46](https://github.com/SSSensational/orchestrate/issues/46) separately owns known runtime corrections and explicitly requires independent acceptance coverage to remain outside its product-code PR.

The source issue and delta specify stable semantic error categories but do not publish literal error-code strings. This proposal therefore does not invent new string values: tests identify the relevant error by its observable failure, exact offending id/reference, and locator, while repeated-validation assertions prove that the returned code and complete ordered list are stable for identical input.

## Goals / Non-Goals

**Goals:**

- Produce black-box evidence for every #24/#25 behavior selected by #44.
- Preserve test-author independence by deriving cases only from the two source issues and the source delta, never from product implementation or builder tests.
- Make provenance and runner collection mechanically observable.
- Keep implementation atomic as one added-files-only acceptance PR.

**Non-Goals:**

- Correct or broaden workflow-ir runtime behavior.
- Change test configuration, dependencies, CI workflows, existing tests, docs, or other OpenSpec artifacts.
- Define new literal public error codes that #24/#25 did not specify.

## Decisions

### 1. Treat the suite as black-box contract evidence

Each acceptance case will arrange inputs using the public workflow-ir surface and assert only behavior stated by #24, #25, and the source delta. It will not copy private helpers, mirror implementation branches, or use builder unit tests as fixtures.

The rejected alternative is white-box derivation from `shared/src/workflow-ir.ts` or existing unit tests. That would make the suite reproduce the implementation rather than independently evaluate the prior contract, contrary to `docs/constitution.md` §4 and #44's explicit source boundary.

### 2. Map each selected behavior to an issue-tagged test case

L1 cases carry `#24`; L2 cases carry `#25`. Parameterized cases are permitted only when every expanded test title still contains the applicable tag and remains individually visible in Vitest output. Shared builders may live inside newly added `acceptance/**` files, but must not weaken the per-scenario assertions in the delta.

The rejected alternative is one broad “workflow-ir validates” test. It would obscure which source criterion failed and would not support the planned per-issue title grep described by #44.

### 3. Verify runner isolation and diff purity without configuration edits

The delivered tree must satisfy both existing commands: `pnpm test` collects none of the new paths/titles, and `pnpm acceptance` collects and executes all of them. The implementation diff is checked independently and must contain only added `acceptance/**` paths.

The rejected alternative is modifying Vitest config or adding a new script to force collection. Current configuration already expresses the required split; changing it would expand #44 and invalidate the pure-test PR boundary.

## Risks / Trade-offs

- **[The public contract omits literal error-code spellings]** → Assert non-empty structured codes on each failure and deep equality, including order and code values, across repeated validation; leave any future code-value contract to a separate spec change.
- **[A newly exposed product defect makes acceptance red]** → Record and resolve the defect in its own product issue/PR; do not weaken the acceptance case or patch product code in this change.
- **[Parameterized tests hide issue provenance]** → Require the expanded Vitest title of every case to contain exactly one source tag, `#24` or `#25`.
- **[Helper reuse accidentally depends on private implementation]** → Keep all new helper code inside `acceptance/**` and exercise only public package/example entry points.

## Migration Plan

Add the suite in one PR, run `pnpm test` and `pnpm acceptance`, and verify the changed-path set before review. Rollback consists solely of reverting that pure-test PR; there is no product, configuration, dependency, or data migration.

## Open Questions

None. Literal error-code naming and the runtime defects tracked by #46 are explicitly outside this change.
