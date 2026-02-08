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

- **lintOperations.ts**: Orchestrates lint execution with file size limiting and exit code handling
- **runLinter.ts**: Executes `tsqlrefine lint -q --output json --stdin` command
- **parseOutput.ts**: Parses CLI JSON output into VS Code diagnostics (0-based character-level ranges)
- **decodeOutput.ts**: Handles output encoding detection

##### File Size Limiting

The extension can skip automatic linting for large files:
- Controlled by `maxFileSizeKb` setting (0 = unlimited)
- Only affects automatic linting (save, type, open)
- Manual linting (`tsqlrefine.run`) bypasses the limit

#### 4. Format Operations ([src/server/format/](src/server/format/))

- **formatOperations.ts**: Orchestrates format execution with exit code handling
- **runFormatter.ts**: Executes `tsqlrefine format -q --stdin` command
- Returns `TextEdit[]` for full document replacement
- Supports separate timeout via `formatTimeoutMs` setting
- Uses shared utilities: `createFullDocumentEdit()`, `handleOperationError()`, `logOperationContext()`

#### 5. Fix Operations ([src/server/fix/](src/server/fix/))

- **fixOperations.ts**: Orchestrates fix execution with exit code handling
- **runFixer.ts**: Executes `tsqlrefine fix -q --stdin` command with `--severity` flag
- Returns `TextEdit[]` for document modification
- Integrated with Code Action provider for quick fixes
- Uses shared utilities: `createFullDocumentEdit()`, `handleOperationError()`, `logOperationContext()`

#### 6. Output Parser ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts))

Parses tsqlrefine JSON output (`--output json`) into VS Code diagnostics:
- **JSON format**: Parses `LintResult` with `files[].diagnostics[]` structure
- **0-based positions**: Line and character positions from JSON are used directly (no conversion)
- **Character-level ranges**: Uses exact `range.start`/`range.end` from JSON (not full-line highlighting)
- **Path normalization**: Handles Windows case-insensitivity and `<stdin>` path mapping
- **Fixable detection**: Reads `data.fixable` boolean from each diagnostic

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
- **Error detection**: `isMissingTsqlRefineError()` detects missing installation

#### SettingsManager ([src/server/state/settingsManager.ts](src/server/state/settingsManager.ts))

Settings retrieval and normalization:
- **Global settings**: Cached settings for all documents
- **Document-scoped settings**: Per-document settings via LSP
- **Validation**: Normalizes maxFileSizeKb values

### Shared Utilities

Located in [src/server/shared/](src/server/shared/):

- **documentContext.ts**: Creates unified `DocumentContext` with paths, settings, and document state
- **documentEdit.ts**: `createFullDocumentEdit()` - Creates TextEdit for full document replacement
- **errorHandling.ts**: `handleOperationError()` - Standardized error handling for format/fix operations
- **logging.ts**: `logOperationContext()` - Consistent operation logging
- **textUtils.ts**: `firstLine()`, `resolveTargetFilePath()` - Text processing utilities
- **processRunner.ts**: Command resolution and process execution
- **normalize.ts**: Path and config normalization utilities
- **types.ts**: Shared type definitions (`ProcessRunResult`, `BaseProcessOptions`)

### Configuration Constants

Centralized in [src/server/config/constants.ts](src/server/config/constants.ts):
- `COMMAND_CACHE_TTL_MS = 30000` - Command availability cache TTL
- `COMMAND_CHECK_TIMEOUT_MS = 3000` - Timeout for `--version` check
- `CONFIG_CACHE_TTL_MS = 5000` - Config file resolution cache TTL
- `CONFIG_CACHE_MAX_SIZE = 100` - Maximum entries in config path cache
- `MAX_CONCURRENT_RUNS = 4` - Maximum concurrent lint operations
- `MISSING_TSQLREFINE_NOTICE_COOLDOWN_MS = 300000` - 5-minute notification cooldown
- `DEFAULT_COMMAND_NAME = "tsqlrefine"` - Default executable name
- `CLI_EXIT_CODE_DESCRIPTIONS` - Human-readable descriptions for CLI exit codes (2=parse error, 3=config error, 4=runtime exception)

### Data Flow

#### Linting
1. User edits SQL file or triggers command
2. Client sends request to server via LSP
3. Server's `LintScheduler` queues the lint request
4. When a slot is available, `runLinter()` spawns CLI with `lint -q --output json --stdin`
5. Exit code is checked: 0/1 = success (parse stdout), 2/3/4 = error (show warning)
6. `parseOutput()` parses JSON stdout into VS Code diagnostics with character-level ranges
7. Server sends diagnostics back to client
8. Client displays squiggles and problems panel

