# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `tsqlrefine`, a VS Code extension that integrates TSQLRefine (a T-SQL linter) into the editor. It provides real-time linting for SQL files with support for both manual and automatic linting.

## Build and Test Commands

### Development
```bash
npm install              # Install dependencies
npm run build            # Bundle extension/server to dist/ with esbuild
npm run compile          # Compile TypeScript to out/ (for tests)
npm run watch            # Watch mode for development (esbuild)
npm run typecheck        # Type-check without emitting
```

### Code Quality
```bash
npm run lint             # Lint with Biome
npm run format           # Format with Biome
```

### Testing
```bash
npm run test:unit        # Run unit tests with Mocha
npm run test:unit:coverage  # Run unit tests with c8 coverage reporting
npm run test:coverage    # Run tests with coverage (alias for test:unit:coverage)
npm run test:e2e         # Run E2E tests with VS Code Test
npm test                 # Run all tests (unit + E2E)
```

### Code Coverage
```bash
npm run test:unit:coverage  # Generate coverage report (targets: 50% lines, 80% functions, 75% branches)
```

**Build Process for Tests**:
- **Unit tests**: Use `npm run compile:test` to compile test files to `out/`, then run with Mocha
- **E2E tests**: Use `npm run build` (bundles to `dist/`) + `npm run compile:test` (compiles tests to `out/`), then run with VS Code Test

The VS Code extension is loaded from `dist/extension.js` while test files run from `out/test/**/*.test.js`.

The E2E test runner uses `@vscode/test-cli` with configuration in [.vscode-test.mjs](.vscode-test.mjs) and a fixture workspace at [test/fixtures/workspace/](test/fixtures/workspace/).

## Architecture

### Language Server Pattern

This extension uses the **Language Server Protocol (LSP)** architecture with separate client and server processes:

- **Client** ([src/client/client.ts](src/client/client.ts)): Runs in the VS Code extension host
  - Creates and manages the LanguageClient connection
  - Registers commands (`tsqlrefine.run`)
  - Handles file lifecycle events (delete, rename)

- **Server** ([src/server/server.ts](src/server/server.ts)): Runs in a separate Node.js process
  - Manages document synchronization
  - Handles lint requests and diagnostics
  - Coordinates with the LintScheduler

This separation allows the linting logic to run independently without blocking the VS Code UI.

### Core Components

#### 1. LintScheduler ([src/server/lint/scheduler.ts](src/server/lint/scheduler.ts))

Manages concurrent lint execution with sophisticated queuing:
- **Semaphore-based concurrency control**: Limits to 4 concurrent lints (`maxConcurrentRuns`)
- **Smart queuing**: Queues pending lints when max concurrency is reached
- **Debouncing**: For "type" events (default 500ms), prevents excessive linting during typing
- **Version tracking**: Ensures lints run against the correct document version
- **Priority handling**: Manual lints (`reason: "manual"`) bypass debouncing and run immediately

The scheduler handles four lint reasons:
- `"save"`: Triggered on document save
- `"type"`: Triggered during typing (if `runOnType` is enabled)
- `"manual"`: Triggered by explicit commands
- `"open"`: Triggered when document is opened (if `runOnOpen` is enabled)

#### 2. TSQLRefine Runner ([src/server/lint/runTsqllint.ts](src/server/lint/runTsqllint.ts))

Executes the tsqlrefine CLI with proper process management:
- **Executable resolution**: Finds tsqlrefine via `settings.path` or PATH with caching (30s TTL)
- **Windows handling**: Wraps `.cmd`/`.bat` files with `cmd.exe /c`
- **Timeout protection**: Kills processes exceeding `settings.timeoutMs` (default 10s)
- **Cancellation support**: Respects AbortSignal for clean cancellation
- **Startup verification**: Verifies tsqlrefine installation at startup and on configuration changes

##### Startup Verification

The extension proactively verifies tsqlrefine installation using `verifyTsqllintInstallation()`:
- **When verification runs**:
  - At extension startup (after `onInitialized()` and `refreshSettings()`)
  - When `tsqlrefine.path` setting changes (detected in `onDidChangeConfiguration()`)
