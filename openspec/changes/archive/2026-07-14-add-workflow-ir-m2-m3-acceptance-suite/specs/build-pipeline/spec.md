## ADDED Requirements

### Requirement: Acceptance command fails when no tests are collected

`pnpm acceptance` SHALL exit with a non-zero code when it collects zero acceptance test files, so an empty or missing suite can never satisfy the acceptance gate.

#### Scenario: Zero collected acceptance tests fail the command

- **GIVEN** a working tree whose `acceptance/` directory contains no collectable test file
- **WHEN** `pnpm acceptance` runs from the repository root
- **THEN** the command exits with a non-zero code

### Requirement: Required ci executes the acceptance suite

The required `ci` check SHALL run the acceptance command in addition to the default test command, and any acceptance test failure SHALL fail `ci`.

#### Scenario: ci log proves acceptance execution

- **GIVEN** a pull request revision containing the workflow-ir acceptance suite
- **WHEN** the required `ci` check runs
- **THEN** the `ci` log shows that `pnpm acceptance` ran
- **AND** the executed test titles visible in that log include tags `#24` and `#25`

#### Scenario: Failing acceptance test fails ci

- **GIVEN** a pull request revision in which at least one acceptance test fails
- **WHEN** the required `ci` check runs
- **THEN** the `ci` check reports failure
