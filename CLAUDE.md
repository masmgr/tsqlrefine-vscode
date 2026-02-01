# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `tsqlrefine`, a VS Code extension that integrates TSQLRefine (a T-SQL linter, formatter, and fixer) into the editor. It provides real-time linting, document formatting, and auto-fixing for SQL files with support for both manual and automatic operations.

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
npm run verify           # Run all checks (test + typecheck + lint + format)
```

### Testing
```bash
npm run test:unit        # Run unit tests with Mocha
npm run test:unit:coverage  # Run unit tests with c8 coverage reporting
npm run test:coverage    # Run tests with coverage (alias for test:unit:coverage)
npm run test:e2e         # Run E2E tests with VS Code Test
npm test                 # Run unit tests
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

- **Client** ([src/extension.ts](src/extension.ts), [src/client/](src/client/)): Runs in the VS Code extension host
  - Creates and manages the LanguageClient connection
  - Registers commands (`tsqlrefine.run`, `tsqlrefine.format`, `tsqlrefine.fix`, `tsqlrefine.openInstallGuide`)
  - Handles file lifecycle events (delete, rename)

- **Server** ([src/server/server.ts](src/server/server.ts)): Runs in a separate Node.js process
  - Manages document synchronization
  - Handles lint, format, and fix operations
  - Provides code actions (quick fixes)
  - Coordinates with the LintScheduler

This separation allows the linting/formatting logic to run independently without blocking the VS Code UI.

### Core Components

#### 1. LintScheduler ([src/server/lint/scheduler.ts](src/server/lint/scheduler.ts))

Manages concurrent lint execution with sophisticated queuing:
- **Semaphore-based concurrency control**: Limits to 4 concurrent lints (`MAX_CONCURRENT_RUNS`)
- **Smart queuing**: Queues pending lints when max concurrency is reached
- **Debouncing**: For "type" events (default 500ms), prevents excessive linting during typing
- **Version tracking**: Ensures lints run against the correct document version
- **Priority handling**: Manual lints (`reason: "manual"`) bypass debouncing and run immediately

The scheduler handles four lint reasons:
- `"save"`: Triggered on document save
- `"type"`: Triggered during typing (if `runOnType` is enabled)
- `"manual"`: Triggered by explicit commands
- `"open"`: Triggered when document is opened (if `runOnOpen` is enabled)

#### 2. Process Runner ([src/server/shared/processRunner.ts](src/server/shared/processRunner.ts))

Shared infrastructure for executing CLI commands (lint, format, fix):
- **Command resolution**: Finds tsqlrefine via `settings.path` or PATH with caching (30s TTL)
- **Installation verification**: `verifyInstallation()` checks if tsqlrefine is available
- **Process execution**: `runProcess()` handles timeout, cancellation, and output capture
- **Path validation**: `assertPathExists()` validates configured executable paths
- **UTF-8 encoding**: All stdin/stdout uses UTF-8 encoding

#### 3. Lint Operations ([src/server/lint/](src/server/lint/))

- **lintOperations.ts**: Orchestrates lint execution with file size limiting
- **runTsqllint.ts**: Executes `tsqlrefine lint --stdin` command
- **parseOutput.ts**: Parses CLI output into VS Code diagnostics
- **decodeOutput.ts**: Handles output encoding detection and line ending normalization

##### File Size Limiting

The extension can skip automatic linting for large files:
- Controlled by `maxFileSizeKb` setting (0 = unlimited)
- Only affects automatic linting (save, type, open)
- Manual linting (`tsqlrefine.run`) bypasses the limit

#### 4. Format Operations ([src/server/format/](src/server/format/))

- **formatOperations.ts**: Orchestrates format execution
- **runFormatter.ts**: Executes `tsqlrefine format --stdin` command
- Returns `TextEdit[]` for full document replacement
- Supports separate timeout via `formatTimeoutMs` setting

#### 5. Fix Operations ([src/server/fix/](src/server/fix/))

- **fixOperations.ts**: Orchestrates fix execution
- **runFixer.ts**: Executes `tsqlrefine fix --stdin` command
- Returns `TextEdit[]` for document modification
- Integrated with Code Action provider for quick fixes

#### 6. Output Parser ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts))

