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

TSQLRefine is a Visual Studio Code extension that integrates [TSQLRefine](https://github.com/masmgr/tsqlrefine) (a T-SQL linter, formatter, and fixer) into the editor. It provides real-time linting, formatting, and auto-fixing for SQL files through a robust Language Server Protocol (LSP) architecture.

### Key Features

- **Real-time Linting**: Automatic linting on save, open, and while typing (configurable)
- **Formatting**: Full document formatting with format-on-save support
- **Auto-fixing**: Code actions and manual fix commands for fixable issues
- **Manual Control**: On-demand operations via command palette
- **Non-blocking Operation**: LSP architecture ensures UI remains responsive
- **Concurrency Management**: Sophisticated scheduling with resource control
- **Stdin-based Operation**: All operations pipe document content via stdin
- **Status Bar Integration**: Real-time diagnostic counts and operation state
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
│  │  - Status Bar Manager (statusBar.ts)         │  │
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
│  │  - Format / Fix Operations                   │  │
│  │  - Code Action Provider                      │  │
│  │  - Diagnostic Publishing                     │  │
│  └───────────────────┬──────────────────────────┘  │
│                      │                             │
└──────────────────────┼─────────────────────────────┘
                       │
                       │ Process Spawn (stdin/stdout)
                       ▼
              ┌─────────────────┐
              │  TSQLRefine CLI  │
              │  (External)     │
              └─────────────────┘
```

### Process Separation

- **Extension Host Process**: Runs the VS Code extension client code
  - Lightweight, focuses on UI integration
  - Handles commands, file events, status bar, and user interactions
  - Managed by VS Code's extension host

- **Language Server Process**: Runs in a separate Node.js process via IPC
  - CPU-intensive lint, format, and fix operations
  - Document state management
  - Independent from VS Code UI thread

- **TSQLRefine CLI Process**: Spawned by the language server
  - External tool execution via stdin/stdout
  - Timeout and cancellation support
  - Short-lived per operation

## Core Components

### 1. Extension Entry Point

**File**: [src/extension.ts](../src/extension.ts)

The main extension activation point that:
- Creates and starts the language client
- Registers commands (`tsqlrefine.run`, `tsqlrefine.format`, `tsqlrefine.fix`, `tsqlrefine.openInstallGuide`)
- Initializes the `StatusBarManager` for diagnostic counts and operation state
- Sets up file event handlers for delete/rename operations
- Listens for `tsqlrefine/operationState` notifications to drive the status bar spinner
- Manages extension lifecycle (activate/deactivate)

**Key Exports**:
```typescript
export function activate(context: vscode.ExtensionContext): TsqlRefineLiteApi
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
- **onDidClose**: Cancels in-flight lints, clears state and diagnostics

#### State Management
```typescript
const documents = new TextDocuments(TextDocument);
const settingsManager = new SettingsManager(connection);
const notificationManager = new NotificationManager(connection);
const lintStateManager = new DocumentStateManager();
const formatStateManager = new DocumentStateManager();
const fixStateManager = new DocumentStateManager();
const scheduler = new LintScheduler({ ... });
```

#### LSP Capabilities
```typescript
{
  textDocumentSync: {
    openClose: true,
    change: TextDocumentSyncKind.Incremental,
    save: { includeText: false },
  },
  documentFormattingProvider: true,
  codeActionProvider: {
    codeActionKinds: [CodeActionKind.QuickFix],
  },
}
```

#### Custom LSP Requests/Notifications
- **`tsqlrefine/lintDocument`**: Manual lint request from client
- **`tsqlrefine/clearDiagnostics`**: Clear diagnostics for specified URIs
- **`tsqlrefine/formatDocument`**: Manual format request from client
- **`tsqlrefine/fixDocument`**: Manual fix request with workspace edit application
- **`tsqlrefine/operationState`**: Notification sent to client for status bar spinner

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

- **Max Concurrent Runs**: 4 (configurable via `MAX_CONCURRENT_RUNS`)
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

### 6. Process Runner

**File**: [src/server/shared/processRunner.ts](../src/server/shared/processRunner.ts)

Shared infrastructure for executing all CLI commands (lint, format, fix).

#### Command Resolution

```typescript
async function resolveCommand(settings: TsqlRefineSettings): Promise<string>
```

- **Custom Path Priority**: Uses `settings.path` if specified, validates with `assertPathExists()`
- **PATH Search**: Falls back to spawning `tsqlrefine --version` to check availability
- **Caching**: Results cached per configured path with 30-second TTL (`COMMAND_CACHE_TTL_MS`)

#### Installation Verification

```typescript
async function verifyInstallation(
  settings: TsqlRefineSettings
): Promise<{ available: boolean; message?: string }>
```

Called at startup and when settings change.

#### Process Execution

```typescript
function runProcess(options: BaseProcessOptions): Promise<ProcessRunResult>
```

- Spawns the CLI with configurable command, args, cwd, timeout, and signal
- Pipes document content to stdin as UTF-8
- Captures stdout and stderr as buffers, decoded via `decodeCliOutput()`
- Supports timeout (kills process) and cancellation (via AbortSignal)

### 7. Operation Runners

Three specialized runners that build CLI arguments and delegate to `runProcess()`:

#### Lint Runner ([src/server/lint/runLinter.ts](../src/server/lint/runLinter.ts))

Executes: `tsqlrefine lint -q --utf8 --output json --stdin`

- Adds `-c <configPath>` if configured
- Adds `--severity <minSeverity>` for filtering
- Returns structured JSON output on stdout

#### Format Runner ([src/server/format/runFormatter.ts](../src/server/format/runFormatter.ts))

Executes: `tsqlrefine format -q --utf8 --stdin`

- Adds `-c <configPath>` if configured
- Uses `formatTimeoutMs` setting for timeout
- Returns formatted SQL text on stdout

#### Fix Runner ([src/server/fix/runFixer.ts](../src/server/fix/runFixer.ts))

Executes: `tsqlrefine fix -q --utf8 --stdin`

- Adds `-c <configPath>` if configured
- Adds `--severity <minSeverity>` for severity-aware fixing
- Returns fixed SQL text on stdout

### 8. Output Parser

**File**: [src/server/lint/parseOutput.ts](../src/server/lint/parseOutput.ts)

Parses JSON output from `tsqlrefine lint --output json` into VS Code diagnostics.

#### JSON Output Structure

```typescript
type CliJsonOutput = {
  tool: string;
  version: string;
  command: string;
  files: CliFileResult[];
};

type CliFileResult = {
  filePath: string;
  diagnostics: CliDiagnostic[];
};

type CliDiagnostic = {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number;
  code?: string;
  message: string;
  data?: {
    ruleId?: string;
    category?: string;
    fixable?: boolean;
    codeDescriptionHref?: string;
  };
};
```

#### Parsing Logic

- **JSON parsing**: `JSON.parse(stdout)` with error handling for malformed output
- **Character-level ranges**: Uses exact `range.start`/`range.end` positions from JSON (0-based)
- **Severity mapping**: `mapSeverity()` converts CLI numeric severities (1=Error, 2=Warning, 4=Hint, default=Information)
- **Path normalization**: `normalizeForCompare()` handles Windows case-insensitivity
- **Stdin marker**: `<stdin>` file paths are mapped back to the original document URI
- **Code description**: `codeDescriptionHref` provides clickable rule documentation links in the Problems panel
- **Fixable detection**: `data.fixable` boolean enables code action integration

### 9. Output Decoder

**File**: [src/server/lint/decodeOutput.ts](../src/server/lint/decodeOutput.ts)

Simple UTF-8 output decoding:
- **BOM removal**: Strips UTF-8 BOM (0xEF 0xBB 0xBF) if present
- **UTF-8 decoding**: Converts buffer to string using Node.js `buffer.toString("utf8")`
- **Line ending normalization**: `normalizeLineEndings()` utility for LF/CRLF conversion

### 10. Configuration Settings

**File**: [src/server/config/settings.ts](../src/server/config/settings.ts)

```typescript
export type TsqlRefineSettings = {
  path?: string;            // Custom tsqlrefine executable path
  configPath?: string;      // TSQLRefine config file path
  runOnSave: boolean;       // Auto-lint on save
  runOnType: boolean;       // Auto-lint while typing
  runOnOpen: boolean;       // Auto-lint on open
  debounceMs: number;       // Debounce delay for typing
  timeoutMs: number;        // Process timeout for lint
  maxFileSizeKb: number;    // Max file size for auto-lint (0 = unlimited)
  minSeverity: "error" | "warning" | "info" | "hint";
  formatTimeoutMs?: number; // Process timeout for format
  enableLint: boolean;      // Enable linting
  enableFormat: boolean;    // Enable formatting
  enableFix: boolean;       // Enable auto-fix
};
```

Settings are:
- Defined in [package.json](../package.json) `contributes.configuration`
- Loaded per-document scope (supports workspace and folder-level config)
- Validated and normalized by `SettingsManager` on the server

### 11. State Management

The server uses three specialized managers under [src/server/state/](../src/server/state/):

#### DocumentStateManager ([src/server/state/documentStateManager.ts](../src/server/state/documentStateManager.ts))

Manages per-document state with two independent maps:
- **In-flight tracking**: `Map<string, AbortController>` for running operations
- **Saved version tracking**: `Map<string, number>` to distinguish saved vs modified documents

Three independent instances are used for lint, format, and fix operations to avoid interference between operation types.

#### NotificationManager ([src/server/state/notificationManager.ts](../src/server/state/notificationManager.ts))

Centralized user notification management:
- **Cooldown support**: Missing tsqlrefine notification has 5-minute cooldown
- **Install guide integration**: Offers to open installation guide
- **Error detection**: `isMissingTsqlRefineError()` detects missing installation
- **Logging**: Provides `log()`, `warn()`, `error()` methods via `connection.console`

#### SettingsManager ([src/server/state/settingsManager.ts](../src/server/state/settingsManager.ts))

Settings retrieval and normalization:
- **Global settings**: Cached settings for all documents
- **Document-scoped settings**: Per-document settings via LSP `connection.workspace.getConfiguration`
- **Validation**: Normalizes `maxFileSizeKb` values

### 12. Code Action Provider

The server provides quick fixes via LSP code actions:
- **Trigger**: When tsqlrefine diagnostics with `data.fixable = true` exist in the document
- **Action**: "Fix all tsqlrefine issues"
- **Kind**: `CodeActionKind.QuickFix`
- **Implementation**: Invokes `tsqlrefine.fix` command on the client, which sends `tsqlrefine/fixDocument` request

## Data Flow

### Lint Operation Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. TRIGGER EVENT                                        │
│    - User saves file                                    │
│    - User types (if runOnType enabled)                  │
│    - User opens file (if runOnOpen enabled)             │
│    - User runs command "TSQLRefine: Run"                │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 2. CLIENT EVENT HANDLER                                 │
│    - extension.ts receives VS Code event                │
│    - Sends LSP notification/request to server           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 3. SERVER EVENT HANDLER (server.ts)                     │
│    - onDidChangeContent / onDidSave / onDidOpen         │
│    - Checks settings (runOnSave, runOnType, enableLint) │
│    - Calls requestLint()                                │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 4. LINT SCHEDULER (scheduler.ts)                        │
│    - Receives lint request with reason + version        │
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
│    - Cancel any in-flight lint for same URI             │
│    - Send operationState "started" notification         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 6. BUILD DOCUMENT CONTEXT                               │
│    - Load document-scoped settings                      │
│    - Create DocumentContext with paths and state         │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 7. RUN LINTER CLI (runLinter.ts → processRunner.ts)     │
│    - Resolve command (cache or check PATH)              │
│    - Build args: lint -q --utf8 --output json --stdin   │
│    - Spawn process, pipe document content to stdin      │
│    - Collect stdout/stderr, handle timeout/cancellation │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 8. CHECK EXIT CODE                                      │
│    - 0/1 = success (parse stdout for diagnostics)       │
│    - 2 = parse error, 3 = config error, 4 = runtime     │
│    - Exit codes >= 2 show user-facing warning            │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 9. PARSE JSON OUTPUT (parseOutput.ts)                   │
│    - JSON.parse(stdout) to CliJsonOutput structure       │
│    - Map <stdin> paths back to original URI              │
│    - Create VS Code Diagnostic objects                   │
│    - Set severity, character-level range, code, source   │
│    - Attach codeDescription.href for rule documentation  │
│    - Mark fixable diagnostics via data.fixable           │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 10. PUBLISH DIAGNOSTICS                                 │
│     - connection.sendDiagnostics({ uri, diagnostics })  │
│     - Send operationState "completed" notification      │
│     - Release semaphore slot                            │
│     - Drain queue for next pending lint                 │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ 11. CLIENT DISPLAYS DIAGNOSTICS                         │
│     - VS Code receives diagnostics via LSP              │
│     - Shows squiggles in editor                         │
│     - Updates Problems panel                            │
│     - Status bar updates diagnostic counts              │
└─────────────────────────────────────────────────────────┘
```

### Format Operation Flow

1. User triggers format (command, `Shift+Alt+F`, or format-on-save)
2. Server receives `onDocumentFormatting` request
3. Cancels any in-flight format for same URI
4. Sends `operationState "started"` notification
5. `runFormatter()` spawns CLI with `format -q --utf8 --stdin`
6. Exit code 0 = success (stdout contains formatted SQL)
7. Returns `TextEdit[]` for full document replacement
8. Sends `operationState "completed"` notification

### Fix Operation Flow

1. User triggers fix command or selects code action
2. Server receives `tsqlrefine/fixDocument` request
3. Cancels any in-flight fix for same URI
4. `runFixer()` spawns CLI with `fix -q --utf8 --stdin --severity`
5. Exit code 0 = success (stdout contains fixed SQL)
6. Returns `TextEdit[]` applied via `connection.workspace.applyEdit()`
7. Lint is re-run automatically to update diagnostics

### State Management

#### Per-URI State Tracking

```typescript
// Three DocumentStateManager instances
const lintStateManager = new DocumentStateManager();
const formatStateManager = new DocumentStateManager();
const fixStateManager = new DocumentStateManager();

// Each manager tracks per-URI:
// - inFlightByUri: Map<string, AbortController>
// - savedVersionByUri: Map<string, number>

// Scheduler state
private readonly pendingByUri = new Map<string, PendingLint>();
private readonly debounceTimerByUri = new Map<string, NodeJS.Timeout>();
private readonly queuedUris: string[] = [];
```

#### State Transitions

1. **Document Opens**
   - Set saved version if file scheme
   - Trigger lint if `runOnOpen` enabled

2. **Document Changes**
   - Cancel in-flight lint
   - Start debounced lint if `runOnType` enabled

3. **Document Saves**
   - Update saved version to current version
   - Trigger lint if `runOnSave` enabled

4. **Operation Starts**
   - Cancel previous in-flight operation for same URI
   - Create new AbortController

5. **Operation Completes**
   - Publish diagnostics (lint) or return edits (format/fix)
   - Send operation state notification

6. **Document Closes**
   - Cancel in-flight lints
   - Clear all state for URI
   - Clear diagnostics

## Configuration System

### Configuration Hierarchy

1. **Default Settings** (in code, `defaultSettings` object)
2. **User Settings** (global)
3. **Workspace Settings** (workspace root)
4. **Folder Settings** (multi-root workspaces)
5. **Document-Scoped Settings** (per-file)

### Settings Resolution

```typescript
async function getSettingsForDocument(uri: string): Promise<TsqlRefineSettings> {
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

### Configuration Updates

When configuration changes:
1. `onDidChangeConfiguration` event fires
2. Server refreshes global settings via `SettingsManager`
3. If `path` setting changed, re-verifies installation
4. Next operation uses updated settings
5. No restart required

## Testing Architecture

### Test Categories

#### 1. Unit Tests

**Location**: [src/test/unit/](../src/test/unit/)

Test individual functions in isolation:
- **scheduler.test.ts**: LintScheduler concurrency, debouncing, queue management
- **parseOutput.test.ts**: JSON output parsing and error scenarios
- **decodeOutput.test.ts**: Encoding detection and BOM handling
- **lintOperations.test.ts**: Lint operations and exit code handling
- **formatOperations.test.ts**: Format operations
- **fixOperations.test.ts**: Fix operations
- **runFixer.test.ts**: Fixer CLI runner
- **handlers.test.ts**: File event handlers
- **resolveConfigPath.test.ts**: Config file resolution
- **documentEdit.test.ts**: Document edit utility
- **textUtils.test.ts**: Text processing utilities
- **normalize.test.ts**: Path normalization
- **settingsManager.test.ts**: Settings manager
- **notificationManager.test.ts**: Notification manager

**Run Command**: `npm run test:unit`

**Tools**: Mocha test runner with `.mocharc.unit.json` config

#### 2. E2E Tests

**Location**: [src/test/e2e/](../src/test/e2e/)

Test full integration with VS Code and tsqlrefine CLI:
- **extension.test.ts**: Extension activation and commands
- **runLinter.test.ts**: Linter CLI integration
- **localTsqlRefine.test.ts**: Real tsqlrefine CLI integration
- **startup.test.ts**: Startup verification
- **formatter.test.ts**: Formatter E2E tests
- **fix.test.ts**: Fix command and code action tests

**Run Command**: `npm run test:e2e`

**Tools**:
- `@vscode/test-cli` and `@vscode/test-electron` for VS Code instance
- `.vscode-test.mjs` configuration

#### 3. Property-Based Tests

Integrated into unit test files using **fast-check**:
- Custom arbitraries in [src/test/helpers/arbitraries.ts](../src/test/helpers/arbitraries.ts)
- Verifies invariants like idempotence, round-trip, and monotonicity
- Complements example-based tests for broader input coverage

### Test Helpers

**Location**: [src/test/helpers/](../src/test/helpers/)

- **testConstants.ts**: Centralized test timeouts, delays, and retry values
- **testFixtures.ts**: Reusable test data factories
- **e2eTestHarness.ts**: E2E test setup/teardown automation
- **cleanup.ts**: File system cleanup utilities
- **arbitraries.ts**: Custom fast-check arbitraries for property-based testing

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

Contains sample SQL files and configuration for E2E tests.

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
npm run verify         # Run all checks (test + typecheck + lint + format)
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

#### Path Separators
Use `path.join()` and `path.resolve()` instead of string concatenation:
```typescript
// Good
const fullPath = path.join(dir, 'file.sql');

// Bad
const fullPath = dir + '/' + 'file.sql';
```

### Cross-Platform Testing

Tests run on all three platforms via GitHub Actions CI:
- Ubuntu, Windows, and macOS
- Path normalization ensures consistent behavior

## Performance Characteristics

### Concurrency Limits

- **Max Concurrent Lints**: 4 (`MAX_CONCURRENT_RUNS`)
- **Semaphore-based**: Prevents resource exhaustion
- **Queue Depth**: Unlimited (in-memory)

### Debouncing

- **Default Delay**: 500ms for typing events
- **Adjustable**: Via `debounceMs` setting
- **Bypassed**: For save, open, and manual triggers

### Caching

- **Command Availability**: 30-second TTL cache per configured path
- **Config File Path**: 5-second TTL cache with 100-entry max
- **Settings**: Cached globally, refreshed on configuration change

### Timeout Protection

- **Lint**: Default 10s (via `timeoutMs` setting)
- **Format**: Default 10s (via `formatTimeoutMs` setting)
- **Process Killing**: Forceful termination after timeout

## Error Handling

### CLI Exit Codes

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | Success (no violations / operation succeeded) | Parse stdout |
| 1 | Rule violations found (lint only) | Parse stdout for diagnostics |
| 2 | Parse error (SQL could not be parsed) | Show warning |
| 3 | Configuration error (config file load failure) | Show warning |
| 4 | Runtime exception (internal error) | Show warning |

Exit codes >= 2 trigger user-facing warnings with specific descriptions via `CLI_EXIT_CODE_DESCRIPTIONS`.

### Error Sources

1. **Executable Not Found**: Triggers notification with install guide link (5-minute cooldown)
2. **Spawn Errors**: Rejects promise, clears diagnostics
3. **Timeout**: Kills process, returns partial output
4. **Cancellation**: Respects AbortSignal, cleans up resources (no user notification)
5. **CLI Errors**: Shared `handleOperationError()` provides consistent error handling for format/fix

## Future Extensibility

The architecture supports adding:

1. **Custom Lint Rules**: Via tsqlrefine config files and plugins
2. **Multiple File Types**: Extend beyond SQL files
3. **Workspace-wide Linting**: Batch operation across files
4. **Hover Provider**: Show rule details on diagnostic hover
5. **DiagnosticTag Support**: Visual differentiation for unnecessary/deprecated code
6. **Configuration UI**: Settings editor integration
7. **Config File Watching**: Re-lint on config changes

## References

- [Language Server Protocol Specification](https://microsoft.github.io/language-server-protocol/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TSQLRefine Documentation](https://github.com/masmgr/tsqlrefine)
- [esbuild Documentation](https://esbuild.github.io/)

---

**Document Version**: 2.0
**Last Updated**: 2026-02-14
**Extension Version**: 0.0.2
