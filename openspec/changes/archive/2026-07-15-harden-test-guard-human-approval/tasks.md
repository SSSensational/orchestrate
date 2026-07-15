## 1. Harden the test-guard human exemption policy

- [ ] Change only `.github/workflows/test-guard.yml`, `.github/test-guard-approval.cjs`, new related deterministic operational test files, and necessary operational documentation; do not modify product code, any existing test file's contents, or `acceptance/**`.
- [ ] Configure durable GitHub user ID `37439786` for human CODEOWNER `SSSensational` as the authorized approver, and do not authorize PAT bot `uuiodwae` with user ID `112002218`; keep the readable login as documentation only.
- [ ] Export `hasAuthorizedTestChangeApproval` from the dependency-free CommonJS module `.github/test-guard-approval.cjs`; make it authorize only an exact `labeled` / `approved-test-change` / `User` event whose integer actor ID is in the protected allowlist, while missing, malformed, unlisted, wrong-label, wrong-event, and non-`User` inputs all fail closed.
- [ ] Make `test-guard.yml` invoke that shared predicate without changing protected-diff detection, the exemption label name, acceptance ownership rules, failure reasons, or required-check names.
- [ ] Add network-free deterministic tests using the same helper to prove that the PAT bot's `User` event is rejected, the configured human owner's event is accepted, and changed or absent display-name/login fields do not affect either decision.
- [ ] Add a deterministic integration assertion that the workflow loads the shared helper, and ensure the new tests run under `pnpm test` with all repository default tests passing.

## 2. [test-writer] Add independent test-guard approval acceptance coverage

- [ ] Start only after task 1 is merged; author tests solely from GitHub issue #47 and this change's `build-pipeline` delta spec, without reading `.github/workflows/test-guard.yml`, `.github/test-guard-approval.cjs`, product implementation, or existing unit/operational tests to infer behavior.
- [ ] Add files only under `acceptance/**`; do not modify or delete any existing file, and include `#47` in every new full test title.
- [ ] Load the documented `.github/test-guard-approval.cjs` entrypoint and prove through in-memory, network-free events that PAT bot user ID `112002218` is rejected, configured human user ID `37439786` is accepted, and login/display-name changes do not affect either result.
- [ ] Cover missing, malformed, unlisted, wrong-label, wrong-event, and non-`User` inputs as fail-closed cases, and assert that the workflow references the documented shared module rather than carrying a separate approval predicate.
- [ ] Run `pnpm typecheck`, `pnpm lint`, and `pnpm acceptance`; all new acceptance tests pass without live GitHub API calls.