#### Formatting
1. User triggers format (command or editor action)
2. Server receives `onDocumentFormatting` request
3. `runFormatter()` spawns CLI with `format -q --stdin`
4. Exit code is checked: 0 = success, non-zero = error with specific description
5. Returns `TextEdit[]` for full document replacement

#### Fixing
1. User triggers fix command or selects code action
2. Server executes `runFixer()` with `fix -q --stdin --severity`
3. Exit code is checked: 0 = success, non-zero = error with specific description
4. Returns `TextEdit[]` applied via workspace edit

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
| `enableLint` | boolean | true | Enable linting functionality |
| `enableFormat` | boolean | true | Enable formatting functionality |
| `enableFix` | boolean | true | Enable auto-fix functionality |

### Settings Type Definition

```typescript
type TsqlRefineSettings = {
  path?: string;
  configPath?: string;
  runOnSave: boolean;
  runOnType: boolean;
  runOnOpen: boolean;
  debounceMs: number;
  timeoutMs: number;
  maxFileSizeKb: number;
  minSeverity: "error" | "warning" | "info" | "hint";
  formatTimeoutMs?: number;
  enableLint: boolean;
  enableFormat: boolean;
  enableFix: boolean;
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
   - [lintOperations.test.ts](src/test/unit/lintOperations.test.ts) - Lint operations tests
   - [formatOperations.test.ts](src/test/unit/formatOperations.test.ts) - Format operations tests
   - [fixOperations.test.ts](src/test/unit/fixOperations.test.ts) - Fix operations tests
   - [runFixer.test.ts](src/test/unit/runFixer.test.ts) - Fixer CLI runner tests
   - [resolveConfigPath.test.ts](src/test/unit/resolveConfigPath.test.ts) - Config resolution tests
   - [documentEdit.test.ts](src/test/unit/documentEdit.test.ts) - Document edit utility tests
   - [textUtils.test.ts](src/test/unit/textUtils.test.ts) - Text utility tests
   - [normalize.test.ts](src/test/unit/normalize.test.ts) - Path normalization tests
   - [settingsManager.test.ts](src/test/unit/settingsManager.test.ts) - Settings manager tests
   - [notificationManager.test.ts](src/test/unit/notificationManager.test.ts) - Notification manager tests

2. **E2E tests** ([src/test/e2e/](src/test/e2e/)): Test full integration with VS Code
   - [extension.test.ts](src/test/e2e/extension.test.ts) - Extension activation and commands
   - [runLinter.test.ts](src/test/e2e/runLinter.test.ts) - Linter CLI integration
   - [localTsqlRefine.test.ts](src/test/e2e/localTsqlRefine.test.ts) - Real tsqlrefine CLI integration
   - [startup.test.ts](src/test/e2e/startup.test.ts) - Startup verification tests
   - [formatter.test.ts](src/test/e2e/formatter.test.ts) - Formatter E2E tests
   - [fix.test.ts](src/test/e2e/fix.test.ts) - Fix command and code action tests

3. **Test helpers** ([src/test/helpers/](src/test/helpers/)): Shared utilities
   - `testFixtures.ts` - Reusable test data factories
   - `e2eTestHarness.ts` - E2E test setup/teardown automation
   - `testConstants.ts` - Centralized timeouts and constants
   - `cleanup.ts` - File system cleanup utilities
   - `arbitraries.ts` - Custom fast-check arbitraries for property-based testing

## Property-Based Testing with fast-check

The project uses **fast-check** for property-based testing (PBT) to complement example-based tests. Property-based testing automatically generates hundreds of test cases and verifies that certain properties (invariants) hold true for all inputs.

### Philosophy

- **Example-based tests**: Verify specific, known edge cases and behaviors (e.g., "empty string returns empty string")
- **Property-based tests**: Verify general invariants that should hold for all inputs (e.g., "function is idempotent")

Both approaches are valuable and complementary:
- Example-based tests document specific requirements and edge cases
- Property-based tests catch unexpected edge cases and verify mathematical properties

### Integration with Unit Tests

PBT tests are integrated into existing unit test files under `suite("Property-based tests")` blocks:

```typescript
import * as fc from "fast-check";

