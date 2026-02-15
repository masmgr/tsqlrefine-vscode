# Change Log

All notable changes to the "tsqlrefine" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
