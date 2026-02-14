# Improvement Proposals

This document outlines potential feature additions and improvements for the tsqlrefine VS Code extension, identified through a comprehensive codebase review at v0.0.1. Items 1-4 have been implemented in v0.0.2.

## Priority Summary

The top 5 recommended improvements, balancing user impact against implementation effort:

| # | Proposal | Category | Priority | Status |
|---|----------|----------|----------|--------|
| 1 | [Status bar integration](#status-bar-integration) | UX | High | Done (v0.0.2) |
| 2 | [Dedicated output channel](#dedicated-output-channel) | UX | High | Done (v0.0.2) |
| 3 | [Diagnostic `codeDescription.href`](#diagnostic-codedescriptionhref) | LSP | High | Done (v0.0.2) |
| 4 | [E2E tests in CI pipeline](#e2e-tests-in-ci-pipeline) | CI/CD | High | Done (v0.0.2) |
| 5 | [Config file auto-detection](#config-file-auto-detection) | Configuration | Medium | Pending |

---

## 1. UX Improvements

### Status Bar Integration

> **Status: Implemented in v0.0.2** - See `src/client/statusBar.ts` and `src/client/statusBarFormat.ts`.

**Priority:** High
**Complexity:** Medium (~100 lines)

Add a status bar item showing diagnostic counts and extension state.

**Current gap:** Users have no at-a-glance indicator of lint results or whether the extension is active. Most popular linter extensions (ESLint, Pylint) provide this as a standard feature.

**Proposed behavior:**
- Display error/warning/info counts (e.g., `TSQLRefine: 2E 1W`)
- Show a spinner during lint/format/fix operations
- Indicate disabled state when `enableLint` is false
- Click to open the Problems panel or trigger a manual lint

**Files likely affected:**
- `src/client/client.ts` — Create and manage the status bar item
- `src/extension.ts` — Register status bar lifecycle
- `src/server/server.ts` — Send diagnostic summary via custom notifications

---

### Dedicated Output Channel

> **Status: Implemented in v0.0.2** - The LSP client creates a dedicated output channel via `LanguageClient`, and `connection.console` provides structured logging on the server side.

**Priority:** High
**Complexity:** Medium (~80 lines)

Create a dedicated VS Code Output Channel for operation logs and debugging.

**Current gap:** All logs go to the server console, which is invisible to end users. When troubleshooting issues (CLI not found, timeout errors, config problems), users have no way to inspect what the extension is doing.

**Proposed behavior:**
- Log CLI commands being executed (with sanitized arguments)
- Log operation results (success, failure, exit codes)
- Log timing information for operations
- Accessible via `Output` panel > `TSQLRefine`

**Files likely affected:**
- `src/client/client.ts` — Create output channel, pass to LanguageClient
- `src/server/server.ts` — Use `connection.console` for structured logging
- `src/server/shared/logging.ts` — Enhance `logOperationContext()` with more detail

---

### Progress Notifications

**Priority:** Medium
**Complexity:** Low (~40 lines)

Show LSP progress notifications during long-running operations.

**Current gap:** When linting large files, there is no visible feedback that an operation is in progress. Users may think the extension is unresponsive.

**Proposed behavior:**
- Show progress bar in the notification area during lint/format/fix
- Include cancellation support via the progress token
- Only show for operations exceeding a brief threshold (e.g., 500ms)

**Files likely affected:**
- `src/server/server.ts` — Send `$/progress` notifications
- `src/server/lint/lintOperations.ts` — Report progress start/end
- `src/server/format/formatOperations.ts` — Report progress start/end
- `src/server/fix/fixOperations.ts` — Report progress start/end

---

## 2. LSP Feature Enhancements

### Diagnostic `codeDescription.href`

> **Status: Implemented in v0.0.2** - `parseOutput.ts` reads `data.codeDescriptionHref` from CLI JSON output and attaches it to diagnostics.

**Priority:** High
**Complexity:** Low (~10 lines)

Attach documentation URLs to each diagnostic via the LSP `codeDescription` property.

**Current gap:** Diagnostics show rule codes but provide no way to learn more about the rule. Users must manually search for rule documentation.

**Proposed behavior:**
- Each diagnostic includes a clickable link in the Problems panel
- Link opens the corresponding rule documentation page
- Requires tsqlrefine CLI to provide rule IDs in JSON output (or a known URL pattern)

**Files likely affected:**
- `src/server/lint/parseOutput.ts` — Add `codeDescription.href` when constructing diagnostics

---

### Hover Provider

**Priority:** Medium
**Complexity:** Medium (~60 lines)

Register a hover provider that shows additional context when hovering over diagnostics.

**Current gap:** Hovering over squiggly lines shows only the diagnostic message. Users cannot see rule details, suggested fixes, or severity information without opening the Problems panel.

**Proposed behavior:**
- Show rule name, severity, and fixability status on hover
- Include a brief description if available from CLI output
- Link to rule documentation

**Files likely affected:**
- `src/server/server.ts` — Register `onHover` handler
- New file or section in lint module for hover content generation

---

### DiagnosticTag Support

**Priority:** Low
**Complexity:** Low (~15 lines)

Use `DiagnosticTag.Unnecessary` and `DiagnosticTag.Deprecated` for applicable diagnostics.

**Current gap:** All diagnostics render identically. VS Code supports visual differentiation — unnecessary code appears dimmed, deprecated code gets a strikethrough — but this requires explicit tag assignment.

**Proposed behavior:**
- Map specific tsqlrefine rule categories to `DiagnosticTag.Unnecessary` (e.g., unused aliases)
- Map deprecation-related rules to `DiagnosticTag.Deprecated`
- Requires rule metadata from CLI output or a static mapping

**Files likely affected:**
- `src/server/lint/parseOutput.ts` — Assign tags based on rule category

---

## 3. Configuration Improvements

### Config File Auto-Detection

**Priority:** Medium
**Complexity:** Medium (~60 lines)

Automatically discover tsqlrefine config files in the workspace.

**Current gap:** Users must manually set `tsqlrefine.configPath` in VS Code settings. If they forget, the extension runs without project-specific configuration, potentially producing unexpected results.

**Proposed behavior:**
- Search for `.tsqlrefine.json`, `tsqlrefine.config.json`, or similar patterns from the document's directory upward
- Fall back to manual `configPath` setting if auto-detection finds nothing
- Cache results per workspace folder with invalidation on file system changes

**Files likely affected:**
- `src/server/shared/resolveConfigPath.ts` — Add auto-detection logic
- `src/server/shared/documentContext.ts` — Use auto-detected config when `configPath` is empty

---

### Fix Operation Timeout Setting

**Priority:** Low
**Complexity:** Low (~15 lines)

Add a dedicated `fixTimeoutMs` setting, separate from lint and format timeouts.

**Current gap:** Lint has `timeoutMs`, format has `formatTimeoutMs`, but fix operations reuse one of these. Fix operations may have different performance characteristics (especially for large files with many fixable issues) and should have independent timeout control.

**Proposed behavior:**
- New setting: `tsqlrefine.fixTimeoutMs` (default: 10000)
- Used by `runFixer.ts` for fix operation timeout

**Files likely affected:**
- `package.json` — Add `fixTimeoutMs` setting definition
- `src/server/state/settingsManager.ts` — Include new setting
- `src/server/fix/runFixer.ts` — Use `fixTimeoutMs`

---

### Exclude Patterns

**Priority:** Medium
**Complexity:** Medium (~50 lines)

Add a setting to exclude files from automatic linting by glob pattern.

**Current gap:** Auto-generated SQL files, migration scripts, or vendor SQL cannot be excluded from automatic linting without disabling the feature entirely. The only workaround is `maxFileSizeKb`, which is a blunt instrument.

**Proposed behavior:**
- New setting: `tsqlrefine.excludePatterns` (array of glob patterns)
- Matched files skip automatic linting (save, type, open)
- Manual linting via `TSQLRefine: Run` still works on excluded files
- Evaluated before spawning the CLI process

**Files likely affected:**
- `package.json` — Add `excludePatterns` setting definition
- `src/server/lint/lintOperations.ts` — Check patterns before linting
- `src/server/state/settingsManager.ts` — Normalize and validate patterns

---

## 4. Reliability & Error Handling

### Client-Side Severity Filtering

**Priority:** Medium
**Complexity:** Low (~15 lines)

Filter diagnostics by `minSeverity` on the client side as a fallback.

**Current gap:** The `minSeverity` setting is only passed to the CLI via the `--severity` flag. If the CLI version does not support this flag or handles it differently, diagnostics below the threshold may still appear.

**Proposed behavior:**
- After parsing CLI output, filter diagnostics where severity is below `minSeverity`
- Acts as a safety net — no effect when CLI correctly honors the flag

**Files likely affected:**
- `src/server/lint/parseOutput.ts` or `src/server/lint/lintOperations.ts` — Add post-parse filtering

---

### Config Path Existence Validation

**Priority:** Low
**Complexity:** Low (~20 lines)

Warn users when the configured `configPath` points to a non-existent file.

**Current gap:** If a user sets `configPath` to a file that does not exist (typo, moved file), the CLI may silently ignore it or produce confusing errors. The extension provides no upfront validation.

**Proposed behavior:**
- On settings change or document open, check if `configPath` file exists
- Show a warning notification if the file is missing
- Include a quick action to open settings

**Files likely affected:**
- `src/server/shared/documentContext.ts` — Add existence check
- `src/server/state/notificationManager.ts` — Add config warning notification

---

### Improved Error Messages

**Priority:** Medium
**Complexity:** Low (~30 lines)

Provide more specific error context in failure notifications.

**Current gap:** Some error messages are generic (e.g., "format failed", "Fix failed") without context about what went wrong. Users must guess whether the issue is a missing CLI, invalid config, or a timeout.

**Proposed behavior:**
- Include the working directory and (sanitized) CLI arguments in error context
- Show elapsed time for timeout errors, with a suggestion to increase the timeout setting
- For missing CLI errors, include the path that was searched

**Files likely affected:**
- `src/server/shared/errorHandling.ts` — Enhance `handleOperationError()`
- `src/server/shared/processRunner.ts` — Include more context in error results

---

## 5. CI/CD & Testing

### E2E Tests in CI Pipeline

> **Status: Implemented in v0.0.2** - CI workflow runs E2E tests on Ubuntu, Windows, and macOS with real tsqlrefine CLI installation.

**Priority:** High
**Complexity:** Medium

Add E2E test execution to the CI workflow.

**Current gap:** The CI pipeline (`ci.yml`) runs only unit tests. E2E tests (`npm run test:e2e`) are run locally but not in CI. Integration failures could reach releases undetected.

**Proposed changes:**
- Add an E2E test step to the CI workflow (at least on Linux)
- E2E tests require a VS Code instance via `@vscode/test-cli`, which needs a display server (use `xvfb-run` on Linux)
- Consider running E2E tests only on PRs targeting the main branch to control CI costs

**Files likely affected:**
- `.github/workflows/ci.yml` — Add E2E test job

---

### Coverage Threshold Enforcement

**Priority:** Medium
**Complexity:** Low

Ensure CI fails when code coverage drops below configured thresholds.

**Current gap:** Coverage reports are generated and uploaded as artifacts, but the build does not fail if coverage is below the thresholds defined in `.c8rc.json` (50% lines, 80% functions, 75% branches). Regressions could go unnoticed.

**Proposed changes:**
- Verify that `c8` exits with a non-zero code when thresholds are not met (it should by default with `check-coverage: true`)
- Add an explicit `npm run test:unit:coverage` step that fails the CI if thresholds are missed

**Files likely affected:**
- `.c8rc.json` — Confirm `check-coverage` is enabled
- `.github/workflows/ci.yml` — Ensure coverage step fails the build on threshold miss

---

### Client Code Test Coverage

**Priority:** Medium
**Complexity:** Medium

Add tests for the LSP client creation logic.

**Current gap:** `src/client/client.ts` has 0% test coverage. The LSP client creation and configuration logic is only exercised through E2E tests, leaving unit-level edge cases untested.

**Proposed changes:**
- Add unit tests for client configuration logic (server options, client options, middleware)
- Mock `vscode-languageclient` to test client creation in isolation

**Files likely affected:**
- New file: `src/test/unit/client.test.ts`

---

## 6. Documentation

### Create CONTRIBUTING.md

**Priority:** Medium
**Complexity:** Low

Create a contributor guide for the project.

**Current gap:** The README references contribution guidelines, but no `CONTRIBUTING.md` file exists. New contributors lack guidance on development setup, coding standards, and PR expectations.

**Proposed content:**
- Development environment setup (prerequisites, clone, install)
- How to run tests (unit, E2E, coverage)
- Code style and linting (Biome configuration)
- Commit message conventions
- PR process and review expectations
- Link to `DEVELOPMENT.md` for architecture details

**Files likely affected:**
- New file: `CONTRIBUTING.md`

---

### Update Extension Recommendations

> **Status: Implemented** - ESLint recommendation replaced with Biome in `.vscode/extensions.json`.

**Priority:** Low
**Complexity:** Low (~2 lines)

Update `.vscode/extensions.json` to reflect current tooling.

**Current gap:** The workspace recommends `dbaeumer.vscode-eslint`, but the project uses Biome for linting and formatting. This may confuse contributors who install the recommended extension.

**Proposed changes:**
- Replace ESLint recommendation with Biome extension (`biomejs.biome`)
- Keep `ms-vscode.extension-test-runner`

**Files likely affected:**
- `.vscode/extensions.json`

---

## 7. Long-Term Features

These features require more significant design work and are recommended for future versions.

### Inline Ignore Comments

**Priority:** Medium (long-term)
**Complexity:** High

Support inline comments to suppress diagnostics on specific lines.

**Example:**
```sql
SELECT * FROM users; -- tsqlrefine-disable-line
```

**Consideration:** This may need support from the tsqlrefine CLI itself. If the CLI does not recognize ignore comments, the extension would need to post-filter diagnostics based on comment parsing.

---

### Workspace-Wide Lint and Fix

**Priority:** Low (long-term)
**Complexity:** High

Allow users to lint or fix all SQL files in a workspace at once.

**Consideration:** Requires batch processing architecture, progress reporting for multi-file operations, and careful concurrency control. The existing `LintScheduler` provides a foundation but would need extension for workspace-level orchestration.

---

### Config File Change Watching

**Priority:** Medium (long-term)
**Complexity:** Medium

Automatically re-lint open documents when the tsqlrefine config file changes.

**Current gap:** If a user modifies their tsqlrefine config, open documents retain stale diagnostics until they are saved or manually re-linted.

**Proposed behavior:**
- Watch the resolved config file path for changes
- On change, re-lint all open SQL documents
- Respect debouncing to avoid excessive re-linting during rapid config edits

**Files likely affected:**
- `src/server/server.ts` — Register file watcher for config path
- `src/server/lint/scheduler.ts` — Trigger re-lint for all tracked documents