suite("functionName", () => {
  // Existing example-based tests
  suite("Example-based tests", () => {
    test("handles empty string", () => {
      assert.strictEqual(fn(""), "");
    });
    test("handles unicode", () => {
      assert.strictEqual(fn("日本語"), "日本語");
    });
  });

  // NEW: Property-based tests
  suite("Property-based tests", () => {
    test("property: idempotence", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          return fn(fn(input)) === fn(input);
        })
      );
    });

    test("property: never returns empty string", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const result = fn(input);
          return result.length > 0;
        })
      );
    });
  });
});
```

### Custom Arbitraries

Reusable arbitraries are defined in [src/test/helpers/arbitraries.ts](src/test/helpers/arbitraries.ts):

| Arbitrary | Description | Example Output |
|-----------|-------------|----------------|
| `platformPath` | Platform-appropriate file paths (Windows/Unix) | `"C:\foo\bar.sql"` or `"/foo/bar.sql"` |
| `unixPath` | Unix-style file paths | `"/usr/local/bin/tsqlrefine"` |
| `windowsPath` | Windows-style file paths | `"C:\Program Files\tsqlrefine.exe"` |
| `whitespace` | Whitespace-only strings | `"   \t\n"` |
| `paddedString` | Strings with leading/trailing whitespace | `"  content  "` |
| `textWithLineEndings` | Multiline text with various line endings | `"line1\r\nline2\nline3"` |
| `utf8BufferWithOptionalBom` | Buffers with/without UTF-8 BOM | `Buffer<0xEF 0xBB 0xBF ...>` |
| `cliDiagnostic` | Valid CLI diagnostic JSON structure | `{ range: {...}, severity: 2, message: "..." }` |
| `cliJsonOutput` | Valid CLI JSON output structure | `{ tool: "tsqlrefine", files: [...] }` |

**Usage example:**
```typescript
import { platformPath, textWithLineEndings } from "../helpers/arbitraries";

