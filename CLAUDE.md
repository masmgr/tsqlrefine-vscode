# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VS Code extension that integrates TSQLRefine (a T-SQL linter, formatter, and fixer) into the editor. Provides real-time linting, document formatting, and auto-fixing for SQL files.

## Build and Test Commands

```bash
# Development
npm install              # Install dependencies
npm run build            # Bundle extension/server to dist/ with esbuild
npm run compile          # Compile TypeScript to out/ (for tests)
npm run watch            # Watch mode for development (esbuild)
npm run typecheck        # Type-check without emitting

# Code Quality
npm run lint             # Lint with Biome
npm run format           # Format with Biome
npm run verify           # Run all checks (test + typecheck + lint + format)

# Testing
npm run test:unit        # Run unit tests with Mocha
npm run test:unit:coverage  # Run unit tests with c8 coverage (targets: 50% lines, 80% functions, 75% branches)
npm run test:e2e         # Run E2E tests with VS Code Test
npm test                 # Run unit tests
```

**Build process**: Unit tests need `npm run compile:test` (→ `out/`). E2E tests need both `npm run build` (→ `dist/`) and `npm run compile:test`. The extension loads from `dist/extension.js`, tests from `out/test/**/*.test.js`.

## Architecture

### Language Server Protocol (LSP)

Client and server run in separate processes:

- **Client** ([src/extension.ts](src/extension.ts), [src/client/](src/client/)): VS Code extension host. Manages LanguageClient, registers commands, handles file lifecycle events.
- **Server** ([src/server/server.ts](src/server/server.ts)): Separate Node.js process. Handles document sync, lint/format/fix operations, code actions, and coordinates with LintScheduler.

### Core Components

- **LintScheduler** ([src/server/lint/scheduler.ts](src/server/lint/scheduler.ts)): Semaphore-based concurrency (max 4), debouncing for type events (500ms default), version tracking. Manual lints bypass debounce.
- **Process Runner** ([src/server/shared/processRunner.ts](src/server/shared/processRunner.ts)): CLI execution with command resolution (PATH + caching 30s TTL), installation verification, timeout/cancellation, UTF-8 encoding.
- **Lint Operations** ([src/server/lint/](src/server/lint/)): Runs `tsqlrefine lint -q --output json --stdin`, parses JSON output to diagnostics (0-based character-level ranges). `maxFileSizeKb` limits automatic linting only.
- **Format Operations** ([src/server/format/](src/server/format/)): Runs `tsqlrefine format -q --stdin`, returns `TextEdit[]` for full document replacement.
- **Fix Operations** ([src/server/fix/](src/server/fix/)): Runs `tsqlrefine fix -q --stdin --severity`, returns `TextEdit[]`. Integrated with Code Action provider ("Fix all tsqlrefine issues", `QuickFix` kind).
- **Output Parser** ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts)): Parses `LintResult` JSON with `files[].diagnostics[]`. 0-based positions used directly. Handles Windows case-insensitivity and `<stdin>` path mapping.

### State Management ([src/server/state/](src/server/state/))

- **DocumentStateManager**: Per-document in-flight tracking with AbortController, cancellation of superseded operations. Three independent instances for lint, format, fix.
- **NotificationManager**: Missing tsqlrefine notification with 5-minute cooldown and install guide integration.
- **SettingsManager**: Global/document-scoped settings retrieval via LSP with normalization.

### Shared Utilities ([src/server/shared/](src/server/shared/))

- `documentContext.ts` — Unified `DocumentContext` (uri, filePath, workspaceRoot, cwd, settings, configPath, documentText, isSavedFile)
- `documentEdit.ts` — `createFullDocumentEdit()` for full document replacement
- `errorHandling.ts` — `handleOperationError()` for format/fix error handling
- `logging.ts` — `logOperationContext()` for consistent operation logging
- `textUtils.ts` — `firstLine()`, `resolveTargetFilePath()`
- `normalize.ts` — Path and config normalization (`normalizeForCompare()`, `normalizeExecutablePath()`, `normalizeConfigPath()`)
- `types.ts` — `ProcessRunResult`, `BaseProcessOptions`

### Configuration Constants ([src/server/config/constants.ts](src/server/config/constants.ts))

- `COMMAND_CACHE_TTL_MS = 30000`, `COMMAND_CHECK_TIMEOUT_MS = 3000`
- `CONFIG_CACHE_TTL_MS = 5000`, `CONFIG_CACHE_MAX_SIZE = 100`
- `MAX_CONCURRENT_RUNS = 4`, `MISSING_TSQLREFINE_NOTICE_COOLDOWN_MS = 300000`
- `DEFAULT_COMMAND_NAME = "tsqlrefine"`
- `CLI_EXIT_CODE_DESCRIPTIONS` — 2=parse error, 3=config error, 4=runtime exception

### Operation Patterns