- **Non-blocking behavior**: Verification failures show warnings but do not prevent extension activation
- **User-facing messages**:
  - Not in PATH: "tsqlrefine not found. Set tsqlrefine.path or install tsqlrefine."
  - Invalid path: "tsqlrefine.path not found: /path/to/tsqlrefine"
  - Not a file: "tsqlrefine.path is not a file: /path/to/directory"
- **Cache reuse**: Leverages existing 30-second command resolution cache
- **Configuration change detection**: Only `tsqlrefine.path` changes trigger re-verification (other settings like `runOnSave`, `debounceMs` do not affect tsqlrefine availability)

#### 3. Output Parser ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts))

Parses tsqlrefine output into VS Code diagnostics:
- **Pattern**: `<file>(<line>,<col>): <severity> <rule> : <message>`
- **Range mode**: Always highlights entire line (fixed to "line" mode)
- **Path normalization**: Handles Windows case-insensitivity and path resolution
- **Temporary file support**: Maps temp file paths back to original URIs

#### 4. Document Lifecycle Management

The server tracks document state throughout its lifecycle:
- **Unsaved documents**: Creates temporary files in `os.tmpdir()` for linting
- **Version tracking**: Uses `savedVersionByUri` to distinguish saved vs modified states
- **Cleanup**: Removes temporary files and clears diagnostics on document close

### Data Flow

1. User edits SQL file or triggers command
2. Client sends request to server via LSP
3. Server's `LintScheduler` queues the lint request
4. When a slot is available, `runTsqllint()` spawns the CLI process
5. `parseOutput()` converts stdout to VS Code diagnostics
6. Server sends diagnostics back to client
7. Client displays squiggles and problems panel

## Configuration

The extension contributes these settings (namespace: `tsqlrefine`):

- `path`: Custom tsqlrefine executable path (default: searches PATH)
- `configPath`: TSQLRefine config file path (passed as `-c` argument)
- `runOnSave`: Auto-lint on save (default: true)
- `runOnType`: Lint while typing (default: false)
- `runOnOpen`: Auto-lint on open (default: true)
- `debounceMs`: Debounce delay for typing (default: 500)
- `timeoutMs`: Process timeout (default: 10000)

## Testing Strategy

Tests are organized into two categories under [src/test/](src/test/):

1. **Unit tests** ([src/test/unit/](src/test/unit/)): Test individual functions in isolation
   - [scheduler.test.ts](src/test/unit/scheduler.test.ts) - LintScheduler tests (21 test cases)
   - [decodeOutput.test.ts](src/test/unit/decodeOutput.test.ts) - Encoding detection tests (25 test cases)
   - [parseOutput.test.ts](src/test/unit/parseOutput.test.ts) - Output parser tests
   - [runTsqllint.test.ts](src/test/unit/runTsqllint.test.ts) - CLI runner tests
   - [handlers.test.ts](src/test/unit/handlers.test.ts) - File event handler tests

2. **E2E tests** ([src/test/e2e/](src/test/e2e/)): Test full integration with VS Code
   - [extension.test.ts](src/test/e2e/extension.test.ts) - Extension activation and commands
   - [localTsqllint.test.ts](src/test/e2e/localTsqllint.test.ts) - Real tsqlrefine CLI integration
   - [startup.test.ts](src/test/e2e/startup.test.ts) - Startup verification tests

3. **Test helpers** ([src/test/helpers/](src/test/helpers/)): Shared utilities
   - `fakeCli.ts` - Mock tsqlrefine CLI helper
   - `testFixtures.ts` - Reusable test data factories
   - `e2eTestHarness.ts` - E2E test setup/teardown automation
   - `testConstants.ts` - Centralized timeouts and constants
   - `cleanup.ts` - File system cleanup utilities

## Testing Architecture

### Test Organization

All tests are located under [src/test/](src/test/) with clear separation:

**Directory Structure:**
```
src/test/
├── unit/          # Unit tests (run with Mocha)
├── e2e/           # E2E tests (run with VS Code Test)
└── helpers/       # Shared test utilities
```

