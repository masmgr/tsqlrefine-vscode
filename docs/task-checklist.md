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
- [x] Integration test with fake CLI for `runTsqllint`.
- [x] Extension test to verify Problems panel updates.
- [x] Local-only E2E test: run real `tsqllint` binary if installed (skip when missing).
- [ ] Extension test: `tsqllint-lite.run` updates diagnostics (works even when `runOnSave=false`).
- [ ] Extension test: run-on-type (`runOnType=true`) runs on unsaved edits (temp file flow).
- [ ] Extension test: fix flow (`tsqllint-lite.fix` or `fixOnSave=true`) runs `--fix` then re-lints (diagnostics refresh).
- [ ] Extension test: delete/rename clears diagnostics via `tsqllint/clearDiagnostics` (old URI becomes empty).
- [ ] Unit/integration tests for `runTsqllint`: timeout (`timedOut=true`) and abort (`cancelled=true`) paths.
- [ ] Unit test for `parseOutput`: `targetPaths` allows mapping temp file output back to original URI.

## 11. Release readiness (pre-publish)
- [ ] Replace template `README.md` with real docs (commands, settings, usage, limitations).
- [ ] Update `CHANGELOG.md` for `0.0.1` (initial release notes).
- [ ] Run quality gates: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- [ ] Verify packaging metadata in `package.json` (e.g. `repository`, `publisher`, `keywords`, `icon`) if publishing.

## 12. Architecture review (hardening)
- [ ] Client readiness: use `client.onReady()` (not `client.start()` Promise) before sending requests/notifications.
- [ ] Per-document debounce: base `debounceMs` on `getSettingsForDocument(uri)` (scopeUri override), not global `settings`.
- [ ] Server factoring: split `server.ts` into scheduler/queue vs side-effects (temp files, runner, diagnostics, notifications) for testability.
- [ ] Concurrency: replace `sleep` polling in `runLintWhenPossible` with a semaphore/awaitable queue.
- [ ] Command availability cache: avoid permanent negative cache (add TTL or retry on next run / config change).
- [ ] Parser robustness: decide tolerated stdout variants (missing trailing '.', extra severity, parentheses in file path) and adjust `parseOutput`/tests accordingly.
