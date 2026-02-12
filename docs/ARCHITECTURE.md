# Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Configuration System](#configuration-system)
6. [Testing Architecture](#testing-architecture)
7. [Build System](#build-system)
8. [Platform Considerations](#platform-considerations)

## Overview

TSQLRefine is a Visual Studio Code extension that integrates TSQLRefine (a T-SQL linter) into the editor. It provides real-time linting for SQL files with support for both manual and automatic linting through a robust Language Server Protocol (LSP) architecture.

### Key Features

- **Real-time Linting**: Automatic linting on save, open, and while typing (configurable)
- **Manual Control**: On-demand linting via command palette
- **Non-blocking Operation**: LSP architecture ensures UI remains responsive
- **Concurrency Management**: Sophisticated scheduling with resource control
- **Unsaved File Support**: Lints unsaved documents via temporary files
- **Windows Compatibility**: Special handling for Windows paths and executables

## System Architecture

### Language Server Protocol (LSP) Pattern

This extension uses a **client-server architecture** based on the Language Server Protocol:

```
┌─────────────────────────────────────────────────────┐
│                   VS Code Extension                 │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │            Extension Host (Client)            │  │
│  │                                               │  │
│  │  - Extension Activation (extension.ts)       │  │
│  │  - Language Client (client.ts)               │  │
│  │  - Command Registration                       │  │
│  │  - File Event Handlers (handlers.ts)         │  │
│  └───────────────────┬──────────────────────────┘  │
│                      │ IPC                         │
│                      │ (Language Server Protocol)  │
│  ┌───────────────────▼──────────────────────────┐  │
│  │        Language Server (server.ts)           │  │
│  │                                               │  │
│  │  - Document Synchronization                  │  │
│  │  - Lint Scheduler                            │  │
│  │  - TSQLRefine CLI Executor                     │  │
│  │  - Diagnostic Publishing                     │  │
│  └───────────────────┬──────────────────────────┘  │
│                      │                             │
└──────────────────────┼─────────────────────────────┘
                       │
                       │ Process Spawn
                       ▼
              ┌─────────────────┐
              │  TSQLRefine CLI   │
              │  (External)     │
              └─────────────────┘
```

### Process Separation

- **Extension Host Process**: Runs the VS Code extension client code
  - Lightweight, focuses on UI integration
  - Handles commands, file events, and user interactions
  - Managed by VS Code's extension host

- **Language Server Process**: Runs in a separate Node.js process via IPC
  - CPU-intensive linting operations
  - Document state management
  - Independent from VS Code UI thread

- **TSQLRefine CLI Process**: Spawned by the language server
  - External tool execution
  - Timeout and cancellation support
  - Short-lived per-lint operation

## Core Components

### 1. Extension Entry Point

**File**: [src/extension.ts](../src/extension.ts)

The main extension activation point that:
- Creates and starts the language client
- Registers the `tsqlrefine.run` command
- Sets up file event handlers for delete/rename operations
- Manages extension lifecycle (activate/deactivate)

**Key Exports**:
```typescript
export function activate(context: vscode.ExtensionContext): TsqllintLiteApi
export async function deactivate(): Promise<void>
```

### 2. Language Client

**File**: [src/client/client.ts](../src/client/client.ts)

Creates the LSP client connection:
- **Server Module**: Loads `dist/server.js` in a separate process
- **Transport**: Uses IPC (Inter-Process Communication)
- **Document Selector**: Activates for SQL files (file and untitled schemes)
- **Configuration Sync**: Synchronizes `tsqlrefine.*` settings

**Debug Support**: Includes debug configuration with inspector on port 6009.

### 3. File Event Handlers

**File**: [src/client/handlers.ts](../src/client/handlers.ts)

Handles file system operations:
- **Delete Events**: Clears diagnostics for deleted files
- **Rename Events**: Clears diagnostics for old file paths

### 4. Language Server

**File**: [src/server/server.ts](../src/server/server.ts)

The core server implementation managing:

#### Document Lifecycle
- **onDidOpen**: Triggers lint if `runOnOpen` is enabled
- **onDidChangeContent**: Triggers debounced lint if `runOnType` is enabled
- **onDidSave**: Triggers lint if `runOnSave` is enabled, updates saved version
- **onDidClose**: Cleans up resources (cancels lints, removes temp files, clears diagnostics)

#### State Management
```typescript
const documents = new TextDocuments(TextDocument);
const inFlightByUri = new Map<string, AbortController>();
const savedVersionByUri = new Map<string, number>();
const scheduler = new LintScheduler({ ... });
```

#### Custom LSP Requests
- **`tsqlrefine/lintDocument`**: Manual lint request from client
- **`tsqlrefine/clearDiagnostics`**: Clear diagnostics for specified URIs

#### Unsaved File Handling
For unsaved documents (new files, modified files):
1. Creates temporary directory in `os.tmpdir()`
2. Writes document content to `untitled.sql`
3. Runs tsqlrefine on temporary file
4. Maps results back to original URI
5. Cleans up temporary files after completion

### 5. Lint Scheduler

**File**: [src/server/lint/scheduler.ts](../src/server/lint/scheduler.ts)

Sophisticated scheduling system that manages concurrent lint operations.

#### Semaphore-Based Concurrency Control

```typescript
class Semaphore {
  private available: number;
  private waiters: Array<(release: Release) => void>;

  tryAcquire(): Release | null
  acquire(): Promise<Release>
}
```

- **Max Concurrent Runs**: 4 (configurable)
- **Resource Pooling**: Uses semaphore to limit parallel executions
- **Queue Management**: Queues pending lints when max concurrency reached

#### Debouncing Strategy

- **"type" events**: Debounced (default 500ms) to prevent excessive linting during typing
- **"save" events**: Immediate execution (no debounce)
- **"manual" events**: Immediate execution, bypasses queue
- **"open" events**: Immediate execution (no debounce)

#### Version Tracking

Ensures lints run against the correct document version:
```typescript
type PendingLint = {
  reason: LintReason;
  version: number | null;
};
```

If document version changes while queued, the scheduler updates to the current version.

#### Priority Handling

Manual lints (`reason: "manual"`) get special treatment:
1. Bypass debouncing
2. Remove from queue if already queued
3. Wait for available slot using `semaphore.acquire()`
4. Return result as Promise for synchronous feedback

### 6. TSQLRefine Runner

**File**: [src/server/lint/runTsqllint.ts](../src/server/lint/runTsqllint.ts)

Executes the tsqlrefine CLI with proper process management.

#### Executable Resolution

```typescript
async function findTsqllintExecutable(
  customPath: string,
  signal: AbortSignal
): Promise<string>
```

- **Custom Path Priority**: Uses `settings.path` if specified
- **PATH Search**: Falls back to `which tsqlrefine` (Unix) or `where tsqlrefine` (Windows)
- **Caching**: Results cached for 30 seconds (TTL)
- **Platform Detection**: Checks file extension for Windows `.cmd`/`.bat` files

#### Windows Executable Handling

Windows batch files cannot be executed directly. The runner wraps them:
```typescript
if (exePath.endsWith('.cmd') || exePath.endsWith('.bat')) {
  return { cmd: 'cmd.exe', args: ['/c', exePath, ...args] };
}
```

#### Process Spawning

```typescript
const child = spawn(cmd, args, {
  cwd,
  windowsHide: true,
  signal: signal
});
```

Key features:
- **Working Directory**: Set to workspace folder or file directory
- **Signal Support**: Respects AbortSignal for cancellation
- **Stream Handling**: Captures stdout/stderr separately
- **Encoding Detection**: Uses `chardet` and `iconv-lite` for encoding

#### Timeout Protection

```typescript
const timeoutId = setTimeout(() => {
  child.kill();
  clearTimeout(timeoutId);
  resolve({
    stdout: '',
    stderr: '',
    timedOut: true,
    cancelled: false
  });
}, settings.timeoutMs);
```

Default: 10 seconds (configurable via `settings.timeoutMs`)

#### Cancellation Handling

Monitors AbortSignal to kill process early:
```typescript
signal?.addEventListener('abort', () => {
  child.kill();
  cancelled = true;
});
```

### 7. Output Parser

**File**: [src/server/lint/parseOutput.ts](../src/server/lint/parseOutput.ts)

Parses tsqlrefine output into VS Code diagnostics.

#### TSQLRefine Output Format

```
<file>(<line>,<col>): <severity> <rule> : <message>
```

Example:
```
test.sql(5,1): error select-star : SELECT * not allowed
test.sql(12,3): warning semicolon-termination : Missing semicolon
```

#### Parsing Logic

```typescript
const LINT_PATTERN = /^(.+?)\((\d+),(\d+)\):\s+(warning|error)\s+([^\s]+)\s*:\s*(.*)$/;
```

Extracts:
1. **File path**: Normalized and resolved to absolute path
2. **Line/Column**: 1-based indices from tsqlrefine
3. **Severity**: Maps `error` → `DiagnosticSeverity.Error`, `warning` → `DiagnosticSeverity.Warning`
4. **Rule name**: Used as diagnostic code
5. **Message**: Full diagnostic message

#### Range Mode

Currently fixed to **"line"** mode:
- Highlights entire line containing the issue
- Uses line index from tsqlrefine output
- Range: `[line, 0]` to `[line, lineLength]`

#### Path Normalization

```typescript
function normalizeForCompare(p: string): string {
  return process.platform === 'win32'
    ? path.normalize(p).toLowerCase()
    : path.normalize(p);
}
```

Handles Windows case-insensitivity.

#### Temporary File Mapping

For unsaved documents:
```typescript
if (targetPaths && targetPaths.some(tp => normalizedPath === normalize(tp))) {
  // Map temp file diagnostics back to original URI
  return { uri: originalUri, ... };
}
```

### 8. Output Decoder

**File**: [src/server/lint/decodeOutput.ts](../src/server/lint/decodeOutput.ts)

Handles encoding detection and conversion:
- Uses `chardet` to detect buffer encoding
- Converts to UTF-8 using `iconv-lite`
- Falls back to UTF-8 if detection fails

### 9. Configuration Settings

**File**: [src/server/config/settings.ts](../src/server/config/settings.ts)

```typescript
export type TsqllintSettings = {
  path?: string;          // Custom tsqlrefine path (optional)
  configPath?: string;    // TSQLRefine config file (optional)
  runOnSave: boolean;     // Auto-lint on save
  runOnType: boolean;     // Auto-lint while typing
  runOnOpen: boolean;     // Auto-lint on open
  debounceMs: number;     // Debounce delay for typing
  timeoutMs: number;      // Process timeout
  rangeMode: 'character' | 'line';  // Diagnostic range mode (internal only)
};
```

Settings are:
- Defined in [package.json](../package.json) `contributes.configuration`
- Loaded per-document scope (supports workspace and folder-level config)
- Validated and normalized on server

## Data Flow

### Complete Lint Operation Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. TRIGGER EVENT                                        │
│    - User saves file                                    │
│    - User types (if runOnType enabled)                  │
│    - User opens file (if runOnOpen enabled)             │
│    - User runs command "TSQLRefine: Run"                  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 2. CLIENT EVENT HANDLER                                 │
│    - extension.ts receives VS Code event                │
│    - Checks if client is ready                          │
│    - Sends LSP notification/request to server           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 3. SERVER EVENT HANDLER (server.ts)                     │
│    - onDidChangeContent / onDidSave / etc.              │
│    - Checks settings (runOnSave, runOnType, etc.)       │
│    - Calls requestLint()                                │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 4. LINT SCHEDULER (scheduler.ts)                        │
│    - Receives lint request with reason + version        │
│    - Stores pending lint in pendingByUri map            │
│    - If "manual": await semaphore.acquire()             │
│    - If "type": start debounce timer                    │
│    - If "save"/"open": try immediate execution          │
│    - If no slot available: add to queue                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 5. ACQUIRE SEMAPHORE SLOT                               │
│    - Wait for available slot (max 4 concurrent)         │
│    - Retrieve pending lint from map                     │
│    - Verify document version matches (or update)        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 6. PREPARE LINT EXECUTION (server.ts:runLintNow)       │
│    - Check if document is saved                         │
│    - If unsaved: create temp file in os.tmpdir()        │
│    - Create AbortController for cancellation            │
│    - Load document-scoped settings                      │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 7. RUN TSQLLINT CLI (runTsqllint.ts)                    │
│    - Resolve executable path (cache or search PATH)     │
│    - Build command args: [filePath, -c configPath]      │
│    - Spawn process with timeout and signal              │
│    - Collect stdout/stderr streams                      │
│    - Handle timeout/cancellation/completion             │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 8. DECODE OUTPUT (decodeOutput.ts)                      │
│    - Detect encoding with chardet                       │
│    - Convert to UTF-8 using iconv-lite                  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 9. PARSE OUTPUT (parseOutput.ts)                        │
│    - Split stdout into lines                            │
│    - Match pattern: file(line,col): severity rule : msg │
│    - Normalize file paths                               │
│    - Map temp file paths back to original URI           │
│    - Create VS Code Diagnostic objects                  │
│    - Set severity, range, message, code                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 10. PUBLISH DIAGNOSTICS (server.ts)                    │
│     - connection.sendDiagnostics({ uri, diagnostics })  │
│     - Cleanup temp files if created                     │
│     - Log stderr warnings if present                    │
│     - Release semaphore slot                            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 11. CLIENT DISPLAYS DIAGNOSTICS                         │
│     - VS Code receives diagnostics via LSP              │
│     - Shows squiggles in editor                         │
│     - Updates Problems panel                            │
│     - Badge count on file explorer                      │
└─────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 12. DRAIN QUEUE (scheduler.ts)                          │
│     - After release, check if queue has items           │
│     - Try to acquire slot for next queued URI           │
│     - Repeat until queue empty or no slots available    │
└─────────────────────────────────────────────────────────┘
```

### State Management

#### Per-URI State Tracking

```typescript
// In-flight operations
const inFlightByUri = new Map<string, AbortController>();

// Saved document versions
const savedVersionByUri = new Map<string, number>();

// Scheduler state
private readonly pendingByUri = new Map<string, PendingLint>();
private readonly debounceTimerByUri = new Map<string, NodeJS.Timeout>();
private readonly queuedUris: string[] = [];
```

#### State Transitions

1. **Document Opens**
   - Add to `savedVersionByUri` if file scheme
   - Trigger lint if `runOnOpen` enabled

2. **Document Changes**
   - Clear previous debounce timer
   - Start new debounce if `runOnType` enabled
   - Update pending version

3. **Document Saves**
   - Update `savedVersionByUri` to current version
   - Trigger lint if `runOnSave` enabled

4. **Lint Starts**
   - Create AbortController
   - Add to `inFlightByUri`
   - Create temp file if unsaved

5. **Lint Completes**
   - Remove from `inFlightByUri`
   - Cleanup temp file
   - Publish diagnostics

6. **Document Closes**
   - Cancel in-flight lints
   - Clear all state
   - Remove temp files
   - Clear diagnostics

## Configuration System

### Configuration Hierarchy

1. **Default Settings** (in code)
2. **User Settings** (global)
3. **Workspace Settings** (workspace root)
4. **Folder Settings** (multi-root workspaces)
5. **Document-Scoped Settings** (per-file)

### Settings Resolution

```typescript
async function getSettingsForDocument(uri: string): Promise<TsqllintSettings> {
  const scopedConfig = await connection.workspace.getConfiguration({
    scopeUri: uri,
    section: "tsqlrefine",
  });
  return normalizeSettings({
    ...defaultSettings,
    ...globalSettings,
    ...scopedConfig,
  });
}
```

### Configuration Validation

Settings are validated on the server side. The `rangeMode` setting is internal only and not exposed in the VS Code configuration UI.

### Configuration Updates

When configuration changes:
1. `onDidChangeConfiguration` event fires
2. Server refreshes global settings
3. Next lint operation uses updated settings
4. No restart required

## Testing Architecture

### Test Categories

#### 1. Unit Tests

**Location**: [src/test/unit/](../src/test/unit/)

Test individual functions in isolation:
- **parseOutput.test.ts**: Output parsing logic
- **runTsqllint.test.ts**: CLI execution and process management
- **handlers.test.ts**: File event handlers

**Run Command**: `npm run test:unit`

**Tools**: Mocha test runner with `.mocharc.unit.json` config

#### 2. E2E Tests

**Location**: [src/test/e2e/](../src/test/e2e/)

Test full integration with VS Code and tsqlrefine CLI:
- **extension.test.ts**: Extension activation, command registration, client lifecycle
- **localTsqllint.test.ts**: Tests with real tsqlrefine installation

**Run Command**: `npm run test:e2e`

**Tools**:
- `@vscode/test-cli` and `@vscode/test-electron` for VS Code instance
- `.vscode-test.mjs` configuration

**Prerequisites**: For localTsqllint tests, TSQLRefine must be installed and available in PATH

### Test Helpers

**Location**: [src/test/helpers/](../src/test/helpers/)

#### testConstants.ts
Centralized test timeouts, delays, and retry values:
```typescript
export const TEST_TIMEOUTS = {
  MOCHA_TEST: 30000,
  WAIT_FOR_DIAGNOSTICS: 15000,
  // ...
};

export const TEST_DELAYS = {
  AFTER_SAVE: 100,
  BEFORE_EDIT: 50,
  // ...
};
```

#### cleanup.ts
File system cleanup utilities with retry logic:
```typescript
async function cleanupTestFile(filePath: string): Promise<void>
async function cleanupTestDir(dirPath: string): Promise<void>
```

#### testFixtures.ts
Reusable test data factories:
```typescript
function createFakeCliScript(rule: string): string
function createWorkspaceConfig(config: Partial<TsqllintSettings>): object
```

#### e2eTestHarness.ts
E2E test setup/teardown automation:
```typescript
async function runE2ETest<T>(
  options: E2ETestOptions,
  testFn: (context: TestContext, harness: TestHarness) => Promise<T>
): Promise<T>
```

Provides:
- Automatic workspace setup
- Fake CLI creation
- Configuration management
- Document lifecycle management
- Diagnostic waiting utilities
- Cleanup on success/failure

#### fakeCli.ts
Mock tsqlrefine CLI helper for unit tests:
```typescript
function createFakeCli(outputLines: string[]): string
```

Generates a Node.js script that mimics tsqlrefine output.

### Test Organization Best Practices

1. **Always use constants**: Never hardcode timeouts or delays
2. **Always use harness**: New E2E tests must use `runE2ETest()`
3. **Always use factories**: Don't create inline fake CLI scripts
4. **Document changes**: Keep test architecture section updated

### Build Process for Tests

```bash
npm run build          # Bundle extension/server to dist/ (esbuild)
npm run compile:test   # Compile test files to out/ (tsc)
```

**Why both?**
- VS Code loads extension from `dist/extension.js` (bundled)
- Test runner executes tests from `out/test/**/*.test.js` (compiled)

### Fixture Workspace

**Location**: [test/fixtures/workspace/](../test/fixtures/workspace/)

Contains:
- Sample SQL files for testing
- Configuration files (`tsqlrefine.json`)
- Test workspace settings

## Build System

### Build Tools

- **Production Build**: esbuild (fast, bundled)
- **Test Compilation**: TypeScript compiler (preserves file structure)
- **Linting**: Biome (fast, modern)
- **Package Manager**: npm

### Build Scripts

#### Development
```bash
npm run build          # Bundle to dist/ with esbuild
npm run watch          # Watch mode with esbuild
npm run compile        # Compile to out/ with tsc
npm run typecheck      # Type-check only (no emit)
```

#### Production
```bash
npm run vscode:prepublish   # Production build (minified)
npm run package             # Create .vsix package
```

#### Quality
```bash
npm run lint           # Lint with Biome
npm run format         # Format with Biome
```

### esbuild Configuration

**File**: [esbuild.mjs](../esbuild.mjs)

Builds two entry points:
1. **Extension**: `src/extension.ts` → `dist/extension.js`
2. **Server**: `src/server/server.ts` → `dist/server.js`

Configuration:
```javascript
{
  bundle: true,
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  minify: production,
}
```

### TypeScript Configuration

**Files**:
- [tsconfig.json](../tsconfig.json): Main config for source code
- [tsconfig.test.json](../tsconfig.test.json): Config for test files

**Key Settings**:
```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "target": "ES2022",
  "module": "Node16"
}
```

**Strict Mode Implications**:
- Always handle array access with optional chaining or default values
- Explicit undefined checks required
- Type safety enforced at compilation

### Output Structure

```
dist/
  ├── extension.js       # Bundled client + extension entry
  ├── extension.js.map
  ├── server.js          # Bundled server
  └── server.js.map

out/                     # Test compilation output
  └── test/
      ├── unit/
      │   └── *.test.js
      ├── e2e/
      │   └── *.test.js
      └── helpers/
          └── *.js
```

## Platform Considerations

### Windows Compatibility

#### Path Handling
```typescript
// Always use path module
import * as path from 'node:path';

// Normalize paths
const normalized = path.normalize(filePath);

// Resolve to absolute
const absolute = path.resolve(filePath);

// Case-insensitive comparison on Windows
function normalizeForCompare(p: string): string {
  return process.platform === 'win32'
    ? path.normalize(p).toLowerCase()
    : path.normalize(p);
}
```

#### Executable Wrapping
Windows `.cmd` and `.bat` files cannot be spawned directly:
```typescript
if (exePath.endsWith('.cmd') || exePath.endsWith('.bat')) {
  spawn('cmd.exe', ['/c', exePath, ...args]);
} else {
  spawn(exePath, args);
}
```

#### Path Separators
Use `path.join()` and `path.resolve()` instead of string concatenation:
```typescript
// Good
const fullPath = path.join(dir, 'file.sql');

// Bad
const fullPath = dir + '/' + 'file.sql';
```

### Unix/Linux/macOS Compatibility

- Standard executable resolution via `which`
- Case-sensitive path comparison
- Direct process spawning (no wrapper needed)

### Cross-Platform Testing

Tests run on both platforms via GitHub Actions (if configured):
- Windows tests use `cmd.exe` wrapper
- Unix tests use direct execution
- Path normalization ensures consistent behavior

## Performance Characteristics

### Concurrency Limits

- **Max Concurrent Lints**: 4 (configurable)
- **Semaphore-based**: Prevents resource exhaustion
- **Queue Depth**: Unlimited (in-memory)

### Debouncing

- **Default Delay**: 500ms for typing events
- **Adjustable**: Via `debounceMs` setting
- **Bypassed**: For save, open, and manual triggers

### Caching

- **Executable Path**: 30-second TTL cache
- **Document Versions**: Cached per-URI
- **Settings**: Cached globally, refreshed on change

### Memory Management

- **Temporary Files**: Cleaned up after each lint
- **AbortControllers**: Disposed after cancellation
- **Diagnostics**: Cleared on document close
- **Queue**: Drained automatically after slot release

### Timeout Protection

- **Default**: 10 seconds per lint operation
- **Configurable**: Via `timeoutMs` setting
- **Process Killing**: Forceful termination after timeout
- **Diagnostic Clearing**: Removes stale results

## Error Handling

### Error Sources

1. **Executable Not Found**
   - Shows warning message
   - Clears diagnostics
   - Returns -1 (failure indicator)

2. **Spawn Errors**
   - Catches process spawn failures
   - Displays user-friendly message
   - Logs to output channel

3. **Timeout**
   - Kills process
   - Shows timeout warning
   - Clears diagnostics

4. **Cancellation**
   - Respects AbortSignal
   - Cleans up resources
   - No user notification (expected behavior)

5. **TSQLRefine Errors** (stderr output)
   - Shows first line as warning
   - Logs full stderr to console
   - Still publishes diagnostics from stdout

### Error Propagation

```
TSQLRefine Error → runTsqllint() throws
                ↓
           runLintNow() catches
                ↓
           notifyRunFailure()
                ↓
           Clear diagnostics
                ↓
           Return -1
```

### User Notifications

- **Warning Messages**: For errors and timeouts
- **Console Logging**: For detailed error information
- **Diagnostic Clearing**: On unrecoverable errors

## Extension Points

### Future Extensibility

The architecture supports adding:

1. **Custom Lint Rules**: Via tsqlrefine config files
2. **Code Actions**: Fix suggestions based on rule violations
3. **Range Mode**: Character-level highlighting (currently line-level)
4. **Multiple File Types**: Extend beyond SQL files
5. **Workspace-wide Linting**: Batch operation across files
6. **Quick Fixes**: Automated rule violation fixes
7. **Configuration UI**: Settings editor integration

### LSP Capabilities

Current capabilities:
- TextDocumentSync (incremental)
- Custom requests/notifications

Potential additions:
- CodeActions (quick fixes)
- Hover (rule documentation)
- CodeLens (inline lint counts)
- WorkspaceSymbol (rule search)

## References

- [Language Server Protocol Specification](https://microsoft.github.io/language-server-protocol/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TSQLRefine Documentation](https://github.com/tsqlrefine/tsqlrefine)
- [esbuild Documentation](https://esbuild.github.io/)

---

**Document Version**: 1.0
**Last Updated**: 2026-01-18
**Extension Version**: 0.0.2