**Test Execution:**
- **Unit tests**: Run directly with Mocha (no VS Code instance needed)
- **E2E tests**: Run in a VS Code instance with the extension loaded

**Configuration Files:**
- [.mocharc.unit.json](.mocharc.unit.json) - Mocha configuration for unit tests
- [.vscode-test.mjs](.vscode-test.mjs) - VS Code Test configuration for E2E tests

### Writing E2E Tests

Use the test harness for all E2E tests:

```typescript
import { runE2ETest } from './helpers/e2eTestHarness';
import { TEST_TIMEOUTS, FAKE_CLI_RULES } from './helpers/testConstants';

test("my test", async function () {
  this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

  await runE2ETest(
    {
      fakeCliRule: FAKE_CLI_RULES.MY_RULE,
      config: { runOnSave: true },
      documentContent: 'select 1;',
    },
    async (context, harness) => {
      // Test implementation
      const diagnostics = await harness.waitForDiagnostics(
        context.document.uri,
        (entries) => entries.length >= 1
      );
      // Assertions...
    }
  );
});
```

### Test Constants

All timeouts, delays, and retry values are centralized in `testConstants.ts`:
- Use `TEST_TIMEOUTS.*` for timeout values
- Use `TEST_DELAYS.*` for sleep/delay values
- Use `RETRY_CONFIG.*` for retry attempts and delays
- Use `FAKE_CLI_RULES.*` for consistent rule names

### Best Practices

1. **Always use constants**: Never hardcode timeouts or delays
2. **Always use harness**: New E2E tests must use `runE2ETest()`
3. **Always use factories**: Don't create inline fakeCli scripts
4. **Document in CLAUDE.md**: Keep test architecture section updated

## Code Coverage

The project uses **c8** for code coverage reporting with the following targets:
- **Lines**: 50% (minimum)
- **Functions**: 80% (minimum)
- **Branches**: 75% (minimum)
- **Statements**: 50% (minimum)

Coverage configuration is in [.c8rc.json](.c8rc.json). Run tests with coverage:
```bash
npm run test:unit:coverage
```

Current coverage status:
- Overall: 52.73%
- Server/lint: 79.2%

Coverage reports are generated in `coverage/` directory with HTML report at `coverage/index.html`.

## Git Hooks and Automation

### Pre-commit Hooks

The project uses **Husky** to run pre-commit hooks automatically. Configuration in [.husky/pre-commit](.husky/pre-commit):

1. **lint-staged**: Auto-formats and lints staged TypeScript files
   - Runs `biome format --write` and `biome lint --fix` on `.ts` files
   - Runs `biome format --write` on `.json`, `.md`, `.yml` files
   - Configuration in `package.json` under `lint-staged`

2. **Type checking**: Runs on staged TypeScript files when `npm run typecheck` succeeds

Hooks are installed automatically with `npm install` via the `prepare` script.

### Dependency Management

The project uses **Dependabot** for automated dependency updates:
- Configuration in [.github/dependabot.yml](.github/dependabot.yml)
- **NPM dependencies**: Weekly updates (Monday 09:00 UTC)
  - Groups dev and production dependencies separately
  - Excludes major version updates
- **GitHub Actions**: Weekly updates (Monday UTC)

Pull requests created by Dependabot are labeled with `dependencies` and `automated`.

## Important Implementation Notes

### Windows Compatibility
- Always use `path.resolve()` and `path.normalize()` for file paths
- Use case-insensitive comparison on Windows (`normalizeForCompare()`)
- Wrap `.cmd`/.bat` executables with `cmd.exe /c`

### Concurrency and Cancellation
- The `LintScheduler` prevents resource exhaustion with its semaphore
- All lint operations support cancellation via AbortSignal
- In-flight requests are tracked in `inFlightByUri` map and cancelled when superseded

### Error Handling
- TSQLRefine errors go to stderr and are shown as warnings
- CLI spawn errors reject the promise and clear diagnostics

### TypeScript Configuration
This project uses strict TypeScript settings including:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- Always handle array access with optional chaining or default values
