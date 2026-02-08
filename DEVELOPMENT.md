# Development Guide

This document provides guidance for developers working on the tsqlrefine VS Code extension.

## Project Overview

**tsqlrefine** is a VS Code extension that integrates [TSQLRefine](https://github.com/masmgr/tsqlrefine) into the editor. It provides real-time linting, formatting, and auto-fixing for T-SQL files with support for both manual and automatic operations using a Language Server Protocol (LSP) architecture.

**Note**: This project was built from scratch and is not forked from [tsqlrefine-vscode-extension](https://github.com/tsqlrefine/tsqlrefine-vscode-extension). The codebase is independently developed to support the latest TSQLRefine versions and LSP architecture.

## Prerequisites

- **Node.js**: v24 or later
- **npm**: v11 or later
- **VS Code**: v1.108.1 or later
- **TypeScript**: Managed via npm

## Setup

1. Clone the repository:
```bash
git clone https://github.com/masmgr/tsqlrefine-vscode.git
cd tsqlrefine-vscode
```

2. Install dependencies:
```bash
npm install
```

3. Verify setup:
```bash
npm run typecheck
```

## Build and Development Commands

### Development Build
```bash
npm run build              # Bundle extension/server to dist/ with esbuild
npm run watch             # Watch mode for development (esbuild)
npm run compile           # Compile TypeScript to out/ (for tests)
npm run typecheck         # Type-check without emitting
```

### Code Quality
```bash
npm run lint              # Lint with Biome
npm run format            # Format with Biome
npm run verify            # Run all checks (test + typecheck + lint + format)
```

### Testing
```bash
npm test                    # Run unit tests
npm run test:unit          # Run unit tests with Mocha
npm run test:unit:coverage # Run unit tests with c8 coverage reporting
npm run test:coverage      # Alias for test:unit:coverage
npm run test:e2e           # Run E2E tests
```

**Note**: The test scripts run both `npm run build` (to bundle extension code to `dist/`) and `npm run compile` (to compile test files to `out/`). This is necessary because VS Code loads the extension from `dist/extension.js` while the test runner executes tests from `out/test/**/*.test.js`.

**Code Coverage**: Unit tests are run with c8 coverage. Targets are 50% lines, 80% functions, 75% branches. Use `npm run test:unit:coverage` to generate reports in `coverage/`.

### Publishing
```bash
npm run package           # Create VSIX package
npm run vscode:prepublish # Production build with optimizations
```

## Project Structure

```
tsqlrefine-vscode/
├── src/
│   ├── extension.ts               # VS Code activation entry point
│   ├── client/
│   │   ├── client.ts              # LSP client creation and configuration
│   │   └── handlers.ts            # File lifecycle event handlers (delete, rename)
│   ├── server/
│   │   ├── server.ts              # LSP server process
│   │   ├── config/
│   │   │   ├── constants.ts       # Centralized configuration constants
│   │   │   ├── resolveConfigPath.ts # Config file path resolution with caching
│   │   │   └── settings.ts        # Settings type definitions
│   │   ├── lint/
│   │   │   ├── scheduler.ts       # Concurrency-controlled lint scheduler
│   │   │   ├── lintOperations.ts  # Lint orchestration and exit code handling
│   │   │   ├── runLinter.ts       # CLI executor for `tsqlrefine lint`
│   │   │   ├── parseOutput.ts     # JSON output parser to VS Code diagnostics
│   │   │   └── decodeOutput.ts    # Output encoding detection
│   │   ├── format/
│   │   │   ├── formatOperations.ts # Format orchestration and exit code handling
│   │   │   └── runFormatter.ts    # CLI executor for `tsqlrefine format`
│   │   ├── fix/
│   │   │   ├── fixOperations.ts   # Fix orchestration and exit code handling
│   │   │   └── runFixer.ts        # CLI executor for `tsqlrefine fix`
│   │   ├── shared/
│   │   │   ├── documentContext.ts  # Unified DocumentContext creation
│   │   │   ├── documentEdit.ts    # Full document TextEdit creation
│   │   │   ├── errorHandling.ts   # Shared error handling for format/fix
│   │   │   ├── logging.ts         # Consistent operation logging
│   │   │   ├── normalize.ts       # Path and config normalization
│   │   │   ├── processRunner.ts   # Command resolution and process execution
│   │   │   ├── textUtils.ts       # Text processing utilities
│   │   │   └── types.ts           # Shared type definitions
│   │   └── state/
│   │       ├── documentStateManager.ts # Per-document state and cancellation
│   │       ├── notificationManager.ts  # User notification with cooldown
│   │       └── settingsManager.ts      # Settings retrieval and caching
│   └── test/
│       ├── unit/                  # Unit tests (run with Mocha)
│       ├── e2e/                   # E2E tests (run with VS Code Test)
│       └── helpers/               # Shared test utilities
├── dist/                          # Bundled extension (generated)
├── out/                           # Compiled test files (generated)
├── esbuild.mjs                    # Build configuration
├── tsconfig.json                  # TypeScript configuration
├── tsconfig.test.json             # TypeScript configuration for tests
├── package.json                   # Project metadata and scripts
├── CLAUDE.md                      # Claude Code AI assistant instructions
├── DEVELOPMENT.md                 # This file
└── README.md                      # User-facing documentation
```

## Architecture

### Language Server Protocol Pattern

This extension uses the **Language Server Protocol (LSP)** architecture with separate client and server processes:

- **Client** ([src/client/client.ts](src/client/client.ts)): Runs in the VS Code extension host
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

#### 3. Lint Runner ([src/server/lint/runLinter.ts](src/server/lint/runLinter.ts))

Executes `tsqlrefine lint -q --output json --stdin` with `--severity` flag for filtering.

#### 4. Format Runner ([src/server/format/runFormatter.ts](src/server/format/runFormatter.ts))

Executes `tsqlrefine format -q --stdin`. Returns formatted SQL text on stdout.
Supports separate timeout via `formatTimeoutMs` setting.

#### 5. Fix Runner ([src/server/fix/runFixer.ts](src/server/fix/runFixer.ts))

Executes `tsqlrefine fix -q --stdin --severity`. Returns fixed SQL text on stdout.
Integrated with Code Action provider for quick fixes.

#### 6. Output Parser ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts))

Parses tsqlrefine JSON output (`--output json`) into VS Code diagnostics:
- **JSON format**: Parses `LintResult` with `files[].diagnostics[]` structure
- **0-based positions**: Line and character positions from JSON are used directly (no conversion)
- **Character-level ranges**: Uses exact `range.start`/`range.end` from JSON (not full-line highlighting)
- **Path normalization**: Handles Windows case-insensitivity and `<stdin>` path mapping
- **Fixable detection**: Reads `data.fixable` boolean from each diagnostic

#### 7. State Management

The server uses three specialized managers under [src/server/state/](src/server/state/):

- **DocumentStateManager** ([src/server/state/documentStateManager.ts](src/server/state/documentStateManager.ts)): Manages per-document state with in-flight tracking (AbortController), saved version tracking, and cancellation support. Three independent instances are used for lint, format, and fix operations.

- **NotificationManager** ([src/server/state/notificationManager.ts](src/server/state/notificationManager.ts)): Centralized user notification management with cooldown support (5-minute cooldown for missing tsqlrefine), install guide integration, and error detection.

- **SettingsManager** ([src/server/state/settingsManager.ts](src/server/state/settingsManager.ts)): Settings retrieval and normalization with global caching and per-document settings via LSP.

#### 8. Code Action Provider

The server provides quick fixes via LSP code actions:
- **Trigger**: When tsqlrefine diagnostics with `data.fixable = true` exist in the document
- **Action**: "Fix all tsqlrefine issues"
- **Kind**: `CodeActionKind.QuickFix`
- **Implementation**: Executes fix operation and returns `WorkspaceEdit`

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
5. Lint is re-run automatically to update diagnostics

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

## Testing Strategy

Tests are organized into two main categories under [src/test/](src/test/) with comprehensive coverage:

1. **Unit tests** ([src/test/unit/](src/test/unit/)): Test individual functions in isolation
   - [scheduler.test.ts](src/test/unit/scheduler.test.ts) - LintScheduler concurrency, debouncing, queue management
   - [decodeOutput.test.ts](src/test/unit/decodeOutput.test.ts) - Encoding detection and character handling
   - [parseOutput.test.ts](src/test/unit/parseOutput.test.ts) - Output parser and error scenarios
   - [handlers.test.ts](src/test/unit/handlers.test.ts) - File event handlers
   - [lintOperations.test.ts](src/test/unit/lintOperations.test.ts) - Lint operations
   - [formatOperations.test.ts](src/test/unit/formatOperations.test.ts) - Format operations
   - [fixOperations.test.ts](src/test/unit/fixOperations.test.ts) - Fix operations
   - [runFixer.test.ts](src/test/unit/runFixer.test.ts) - Fixer CLI runner
   - [resolveConfigPath.test.ts](src/test/unit/resolveConfigPath.test.ts) - Config resolution
   - [documentEdit.test.ts](src/test/unit/documentEdit.test.ts) - Document edit utility
   - [textUtils.test.ts](src/test/unit/textUtils.test.ts) - Text utilities
   - [settingsManager.test.ts](src/test/unit/settingsManager.test.ts) - Settings manager
   - [notificationManager.test.ts](src/test/unit/notificationManager.test.ts) - Notification manager

2. **E2E tests** ([src/test/e2e/](src/test/e2e/)): Test full integration with VS Code
   - [extension.test.ts](src/test/e2e/extension.test.ts) - Extension activation and commands
   - [runLinter.test.ts](src/test/e2e/runLinter.test.ts) - Linter CLI integration
   - [localTsqlRefine.test.ts](src/test/e2e/localTsqlRefine.test.ts) - Real tsqlrefine CLI integration
   - [startup.test.ts](src/test/e2e/startup.test.ts) - Startup verification
   - [formatter.test.ts](src/test/e2e/formatter.test.ts) - Formatter E2E tests
   - [fix.test.ts](src/test/e2e/fix.test.ts) - Fix command and code action tests

### Test Organization

Test helpers: [src/test/helpers/](src/test/helpers/)
- `testConstants.ts` - Centralized test timeouts, delays, and constants
- `testFixtures.ts` - Reusable test data factories
- `e2eTestHarness.ts` - E2E test setup/teardown automation
- `cleanup.ts` - File system cleanup utilities

### Code Coverage

- Minimum targets: 50% lines, 80% functions, 75% branches, 50% statements
- Configuration: [.c8rc.json](.c8rc.json)
- Generate report: `npm run test:unit:coverage`

### Writing Tests

Use the E2E test harness for integration tests:

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
      const diagnostics = await harness.waitForDiagnostics(
        context.document.uri,
        (entries) => entries.length >= 1
      );
    }
  );
});
```

**Best practices**:
- Always use constants from `testConstants.ts` for timeouts and delays
- Always use `runE2ETest()` harness for new E2E tests
- Use test factories instead of inline scripts
- Run `npm test` before submitting PRs

## Pre-commit Hooks and Automation

### Git Hooks with Husky

The project uses **Husky** for pre-commit hooks to enforce code quality standards:

- **Configuration**: [.husky/pre-commit](.husky/pre-commit)
- **Installation**: Automatic via `npm install` (using `prepare` script in package.json)
- **Actions**:
  1. **lint-staged**: Formats and lints staged files
     - TypeScript files: `biome format --write && biome lint --fix`
     - JSON, Markdown, YAML: `biome format --write`
  2. **Type checking**: Runs `npm run typecheck` for staged TypeScript files

To bypass hooks (not recommended):
```bash
git commit --no-verify
```

### Dependency Management with Dependabot

**Dependabot** automates dependency updates:

- **Configuration**: [.github/dependabot.yml](.github/dependabot.yml)
- **Schedule**: Weekly updates (Monday)
- **NPM Dependencies**:
  - Groups dev and production dependencies separately
  - Only minor and patch updates (no major versions)
  - Time: 09:00 UTC
- **GitHub Actions**: Weekly updates (Monday UTC)
- **PR Labeling**: Automatically labels with `dependencies` and `automated`

## Important Implementation Notes

### Windows Compatibility
- Always use `path.resolve()` and `path.normalize()` for file paths
- Use case-insensitive comparison on Windows (`normalizeForCompare()`)
- Wrap `.cmd`/`.bat` executables with `cmd.exe /c`

### Concurrency and Cancellation
- The `LintScheduler` prevents resource exhaustion with its semaphore
- All operations (lint, format, fix) support cancellation via AbortSignal
- In-flight requests are tracked in separate `DocumentStateManager` instances and cancelled when superseded

### Stdin-based CLI Invocation
- All operations use `--stdin` flag instead of temporary files
- All operations use `-q` (quiet) flag to suppress informational stderr output
- Document content is piped to the CLI process as UTF-8
- Lint uses `--output json` for structured JSON diagnostics; format/fix use text output (stdout = SQL text)
- Output paths containing `<stdin>` are mapped back to original URIs

### Error Handling
- CLI exit codes determine success/failure:
  - `0`: Success (no violations, or format/fix succeeded)
  - `1`: Rule violations found (lint only; treated as success, diagnostics parsed from stdout)
  - `2`: Parse error (SQL could not be parsed)
  - `3`: Configuration error (config file load failure, invalid settings)
  - `4`: Runtime exception (internal error)
- Exit codes >= 2 trigger user-facing warnings with specific descriptions via `CLI_EXIT_CODE_DESCRIPTIONS`
- CLI spawn errors reject the promise and clear diagnostics
- Missing installation errors trigger notification with install guide link (5-minute cooldown)
- Shared `handleOperationError()` provides consistent error handling for format/fix operations

### TypeScript Configuration
This project uses strict TypeScript settings including:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- Always handle array access with optional chaining or default values

## Release and Publishing

### GitHub Actions Workflows

The project includes two CI/CD workflows:

#### 1. CI Workflow ([.github/workflows/ci.yml](.github/workflows/ci.yml))

Runs on every push and pull request:
- Type checking and linting
- Unit tests with coverage reporting (Linux only for performance)
- E2E tests (cross-platform: Ubuntu, Windows, macOS)
- Coverage artifact upload (Linux only)
- Builds VSIX package on Linux
- Uploads VSIX as artifact

#### 2. Release Workflow ([.github/workflows/release.yml](.github/workflows/release.yml))

Runs when a release is published on GitHub:
- Type checking and linting
- Production build (`--production` flag)
- Creates VSIX package
- Publishes to VS Code Marketplace
- Uploads VSIX to GitHub release assets

### Publishing to VS Code Marketplace

#### Prerequisites

1. **VS Code Marketplace Account**: Create a publisher account at https://marketplace.visualstudio.com/manage
2. **Personal Access Token (PAT)**: Generate a token with the **Marketplace → Manage** scope
3. **GitHub Secret**: Add `VSCE_PAT` secret to your repository

#### Setup Instructions

1. Create a PAT at https://dev.azure.com/_usersSettings/tokens:
   - Scope: **Marketplace → Manage**
   - Expiration: Set as needed
   - Copy the token value

2. Add to GitHub repository secrets:
   - Go to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `VSCE_PAT`
   - Value: (paste your PAT)

3. Ensure publisher ID is set in `package.json`:
   ```json
   "publisher": "masmgr"
   ```

#### Release Process

1. Update version in `package.json`:
   ```json
   "version": "0.1.0"
   ```

2. Update `CHANGELOG.md` with release notes

3. Commit changes:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to 0.1.0"
   git push
   ```

4. Create a GitHub release:
   - Go to https://github.com/masmgr/tsqlrefine-vscode/releases
   - Click "Draft a new release"
   - Tag: `v0.1.0` (matches package.json version)
   - Title: Release notes or version summary
   - Description: Detailed release notes
   - Click "Publish release"

5. The release workflow will automatically:
   - Run tests and checks
   - Build the extension
   - Publish to VS Code Marketplace
   - Attach VSIX to GitHub release

#### Manual Publishing

If needed, you can publish manually from your local machine:

```bash
# Install vsce globally
npm install -g @vscode/vsce

# Build for production
npm run vscode:prepublish

# Create VSIX package
npm run package

# Publish to Marketplace
vsce publish --packagePath *.vsix --pat <YOUR_PAT>
```

### Version Management

- Keep `package.json` version in sync with GitHub release tags
- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Update `CHANGELOG.md` before each release

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes and commit them: `git commit -m "feat: description"`
3. Run tests: `npm test`
4. Run linting: `npm run lint`
5. Push to your fork and create a pull request

## Useful Resources

- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TSQLRefine Documentation](https://github.com/masmgr/tsqlrefine)
- [esbuild Documentation](https://esbuild.github.io/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## License

MIT - See [LICENSE](LICENSE) file for details.
