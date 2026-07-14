## 1. Harden the test-guard human exemption policy

- [ ] Change only `.github/workflows/test-guard.yml`, a dependency-free approval-policy helper under `.github/**`, new related deterministic operational test files, and necessary operational documentation; do not modify product code, any existing test file's contents, or `acceptance/**`.
- [ ] Configure durable GitHub user ID `37439786` for human CODEOWNER `SSSensational` as the authorized approver, and do not authorize PAT bot `uuiodwae` with user ID `112002218`; keep the readable login as documentation only.
- [ ] Make the shared predicate authorize only an exact `labeled` / `approved-test-change` / `User` event whose integer actor ID is in the protected allowlist; missing, malformed, unlisted, wrong-label, wrong-event, and non-`User` inputs all fail closed.
- [ ] Make `test-guard.yml` invoke that shared predicate without changing protected-diff detection, the exemption label name, acceptance ownership rules, failure reasons, or required-check names.
- [ ] Add network-free deterministic tests using the same helper to prove that the PAT bot's `User` event is rejected, the configured human owner's event is accepted, and changed or absent display-name/login fields do not affect either decision.
- [ ] Add a deterministic integration assertion that the workflow loads the shared helper, and ensure the new tests run under `pnpm test` with all repository default tests passing.
