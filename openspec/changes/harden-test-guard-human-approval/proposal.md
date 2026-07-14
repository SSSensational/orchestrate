## Why

GitHub issue [#47](https://github.com/SSSensational/orchestrate/issues/47) records that `test-guard` treats every label event whose actor has GitHub type `User` as human approval. The repository's PAT bot `uuiodwae` also has type `User`, so the required check currently cannot prove that an authorized human owner granted the `approved-test-change` exemption.

## What Changes

- Replace the actor-type-only exemption check with an explicit, source-controlled allowlist of authorized human owner/CODEOWNER identities.
- Match label actors by GitHub's durable numeric user ID rather than display name or mutable login, while retaining the expected label name and rejecting missing, malformed, or unlisted identities.
- Add deterministic policy tests covering the repository PAT bot, the configured human owner, identity presentation changes, and fail-closed inputs.
- Keep the existing rules for detecting modified/deleted/renamed tests and mixed implementation-plus-acceptance PRs unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `build-pipeline`: Strengthen the `test-guard` exemption contract so only an explicitly configured human owner/CODEOWNER can authorize protected test changes.

## Impact

- Affected required check: `.github/workflows/test-guard.yml` and any source-controlled policy helper used by that workflow.
- Affected tests: new deterministic operational tests for the exemption predicate; existing product, unit, integration, and acceptance test contents remain unchanged.
- Affected configuration: the protected repository configuration records the durable GitHub user ID of each human owner allowed to grant the exemption.
- No product runtime, public API, dependency, workflow-IR, agent adapter, or acceptance-test ownership behavior changes.

## 验收判据

- [ ] For a PR that triggers the existing protected-test rule, an `approved-test-change` label event from `uuiodwae` with actor type `User` and user ID `112002218` does not grant an exemption, and `test-guard` reports failure.
- [ ] For the same protected PR, an `approved-test-change` label event from the explicitly configured human CODEOWNER with durable user ID `37439786` grants the exemption, and `test-guard` reports success.
- [ ] Authorization is decided by the configured durable user ID: changing or omitting an event actor's display name, or presenting a different login for the same configured ID, does not change the result.
- [ ] A label event with a missing or malformed actor ID, an unconfigured user ID, the wrong label name, or the wrong event type does not grant an exemption.
- [ ] Deterministic tests exercise the approval predicate without live GitHub API calls and run under the repository's existing default test command.
- [ ] The implementation changes only `.github/workflows/test-guard.yml`, related deterministic operational test/helper files, and necessary operational documentation; it does not modify product code or any existing test file's contents.

## Non-goals

- Distinguishing whether a credential used by the configured human owner's own GitHub account was interactive or token-based; GitHub issue events identify the account, not the credential kind.
- Changing which file diffs trigger `test-guard`, the `approved-test-change` label name, acceptance-test ownership rules, or required-check names.
- Adding an external identity service, a new dependency, or a live-network dependency to deterministic tests.
- Modifying product code, existing test contents, or files outside the issue's explicitly allowed workflow, test, and operational-documentation scope.