Parses tsqlrefine output into VS Code diagnostics:
- **Pattern**: `<file>(<line>,<col>): <severity> <rule> : <message>`
- **Range mode**: Supports "character" (default) or "line" highlighting
- **Path normalization**: Handles Windows case-insensitivity and stdin path mapping
- **Line ending normalization**: Matches document's EOL (CRLF/LF)

### State Management

The server uses three specialized managers under [src/server/state/](src/server/state/):

#### DocumentStateManager ([src/server/state/documentStateManager.ts](src/server/state/documentStateManager.ts))

Manages per-document state:
- **In-flight tracking**: Tracks running operations with AbortController
- **Saved version tracking**: Distinguishes saved vs modified documents
- **Cancellation support**: Cancels superseded operations

Three independent instances are used for lint, format, and fix operations.

#### NotificationManager ([src/server/state/notificationManager.ts](src/server/state/notificationManager.ts))

Centralized user notification management:
- **Cooldown support**: Missing tsqlrefine notification has 5-minute cooldown
- **Install guide integration**: Offers to open installation guide
- **Error detection**: `isMissingTsqllintError()` detects missing installation

#### SettingsManager ([src/server/state/settingsManager.ts](src/server/state/settingsManager.ts))

Settings retrieval and normalization:
- **Global settings**: Cached settings for all documents
- **Document-scoped settings**: Per-document settings via LSP
- **Validation**: Normalizes rangeMode and maxFileSizeKb values

### Shared Utilities

Located in [src/server/shared/](src/server/shared/):

- **documentContext.ts**: Creates unified `DocumentContext` with paths, settings, and document state
- **processRunner.ts**: Command resolution and process execution
- **normalize.ts**: Path and config normalization utilities
- **types.ts**: Shared type definitions (`ProcessRunResult`, `BaseProcessOptions`)

### Configuration Constants

Centralized in [src/server/config/constants.ts](src/server/config/constants.ts):
- `COMMAND_CACHE_TTL_MS = 30000` - Command availability cache TTL
- `COMMAND_CHECK_TIMEOUT_MS = 3000` - Timeout for `--version` check
- `CONFIG_CACHE_TTL_MS = 5000` - Config file resolution cache TTL
- `MAX_CONCURRENT_RUNS = 4` - Maximum concurrent lint operations
- `MISSING_TSQLLINT_NOTICE_COOLDOWN_MS = 300000` - 5-minute notification cooldown

### Data Flow

#### Linting
1. User edits SQL file or triggers command
2. Client sends request to server via LSP
3. Server's `LintScheduler` queues the lint request
4. When a slot is available, `runTsqllint()` spawns CLI with `--stdin`
5. `parseOutput()` converts stdout to VS Code diagnostics
6. Server sends diagnostics back to client
7. Client displays squiggles and problems panel

#### Formatting
1. User triggers format (command or editor action)
2. Server receives `onDocumentFormatting` request
3. `runFormatter()` spawns CLI with `format --stdin`
4. Returns `TextEdit[]` for full document replacement

#### Fixing
1. User triggers fix command or selects code action
2. Server executes `runFixer()` with `fix --stdin`
3. Returns `TextEdit[]` applied via workspace edit

### Code Action Provider

The server provides quick fixes via LSP code actions:
- **Trigger**: When tsqlrefine diagnostics exist in the document
- **Action**: "Fix all tsqlrefine issues"
- **Kind**: `CodeActionKind.QuickFix`
- **Implementation**: Executes fix operation and returns `WorkspaceEdit`

## Configuration

The extension contributes these settings (namespace: `tsqlrefine`):

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `path` | string | "" | Custom tsqlrefine executable path (default: searches PATH) |
| `configPath` | string | "" | TSQLRefine config file path (passed as `-c` argument) |
| `runOnSave` | boolean | true | Auto-lint on save |
| `runOnType` | boolean | false | Lint while typing (debounced) |
| `runOnOpen` | boolean | true | Auto-lint on open |
| `debounceMs` | number | 500 | Debounce delay for typing |
| `timeoutMs` | number | 10000 | Process timeout for lint |
| `maxFileSizeKb` | number | 0 | Maximum file size (KB) for automatic linting (0 = unlimited) |
| `minSeverity` | string | "info" | Minimum severity level for lint diagnostics (error/warning/info/hint) |
| `formatTimeoutMs` | number | 10000 | Process timeout for format |

