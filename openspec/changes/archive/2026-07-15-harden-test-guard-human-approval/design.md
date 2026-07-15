## Context

The living [`build-pipeline` specification](../../../specs/build-pipeline/spec.md) makes `test-guard` a required deterministic check and assigns it enforcement of existing-test and `acceptance/**` ownership. The current [workflow](../../../../.github/workflows/test-guard.yml) accepts any matching label event whose `actor.type` is `User`; GitHub's public user records show that both the human CODEOWNER `SSSensational` and the repository PAT bot `uuiodwae` have that type, with different numeric IDs ([owner record](https://api.github.com/users/SSSensational), [bot record](https://api.github.com/users/uuiodwae)).

GitHub's issue-events API exposes `actor.login`, `actor.id`, and `actor.type` on each event ([REST issue events](https://docs.github.com/en/rest/issues/events?apiVersion=2022-11-28)). GitHub separately documents the numeric user `ID` as durable and the `login` as changeable over time ([REST users: get by ID](https://docs.github.com/en/rest/users/users?apiVersion=2022-11-28#get-a-user-using-their-id)). The repository's [CODEOWNERS](../../../../.github/CODEOWNERS) assigns `.github/**` to `@SSSensational`; GitHub documents that CODEOWNERS entries identify users or teams with explicit write access and that protecting the CODEOWNERS file or directory is the secure arrangement ([About code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)).

This is a security-sensitive but repository-local policy change. It must remain deterministic, require no new service or dependency, and must not modify product code or existing test contents.

## Goals / Non-Goals

**Goals:**

- Make an `approved-test-change` exemption require the exact durable ID of an explicitly configured human owner/CODEOWNER.
- Reject the repository PAT bot even though GitHub reports its account type as `User`.
- Keep authorization independent of display name and login changes.
- Exercise the same predicate used by the workflow with deterministic, network-free tests.
- Give the independent test-writer a stable black-box policy entrypoint without requiring it to inspect the workflow implementation.

**Non-Goals:**

- Proving whether the configured owner's action used an interactive browser session or a PAT belonging to that same owner account.
- Changing protected-diff detection, event retrieval/pagination, label lifecycle semantics, or acceptance ownership.
- Deriving approvers dynamically from GitHub teams or making live API calls during tests.

## Decisions

### Use a protected allowlist of durable numeric user IDs

The policy will contain a source-controlled set of authorized human user IDs, initially `37439786` for CODEOWNER `SSSensational`. The human-readable login will remain adjacent documentation for auditability, but only the numeric ID will decide authorization. The allowlist will live under `.github/**`, which is already owned by `@SSSensational`, so changing who can grant the exemption follows the same CODEOWNER-reviewed path as changing the gate itself.

Alternatives rejected:

- `actor.type === "User"` is insufficient because the fixed PAT bot account is also a `User`.
- Display name is user-editable and is not part of the simple actor identity shown by the issue-events contract.
- Login is suitable for CODEOWNERS syntax but GitHub explicitly documents that it can change; using it as the runtime authorization key would couple the gate to renames.
- Repository collaborator/write permission is too broad because the PAT bot must remain a collaborator while being unable to approve protected test changes.

### Evaluate a small fail-closed approval predicate

An event grants the exemption only when all of these conditions hold: it is a `labeled` event, its label is exactly `approved-test-change`, its actor is a `User`, and its actor ID is a valid member of the authorized-ID set. Missing, malformed, or unlisted actor IDs return false. The surrounding protected-diff rules and failure reasons remain unchanged.

Keeping `actor.type === "User"` is defense in depth, not the proof of humanness: the allowlisted durable ID is the decisive boundary. This also makes malformed fixtures and unexpected API payloads fail closed.

### Share one stable predicate between the workflow and tests

The predicate and allowlist will be placed in the dependency-free CommonJS module `.github/test-guard-approval.cjs`, exporting `hasAuthorizedTestChangeApproval`; `test-guard.yml` will call that helper after checkout. A new operational test under the repository's existing `scripts/*.test.mjs` path and a later, independently authored `acceptance/**` test will load the same helper and cover the configured owner, `uuiodwae`, changed/absent presentation fields, wrong event/label values, and invalid IDs. Tests will use in-memory event fixtures and perform no GitHub API calls.

This avoids a source-text-only assertion that could pass while runtime behavior differs, avoids duplicating the security predicate in workflow YAML and tests, and gives the test-writer a contract visible in the delta spec rather than forcing it to read implementation.

## Risks / Trade-offs

- [A PAT belonging to the authorized owner's own account produces the same actor ID] → Treat account control as the trust boundary; account credential policy and human final review remain the mitigation. The issue's separate bot account is still excluded.
- [A future CODEOWNER replacement requires updating the ID allowlist] → Make that update in the same CODEOWNER-reviewed `.github/**` change and add/update the deterministic identity fixture.
- [The workflow could stop invoking the tested helper] → Add an integration-level deterministic assertion that the workflow references the shared helper, while behavior tests exercise the helper itself.
- [Numeric IDs are less readable in review] → Keep the corresponding CODEOWNER login as an adjacent comment or mapping value, without using it for authorization.

## Migration Plan

1. Add the protected approval-policy helper and deterministic fixtures for the current owner and PAT bot.
2. Update `test-guard.yml` to use the shared predicate while leaving diff classification and failure reporting intact.
3. Run the default test suite and exercise workflow fixtures showing bot rejection and owner acceptance; the proposal PR and implementation PR remain subject to CODEOWNER review.
4. After implementation merges, independently add `acceptance/**` coverage against the documented shared predicate and confirm the acceptance suite passes.
5. Roll back by reverting the workflow/helper change together if the required check cannot execute; do not fall back to actor-type-only authorization.

## Open Questions

None. The current repository has one explicitly listed human CODEOWNER and one fixed PAT bot account, so the initial allowlist and rejection fixture are known.