All operations use dependency injection (`OperationDeps`: connection, notificationManager, stateManager) and receive a unified `DocumentContext` object.

## Configuration

Settings namespace: `tsqlrefine`

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `path` | string | "" | Custom tsqlrefine executable path (default: searches PATH) |
| `configPath` | string | "" | TSQLRefine config file path (passed as `-c` argument) |
| `runOnSave` | boolean | true | Auto-lint on save |
| `runOnType` | boolean | false | Lint while typing (debounced) |
| `runOnOpen` | boolean | true | Auto-lint on open |
| `debounceMs` | number | 500 | Debounce delay for typing |
| `timeoutMs` | number | 10000 | Process timeout for lint |
| `maxFileSizeKb` | number | 0 | Max file size (KB) for automatic linting (0 = unlimited) |
| `minSeverity` | string | "info" | Minimum severity for diagnostics (error/warning/info/hint) |
| `formatTimeoutMs` | number | 10000 | Process timeout for format |
| `enableLint` | boolean | true | Enable linting |
| `enableFormat` | boolean | true | Enable formatting |
| `enableFix` | boolean | true | Enable auto-fix |
| `allowPlugins` | boolean | false | Allow loading tsqlrefine plugins (security-sensitive, opt-in) |

## Commands

| Command | Description |
|---------|-------------|
| `tsqlrefine.run` | Manually lint the active document |
| `tsqlrefine.format` | Format the active document |
| `tsqlrefine.fix` | Apply auto-fixes to the active document |
| `tsqlrefine.openInstallGuide` | Open installation guide URL |

## Testing

### Structure

```
src/test/
├── unit/          # Unit tests (Mocha, no VS Code instance)
├── e2e/           # E2E tests (VS Code Test, extension loaded)
└── helpers/       # Shared utilities
```

Config: [.mocharc.unit.json](.mocharc.unit.json) (unit), [.vscode-test.mjs](.vscode-test.mjs) (E2E, fixture workspace at [test/fixtures/workspace/](test/fixtures/workspace/)).

### E2E Test Rules

- Always use `runE2ETest()` from `e2eTestHarness.ts` for setup/teardown
- Use constants from `testConstants.ts`: `TEST_TIMEOUTS.*`, `TEST_DELAYS.*`, `RETRY_CONFIG.*`, `FAKE_CLI_RULES.*`
- Never hardcode timeouts or delays

### Property-Based Testing (fast-check)

PBT tests are integrated into unit test files under `suite("Property-based tests")` blocks. Custom arbitraries are in [src/test/helpers/arbitraries.ts](src/test/helpers/arbitraries.ts):

| Arbitrary | Description |
|-----------|-------------|
| `platformPath` | Platform-appropriate file paths (Windows/Unix) |
| `unixPath` / `windowsPath` | OS-specific file paths |
| `whitespace` / `paddedString` | Whitespace-related strings |
| `textWithLineEndings` | Multiline text with mixed line endings |
| `utf8BufferWithOptionalBom` | Buffers with/without UTF-8 BOM |
| `cliDiagnostic` / `cliJsonOutput` | Valid CLI output structures |

Modules with PBT coverage: `textUtils.ts`, `normalize.ts`, `decodeOutput.ts`, `parseOutput.ts`.

Best practices:
- Test one property per test, use `property:` prefix in test name
- Use specific/constrained arbitraries over generic ones
- Use `fc.pre()` for preconditions
- Use conditional tests for platform-specific properties (`process.platform === "win32"`)
- 100 test cases default; use 200-1000 for critical paths

### Coverage

c8 with targets: 50% lines, 80% functions, 75% branches. Config: [.c8rc.json](.c8rc.json). Reports in `coverage/`.

## Important Implementation Notes

### CLI Invocation
- All operations use `--stdin` (piped as UTF-8) and `-q` (quiet) flags
- Lint: `--output json` for structured diagnostics; format/fix: stdout = SQL text
- Exit codes: 0=success, 1=violations (lint only, success), 2=parse error, 3=config error, 4=runtime exception
- Lint: 0 and 1 are success (parse stdout). Format/fix: only 0 is success.
- `<stdin>` output paths are mapped back to original URIs

### Error Handling
- CLI spawn errors reject promise and clear diagnostics
- Missing installation → notification with install guide (5-minute cooldown)
- Shared `handleOperationError()` for format/fix; `CLI_EXIT_CODE_DESCRIPTIONS` for specific messages

### Windows Compatibility
- Use `path.resolve()` / `path.normalize()` for file paths
- Use `normalizeForCompare()` for case-insensitive comparison

### TypeScript Configuration
- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`
- Always handle array access with optional chaining or default values

### Git Hooks
- Husky pre-commit: lint-staged (Biome format + lint on `.ts`, format on `.json`) + typecheck
- Installed automatically via `npm install`
