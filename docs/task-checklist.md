# Task Checklist (based on docs/detail-design.md)

## 1. Project structure and LSP wiring
- [x] Client and server entrypoints in `src/` with build output in `out/`.
- [x] LanguageClient uses IPC and targets SQL documents (file + untitled).
- [x] Activation events include `onLanguage:sql` and `tsqllint-lite.run`.
- [x] Command `tsqllint-lite.run` sends `tsqllint/lintDocument`.
- [x] VS Code rename/delete events send `tsqllint/clearDiagnostics`.

## 2. Settings
- [x] Configuration keys exist in `package.json` and defaults in server settings.
- [x] Client syncs `tsqllint` settings; server refreshes on init/change.
- [x] `runOnSave`, `runOnType`, `debounceMs`, `timeoutMs` drive behavior.
- [x] Use `tsqllint.path` and `tsqllint.configPath` in the runner.
- [x] Add `tsqllint.fixOnSave` setting (default false).

## 3. LSP interface
- [x] Standard document notifications handled via `TextDocuments`.
- [x] Custom request `tsqllint/lintDocument` returns `{ ok, issues }`.
- [x] Add custom request `tsqllint/fixDocument`.
- [x] Custom notification `tsqllint/clearDiagnostics` clears per-URI.

## 4. Lint flow and concurrency
- [x] Save-triggered lint (`runOnSave`).
- [x] Type-triggered lint with debounce (`runOnType` + `debounceMs`).
- [x] Per-URI cancellation with `AbortController`.
- [x] Track latest version per URI (pending queue/version checks).
- [x] Optional parallelism limits across URIs.

## 5. Lint target selection
- [x] Use file path for saved documents.
- [x] Support unsaved/untitled via temp file (tsqllint does not accept stdin).
- [x] Map temp file paths back to original URI for diagnostics.
- [x] Restrict `--fix` to saved files (non-dirty).

## 6. External process execution (runTsqllint)
- [x] Spawn `tsqllint` using configured path or PATH fallback.
- [x] Append `-c <configPath>` when configured.
- [x] Append `--fix` when fixing.
- [x] Choose `cwd` by workspace folder or file directory.
- [x] Enforce timeout and propagate cancellation to the child process.
- [x] Return stdout/stderr/exitCode/timedOut/cancelled accurately.

## 7. Stdout parsing (parseOutput)
- [x] Regex pattern matches `<file>(<line>,<col>): <severity> <ruleName> : <message>.` (severity is `error|warning`, trailing `.`).
- [x] Line/column conversion to 0-based.
- [x] Handle summary block (ignore for diagnostics) and "plain messages" like invalid path/dir.
- [x] Severity mapping to LSP `DiagnosticSeverity`.
- [x] Path normalization against `cwd` and URI fsPath.
- [x] Range fallback when column exceeds line length.

## 8. Diagnostics update
- [x] Publish diagnostics per URI after parsing.
- [x] Publish empty diagnostics on close/error/timeout.
- [x] Optional range-length policy setting (full-line vs 1-char).

## 9. Notifications and logging
- [x] Warn on run failure and timeout.
- [x] Preflight-check `tsqllint` exists (path/PATH) and notify when missing.
- [x] Notify for config errors, or stderr conditions.
- [x] Notify after `--fix` run (e.g., show fixed count when available).
- [x] Route detailed logs to LSP output channel.

## 10. Tests
- [x] Unit tests for `parseOutput`.
- [x] Expand unit coverage (severity variants, path forms, col edge cases).
- [ ] Integration test with fake CLI for `runTsqllint`.
- [ ] Extension test to verify Problems panel updates.
