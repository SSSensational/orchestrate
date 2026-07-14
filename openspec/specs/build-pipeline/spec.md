# build-pipeline Specification

## Purpose

Define the pnpm workspace scaffold, the separation between default and acceptance test suites, the Electron thin-shell skeleton, and the required CI checks that guard every pull request.

## Requirements

### Requirement: Fresh-clone workspace commands

The repository SHALL be a pnpm workspace containing `shared`, `server`, `web`, `desktop`, and `examples` packages, using Node.js 22 and TypeScript strict mode. A clean checkout SHALL install from the committed lockfile and expose working root `typecheck`, `lint`, and `test` commands.

#### Scenario: Clean clone passes deterministic commands

- **GIVEN** a fresh clone at the scaffold task's head with the declared Node.js and pnpm versions
- **WHEN** `pnpm install --frozen-lockfile` and then `pnpm typecheck && pnpm lint && pnpm test` are run
- **THEN** every command exits with code 0
- **AND** every workspace containing TypeScript source participates in typecheck and lint
- **AND** no command reports a missing script or silently skips all product workspaces

#### Scenario: TypeScript strict mode is active

- **GIVEN** the resolved TypeScript configuration for each product workspace
- **WHEN** its compiler options are inspected with `tsc --showConfig`
- **THEN** `strict` is `true`
- **AND** no child workspace disables a strict-family option inherited from the root configuration

### Requirement: Acceptance suite is separate from default tests

`pnpm test` SHALL exclude every test under `acceptance/`, and `pnpm acceptance` SHALL collect only tests under `acceptance/` so the two suites can run independently.

#### Scenario: Default test command excludes acceptance tests

- **GIVEN** one discoverable unit test outside `acceptance/` and one discoverable acceptance test inside `acceptance/`
- **WHEN** `pnpm test` runs
- **THEN** the unit test executes
- **AND** the acceptance test is neither collected nor executed

#### Scenario: Acceptance command runs only acceptance tests

- **GIVEN** the same unit and acceptance tests
- **WHEN** `pnpm acceptance` runs
- **THEN** the acceptance test executes
- **AND** the unit test outside `acceptance/` is neither collected nor executed

### Requirement: Electron thin-shell skeleton is runnable

The initial scaffold SHALL include an Electron `desktop` package that opens one `BrowserWindow` containing the local `web` renderer and exits cleanly. The renderer SHALL run with `nodeIntegration: false` and `contextIsolation: true`; the Electron main process SHALL contain no workflow validation, orchestration, adapter, or persistence logic.

#### Scenario: Desktop smoke opens the local renderer

- **GIVEN** dependencies are installed and the workspace is built
- **WHEN** the desktop smoke command launches the Electron app
- **THEN** exactly one application window reaches the ready state and displays the local renderer root
- **AND** closing the window exits the Electron process with code 0

#### Scenario: Renderer has no direct Node access

- **GIVEN** the launched desktop window
- **WHEN** its renderer evaluates the availability of Node globals and Electron's unrestricted IPC API
- **THEN** `require` and `process` are unavailable to application code
- **AND** no unrestricted `ipcRenderer`, shell, filesystem, or child-process API is exposed on `window`

### Requirement: Required checks execute real logic

Pull requests SHALL run required checks named `ci`, `spec-validate`, and `test-guard`. Once the scaffold exists, `ci` SHALL install with the frozen lockfile and run typecheck, lint, and default tests without a no-source/vacuous-success path; `spec-validate` SHALL run strict all-change validation; `test-guard` SHALL enforce existing-test and `acceptance/**` ownership rules.

#### Scenario: Scaffold pull request passes all required checks

- **GIVEN** the scaffold pull request from a clean checkout
- **WHEN** repository required checks run
- **THEN** checks named `ci`, `spec-validate`, and `test-guard` all report success
- **AND** the `ci` log shows the frozen-lockfile install, typecheck, lint, and default test commands actually ran
- **AND** the `ci` workflow contains no branch that succeeds merely because product source is absent

#### Scenario: Broken product typecheck fails ci

- **GIVEN** a pull request revision containing a TypeScript error in a product workspace
- **WHEN** `ci` runs that revision
- **THEN** the `ci` check reports failure at typecheck
- **AND** lint and test success cannot override that failure

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