### Settings Type Definition

```typescript
type TsqllintSettings = {
  path?: string;
  configPath?: string;
  runOnSave: boolean;
  runOnType: boolean;
  runOnOpen: boolean;
  debounceMs: number;
  timeoutMs: number;
  maxFileSizeKb: number;
  minSeverity: "error" | "warning" | "info" | "hint";
  rangeMode: "character" | "line";
  formatTimeoutMs?: number;
};
```

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `tsqlrefine.run` | TSQLRefine: Run | Manually lint the active document |
| `tsqlrefine.format` | TSQLRefine: Format | Format the active document |
| `tsqlrefine.fix` | TSQLRefine: Fix | Apply auto-fixes to the active document |
| `tsqlrefine.openInstallGuide` | TSQLRefine: Open Install Guide | Open installation guide URL |

## Testing Strategy

Tests are organized into two categories under [src/test/](src/test/):

1. **Unit tests** ([src/test/unit/](src/test/unit/)): Test individual functions in isolation
   - [scheduler.test.ts](src/test/unit/scheduler.test.ts) - LintScheduler tests
   - [decodeOutput.test.ts](src/test/unit/decodeOutput.test.ts) - Encoding detection tests
   - [parseOutput.test.ts](src/test/unit/parseOutput.test.ts) - Output parser tests
   - [handlers.test.ts](src/test/unit/handlers.test.ts) - File event handler tests
   - [fixOperations.test.ts](src/test/unit/fixOperations.test.ts) - Fix operations tests
   - [runFixer.test.ts](src/test/unit/runFixer.test.ts) - Fixer CLI runner tests
   - [resolveConfigPath.test.ts](src/test/unit/resolveConfigPath.test.ts) - Config resolution tests

2. **E2E tests** ([src/test/e2e/](src/test/e2e/)): Test full integration with VS Code
   - [extension.test.ts](src/test/e2e/extension.test.ts) - Extension activation and commands
   - [localTsqllint.test.ts](src/test/e2e/localTsqllint.test.ts) - Real tsqlrefine CLI integration
   - [startup.test.ts](src/test/e2e/startup.test.ts) - Startup verification tests
   - [formatter.test.ts](src/test/e2e/formatter.test.ts) - Formatter E2E tests
   - [fix.test.ts](src/test/e2e/fix.test.ts) - Fix command and code action tests

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

Coverage reports are generated in `coverage/` directory with HTML report at `coverage/index.html`.

## Git Hooks and Automation

### Pre-commit Hooks

The project uses **Husky** to run pre-commit hooks automatically. Configuration in [.husky/pre-commit](.husky/pre-commit):

1. **lint-staged**: Auto-formats and lints staged TypeScript files
   - Runs `biome format --write` and `biome lint --fix` on `.ts` files
   - Runs `biome format --write` on `.json` files
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
- All operations (lint, format, fix) support cancellation via AbortSignal
- In-flight requests are tracked in separate `DocumentStateManager` instances
- Superseded operations are automatically cancelled

### Stdin-based CLI Invocation
- All operations use `--stdin` flag instead of temporary files
- Document content is piped to the CLI process as UTF-8
- Output paths containing `<stdin>` are mapped back to original URIs

### Error Handling
- TSQLRefine errors go to stderr and are shown as warnings
- CLI spawn errors reject the promise and clear diagnostics
- Missing installation errors trigger notification with install guide link
- Notification cooldown prevents spamming (5-minute cooldown)

### TypeScript Configuration
This project uses strict TypeScript settings including:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- Always handle array access with optional chaining or default values

### Operation Dependencies Pattern

All operations use a consistent dependency injection pattern:
```typescript
type OperationDeps = {
  connection: Connection;
  notificationManager: NotificationManager;
  stateManager: DocumentStateManager;
};
```

### DocumentContext Pattern

Operations receive a unified context object:
```typescript
type DocumentContext = {
  uri: string;
  filePath: string;
  workspaceRoot: string | null;
  cwd: string;
  effectiveSettings: TsqllintSettings;
  effectiveConfigPath: string | undefined;
  documentText: string;
  isSavedFile: boolean;
};
```
