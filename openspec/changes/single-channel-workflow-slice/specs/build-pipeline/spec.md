# build-pipeline spec delta

## ADDED Requirements

### Requirement: Fresh-clone build commands

The repository SHALL be a pnpm workspace whose `install`, `typecheck`, `lint`, and `test` commands complete successfully from a clean checkout, using Node.js 22 and TypeScript strict mode.

#### Scenario: Clean clone passes all commands

- **GIVEN** a fresh clone of the repository at the change's head
- **WHEN** `pnpm install --frozen-lockfile` then `pnpm typecheck && pnpm lint && pnpm test` are run in order
- **THEN** every command exits with code 0
- **AND** no command reports a missing script

#### Scenario: TypeScript strict mode is enabled

- **GIVEN** the workspace tsconfig
- **WHEN** `pnpm typecheck` runs against a file that would only fail under `strict`
- **THEN** typecheck fails with a non-zero exit code

### Requirement: Acceptance suite is separated from the default test run

`pnpm test` SHALL exclude the `acceptance/` directory, and `pnpm acceptance` SHALL run only the `acceptance/` suite independently.

#### Scenario: Default test run excludes acceptance

- **GIVEN** a test file under `acceptance/` and a unit test outside it
- **WHEN** `pnpm test` runs
- **THEN** the unit test executes
- **AND** the `acceptance/` test is not collected or executed

#### Scenario: Acceptance suite runs independently

- **GIVEN** a test file under `acceptance/`
- **WHEN** `pnpm acceptance` runs
- **THEN** the `acceptance/` test is collected and executed

### Requirement: Required checks execute real logic

The `ci`, `spec-validate`, and `test-guard` required checks SHALL execute real logic on every pull request; once product source exists, `ci` SHALL NOT pass vacuously.

#### Scenario: ci fails on a broken build

- **GIVEN** a pull request that introduces a type error in product source
- **WHEN** the `ci` check runs
- **THEN** `ci` reports failure

#### Scenario: ci passes on a clean build

- **GIVEN** a pull request whose typecheck, lint, and test all pass
- **WHEN** the `ci` check runs
- **THEN** `ci` reports success by actually running typecheck, lint, and test (not the vacuous no-source branch)