test("property: handles all path formats", () => {
  fc.assert(
    fc.property(platformPath, (path) => {
      const result = normalizePath(path);
      return result.length > 0;
    })
  );
});
```

### Modules with PBT Coverage

The following modules have property-based tests in addition to example-based tests:

1. **[textUtils.ts](src/server/shared/textUtils.ts)** - String manipulation
   - `firstLine()`: Idempotence, no newlines in output, prefix preservation, length constraints
   - `resolveTargetFilePath()`: Identity for non-empty, fallback for empty, never returns empty

2. **[normalize.ts](src/server/shared/normalize.ts)** - Path normalization
   - `normalizeForCompare()`: Idempotence, always absolute path, platform-specific case folding
   - `normalizeExecutablePath()`: Null for whitespace-only, absolute when non-null, trimming equivalence
   - `normalizeConfigPath()`: Trimming only (no resolution), preserves relative paths

3. **[decodeOutput.ts](src/server/lint/decodeOutput.ts)** - Encoding and line endings
   - `decodeCliOutput()`: Round-trip for UTF-8, BOM removal, length monotonicity
   - `normalizeLineEndings()`: Idempotence, LF mode has no `\r`, CRLF mode has no lone `\n` or `\r`, content preservation

4. **[parseOutput.ts](src/server/lint/parseOutput.ts)** - JSON parsing
   - `parseOutput()`: Malformed JSON handling, severity defaults, all diagnostics have source, stdin mapping, path filtering

### Running PBT Tests

Property-based tests run automatically with the regular unit test suite:

```bash
npm run test:unit              # Runs all unit tests (example-based + PBT)
npm run test:unit:coverage     # With coverage reporting
```

**Default configuration:**
- Each property runs **100 test cases** by default (configurable via `numRuns`)
- Failed tests are automatically **shrunk** to minimal counterexamples
- Tests are **deterministic** when using explicit seeds

### Debugging Failed Properties

When fast-check finds a counterexample, it automatically shrinks the input to the simplest failing case:

```
Error: Property failed after 42 tests
{ seed: -1234567890, path: "0:0:0", endOnFailure: true }
Counterexample: [""]
Shrunk 15 time(s)
Got error: AssertionError [ERR_ASSERTION]: Expected values to be strictly equal
```

**To reproduce the exact failure:**
```typescript
fc.assert(
  fc.property(fc.string(), (input) => {
    // ... property test
  }),
  { seed: -1234567890 }  // Use seed from error message
);
```

**To debug with verbose output:**
```typescript
fc.assert(
  fc.property(fc.string(), (input) => {
    // ... property test
  }),
  { verbose: true }  // Prints all generated values
);
```

### Best Practices

1. **Use specific arbitraries**: Prefer constrained arbitraries over generic ones
   ```typescript
   // Good: Specific constraint
   fc.property(fc.string({ minLength: 1 }), ...)

   // Less ideal: Too broad
   fc.property(fc.string(), ...)
   ```

2. **Test one property per test**: Makes failures easier to diagnose
   ```typescript
   // Good: One clear property
   test("property: idempotence", () => {
     fc.assert(fc.property(fc.string(), (s) => fn(fn(s)) === fn(s)));
   });

   // Avoid: Multiple properties in one test
   test("properties", () => {
     fc.assert(fc.property(fc.string(), (s) =>
       fn(fn(s)) === fn(s) && fn(s).length <= s.length  // Hard to debug
     ));
   });
   ```

3. **Use preconditions when needed**: Filter out invalid inputs with `fc.pre()`
   ```typescript
   fc.assert(
     fc.property(fc.string(), (path) => {
       fc.pre(path.trim() !== "");  // Skip empty/whitespace strings
       const result = normalizePath(path);
       return result !== null;
     })
   );
   ```

4. **Set appropriate test counts**: 100 is good for most cases; use 200-1000 for critical paths
   ```typescript
   fc.assert(
     fc.property(cliJsonOutput, (json) => { /* ... */ }),
     { numRuns: 500 }  // More tests for complex input
   );
   ```

5. **Combine with example-based tests**: PBT doesn't replace examples
   - Use examples for known edge cases and documentation
   - Use properties for exhaustive validation and mathematical invariants

6. **Document non-obvious properties**: Add comments explaining why a property should hold
   ```typescript
   test("property: content preservation (excluding line endings)", () => {
     // When normalizing line endings, only \r, \n, \r\n should change
     // All other characters must be preserved exactly
     fc.assert(fc.property(...));
   });
   ```

### Platform-Specific Testing

Some properties depend on the platform. Use conditional tests:

```typescript
if (process.platform === "win32") {
  test("property: case folding on Windows", () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const upper = normalize(path.toUpperCase());
        const lower = normalize(path.toLowerCase());
        return upper === lower;
      })
    );
  });
} else {
  test("property: case preservation on Unix", () => {
    // Unix-specific property
  });
}
```

### Common Property Patterns

**Idempotence:**
```typescript
test("property: idempotence", () => {
  fc.assert(fc.property(arbitrary, (input) => {
    const once = fn(input);
    const twice = fn(once);
    return once === twice;
  }));
});
```

**Round-trip:**
```typescript
test("property: encode/decode round-trip", () => {
  fc.assert(fc.property(fc.string(), (text) => {
    return decode(encode(text)) === text;
  }));
});
```

**Monotonicity:**
```typescript
test("property: output length <= input length", () => {
  fc.assert(fc.property(fc.string(), (input) => {
    return fn(input).length <= input.length;
  }));
});
```

**Invariant preservation:**
```typescript
test("property: never contains forbidden characters", () => {
  fc.assert(fc.property(fc.string(), (input) => {
    const result = sanitize(input);
    return !result.includes("<script>");
  }));
});
```

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
- Wrap `.cmd`/`.bat` executables with `cmd.exe /c`

### Concurrency and Cancellation
- The `LintScheduler` prevents resource exhaustion with its semaphore
- All operations (lint, format, fix) support cancellation via AbortSignal
- In-flight requests are tracked in separate `DocumentStateManager` instances
- Superseded operations are automatically cancelled

### Stdin-based CLI Invocation
- All operations use `--stdin` flag instead of temporary files
- All operations use `-q` (quiet) flag to suppress informational stderr output
- Lint uses `--output json` for structured JSON diagnostics; format/fix use text output (stdout = SQL text)
- Document content is piped to the CLI process as UTF-8
- Output paths containing `<stdin>` are mapped back to original URIs

### CLI Exit Codes
- `0`: Success (no violations, or format/fix succeeded)
- `1`: Rule violations found (lint only; treated as success, diagnostics parsed from stdout)
- `2`: Parse error (SQL could not be parsed)
- `3`: Configuration error (config file load failure, invalid settings)
- `4`: Runtime exception (internal error)

For lint: exit codes 0 and 1 are success (stdout is parsed). Exit codes >= 2 are errors.
For format/fix: only exit code 0 is success (stdout contains formatted/fixed SQL).

### Error Handling
- With `-q`, stderr is normally empty; only error messages (config errors, "No input") are emitted
- CLI spawn errors reject the promise and clear diagnostics
- Missing installation errors trigger notification with install guide link
- Notification cooldown prevents spamming (5-minute cooldown)
- Shared `handleOperationError()` provides consistent error handling for format/fix
- `CLI_EXIT_CODE_DESCRIPTIONS` provides specific error messages per exit code

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
  effectiveSettings: TsqlRefineSettings;
  effectiveConfigPath: string | undefined;
  documentText: string;
  isSavedFile: boolean;
};
```
