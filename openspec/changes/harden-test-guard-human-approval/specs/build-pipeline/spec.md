## ADDED Requirements

### Requirement: Test-change exemptions require an explicitly trusted human identity

The `test-guard` required check SHALL grant an `approved-test-change` exemption only for a `labeled` issue event whose actor is a GitHub `User` and whose durable numeric GitHub user ID is present in a source-controlled allowlist of human owners/CODEOWNERS. Authorization MUST be based on the durable user ID, not the actor's display name or login. Missing, malformed, or unlisted actor identities SHALL NOT grant an exemption.

#### Scenario: PAT bot label cannot exempt a protected test change

- **GIVEN** a pull request modifies, deletes, or renames an existing test and therefore requires an `approved-test-change` exemption
- **AND** the authorized human-ID allowlist contains CODEOWNER `SSSensational` with user ID `37439786` and does not contain PAT bot `uuiodwae` with user ID `112002218`
- **AND** the pull request's issue events contain a `labeled` event for `approved-test-change` whose actor login is `uuiodwae`, actor type is `User`, and actor ID is `112002218`
- **WHEN** the `test-guard` required check evaluates the pull request
- **THEN** the bot event does not grant an exemption
- **AND** `test-guard` reports failure for the protected test change

#### Scenario: Configured human CODEOWNER label grants the exemption

- **GIVEN** a pull request modifies, deletes, or renames an existing test and therefore requires an `approved-test-change` exemption
- **AND** the authorized human-ID allowlist contains CODEOWNER `SSSensational` with user ID `37439786`
- **AND** the pull request's issue events contain a `labeled` event for `approved-test-change` whose actor type is `User` and actor ID is `37439786`
- **WHEN** the `test-guard` required check evaluates the pull request
- **THEN** the configured human event grants the exemption
- **AND** `test-guard` reports success

#### Scenario: Presentation fields do not decide authorization

- **GIVEN** two otherwise identical `approved-test-change` label events have actor type `User` and configured actor ID `37439786`
- **AND** one event has the current CODEOWNER login and display name while the other has a different login and an absent or changed display name
- **WHEN** the approval predicate evaluates both events
- **THEN** both events produce the same authorized result
- **AND** no display-name or login value is compared to decide authorization

#### Scenario: Invalid or unrelated events fail closed

- **GIVEN** a protected test change requires an `approved-test-change` exemption
- **AND** each candidate event has at least one of: a missing actor ID, a non-integer actor ID, an unlisted actor ID, an event type other than `labeled`, a label other than `approved-test-change`, or an actor type other than `User`
- **WHEN** the approval predicate evaluates each candidate event
- **THEN** every candidate produces a non-authorized result
- **AND** none can make `test-guard` report success for the protected test change
