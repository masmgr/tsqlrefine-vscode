# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is `tsqllint-lite`, a VS Code extension that integrates TSQLLint (a T-SQL linter) into the editor. It provides real-time linting for SQL files with support for both manual and automatic linting, including fix-on-save functionality.

## Build and Test Commands

### Development
```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript to out/
npm run watch            # Watch mode for development
npm run typecheck        # Type-check without emitting
```

### Code Quality
```bash
npm run lint             # Lint with Biome
npm run format           # Format with Biome
```

### Testing
```bash
npm test                 # Run unit tests (out/test/**/*.test.js)
npm run test:e2e         # Run E2E tests (out/e2e/**/*.e2e.test.js)
```

The test runner uses `@vscode/test-cli` with a fixture workspace at [test/fixtures/workspace/](test/fixtures/workspace/).

## Architecture

### Language Server Pattern

This extension uses the **Language Server Protocol (LSP)** architecture with separate client and server processes:

- **Client** ([src/client/client.ts](src/client/client.ts)): Runs in the VS Code extension host
  - Creates and manages the LanguageClient connection
  - Registers commands (`tsqllint-lite.run`, `tsqllint-lite.fix`)
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

The scheduler handles three lint reasons:
- `"save"`: Triggered on document save
- `"type"`: Triggered during typing (if `runOnType` is enabled)
- `"manual"`: Triggered by explicit commands

#### 2. TSQLLint Runner ([src/server/lint/runTsqllint.ts](src/server/lint/runTsqllint.ts))

Executes the tsqllint CLI with proper process management:
- **Executable resolution**: Finds tsqllint via `settings.path` or PATH with caching (30s TTL)
- **Windows handling**: Wraps `.cmd`/`.bat` files with `cmd.exe /c`
- **Timeout protection**: Kills processes exceeding `settings.timeoutMs` (default 10s)
- **Cancellation support**: Respects AbortSignal for clean cancellation
- **Fix mode**: Supports `--fix` flag for auto-fixing issues

#### 3. Output Parser ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts))

Parses tsqllint output into VS Code diagnostics:
- **Pattern**: `<file>(<line>,<col>): <severity> <rule> : <message>`
- **Range modes**:
  - `"character"`: Highlights single character at error position
  - `"line"`: Highlights entire line
- **Path normalization**: Handles Windows case-insensitivity and path resolution
- **Temporary file support**: Maps temp file paths back to original URIs

#### 4. Document Lifecycle Management

The server tracks document state throughout its lifecycle:
- **Unsaved documents**: Creates temporary files in `os.tmpdir()` for linting
- **Fix restrictions**: `--fix` only works on saved files (shows warning otherwise)
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

The extension contributes these settings (namespace: `tsqllint`):

- `path`: Custom tsqllint executable path (default: searches PATH)
- `configPath`: TSQLLint config file path (passed as `-c` argument)
- `runOnSave`: Auto-lint on save (default: true)
- `fixOnSave`: Auto-fix on save (default: false)
- `runOnType`: Lint while typing (default: false)
- `debounceMs`: Debounce delay for typing (default: 500)
- `timeoutMs`: Process timeout (default: 10000)
- `rangeMode`: Diagnostic range mode - "character" or "line" (default: "character")

## Testing Strategy

Tests are organized into three categories:

1. **Unit tests** ([src/test/](src/test/)): Test individual functions like `parseOutput()` and `runTsqllint()`
2. **Extension tests** ([src/test/extension.test.ts](src/test/extension.test.ts)): Test extension activation and commands
3. **E2E tests** ([src/e2e/](src/e2e/)): Test full integration with tsqllint CLI

Use the fake CLI helper ([src/test/helpers/fakeCli.ts](src/test/helpers/fakeCli.ts)) for mocking tsqllint in tests.

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
- TSQLLint errors go to stderr and are shown as warnings
- CLI spawn errors reject the promise and clear diagnostics
- Fix failures on unsaved files show user-friendly messages

### TypeScript Configuration
This project uses strict TypeScript settings including:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- Always handle array access with optional chaining or default values
