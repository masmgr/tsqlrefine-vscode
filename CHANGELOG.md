# Change Log

All notable changes to the "tsqlrefine" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `tsqlrefine.setAsDefaultFormatter` command to resolve conflicts with other SQL formatter extensions (e.g. mssql)
- `tsqlrefine.fixTimeoutMs` setting for independent timeout control on fix operations (previously shared `timeoutMs`)
- Verbose tracing via `connection.console.debug()` for detailed operation logs when trace logging is enabled

### Fixed
- Format/fix operations no longer clobber a newer in-flight operation when an error clears the in-flight state (`clearInFlight` guard)
- `checkCommandAvailable` in processRunner no longer double-resolves on concurrent calls
- Lint timeout now correctly clears the in-flight AbortController, preventing stale controllers
- Malformed diagnostics from CLI output are skipped instead of crashing the parser
- Formatter request handling updated to match current LSP server contract
- Error handling added to user-facing command handlers and `sendNotification` calls in file event handlers
- Fire-and-forget `requestLint` calls marked with `void` to suppress unhandled-promise warnings
- Numeric `timeout` and `debounce` settings now validated and normalised
- `engines.vscode` aligned with `@types/vscode` version to fix extension packaging
- Transitive dependency vulnerabilities resolved (`npm audit`)

### Changed
- Per-document settings are now cached to reduce LSP round-trips (5 s TTL, 100-entry LRU)
- Debug/trace logging is lazy-evaluated and gated behind the trace setting to reduce overhead
- Unused `filePath` option removed from `runFormatter` / `runFixer` signatures

## [1.0.0] - 2026-02-17

## [0.1.1] - 2026-02-17

## [0.1.0] - 2026-02-16

### Added
- Plugin support via `tsqlrefine.allowPlugins` setting (opt-in, default: `false`). When enabled, passes `--allow-plugins` to all CLI invocations to load plugin DLLs from configuration.

## [0.0.3] - 2026-02-15

### Added
- Default formatter registration for SQL languages

### Fixed
- Output buffer size limit to prevent memory exhaustion in `runProcess`
- Version guard on fix apply to prevent overwriting concurrent edits
- Workspace resolution using path separator boundary and deepest match
- `normalizeExecutablePath` idempotence by trimming after resolve
- Restrict `tsqlrefine.path` and `configPath` to machine-overridable scope
- Remove fallback rule docs URL and rely on CLI-provided `codeDescriptionHref`
- Align `engines.vscode` with `@types/vscode` to fix packaging

### Changed
- Pin GitHub Actions to commit SHAs and add production dependency audit
- Fix dev dependency vulnerabilities (markdown-it, qs, diff)

## [0.0.2] - 2026-02-10

### Added
- UTF-8 encoding support (`--utf8` flag) for Japanese content handling
- Status bar integration showing diagnostic counts and operation state
- E2E test execution with tsqlrefine CLI in CI pipeline
- Rule documentation links via `codeDescription.href` in diagnostics
- Dedicated output channel and operation state notifications

## [0.0.1] - 2026-02-08

### Added
- Initial release of TSQLRefine extension for VS Code
- T-SQL linting, formatting, and auto-fix functionality
- Real-time diagnostics with configurable severity levels
- Code actions for quick fixes
- Installation guide command
