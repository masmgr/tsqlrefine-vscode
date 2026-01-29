# Change Log

All notable changes to the "tsqlrefine" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-01-27

### Added
- **Auto-detection of `.tsqlrefinerc` config file**: The extension now automatically searches for `.tsqlrefinerc` from the SQL file's folder up to the workspace root when `tsqlrefine.configPath` is not explicitly set
- **TSQLRefine installation guide command**: New `TSQLRefine: Open Install Guide` command to help users install TSQLRefine CLI
- **File size limit setting**: New `tsqlrefine.maxFileSizeKb` setting to prevent automatic linting on large files (manual lint still works)
- **Multi-language support**: Extension now activates for `sql`, `tsql`, and `mssql` language IDs
- **Verification script**: Added `npm run verify` script to run tests, typecheck, lint, and format in one command

### Changed
- **Improved UX**: Enhanced error messages and diagnostics with actionable buttons (e.g., "Open Install Guide")
- **Configuration improvements**: Auto-detection of config file reduces manual configuration needs
- **Server implementation**: Refactored to use `documentText` for more reliable linting of unsaved documents

### Fixed
- **E2E test stability**: Fixed document creation and configuration application order in E2ETestHarness

---

## [1.0.0] - 2026-01-20

### Added
- **TSQLRefine installation verification**: Proactive startup check for tsqlrefine availability with user-friendly error messages
- **Comprehensive logging system**: Added logging infrastructure for better debugging and diagnostics
- **Updated Node.js support**: Upgraded to Node.js 24 for improved performance and security

### Changed
- **Dependency updates**:
  - Updated Biome from 1.9.4 to 2.3.11 for better code quality tooling
  - Bumped GitHub Actions dependencies to latest versions (actions/checkout, actions/setup-node, actions/upload-artifact, softprops/action-gh-release)
- **Project structure**: Cleaned up `.vscode-test` configuration files for simpler testing setup
- **CI/CD**: Consolidated develop and main branches for streamlined release workflow

### Fixed
- Biome linting errors from dependencies update

---

## [0.0.2] - 2026-01-19

### Fixed
- **CI/CD improvements**:
  - Fixed release workflow permissions to enable GitHub Actions deployment
  - Enhanced `.github/workflows/release.yml` with proper write permissions

### Changed
- Updated version in package.json to 0.0.2
- Updated version badge in README.md

---

## [0.0.1] - 2026-01-18

### Added
- **Real-time T-SQL linting** with TSQLRefine integration
- **Language Server Protocol (LSP) architecture** for non-blocking, efficient operation
  - Client-server architecture with separate processes
  - Supports document synchronization and lifecycle management
- **Automatic linting triggers**:
  - On save (`tsqlrefine.runOnSave` setting, enabled by default)
  - On open (`tsqlrefine.runOnOpen` setting, enabled by default)
  - While typing (`tsqlrefine.runOnType` setting, disabled by default)
- **Manual lint command**: `TSQLRefine: Run` for on-demand linting
- **Intelligent lint scheduling**:
  - Concurrent execution control (max 4 simultaneous lint processes)
  - Smart queuing for pending lint requests
  - Debouncing for typing events (configurable via `tsqlrefine.debounceMs`)
  - Document version tracking to ensure accuracy
- **Customizable diagnostic display**:
  - Full-line highlighting for all diagnostics (rangeMode removed for simplicity)
- **Flexible configuration options**:
  - Custom TSQLRefine executable path (`tsqlrefine.path`)
  - Custom TSQLRefine config file path (`tsqlrefine.configPath`)
  - Configurable timeout (`tsqlrefine.timeoutMs`, default 10 seconds)
  - Configurable debounce delay (`tsqlrefine.debounceMs`, default 500ms)
  - Auto-lint on open setting (`tsqlrefine.runOnOpen`)
- **Cross-platform support**:
  - Windows, macOS, and Linux compatibility
  - Proper handling of Windows `.cmd` and `.bat` executables
  - Case-insensitive path comparison on Windows
  - Command line output encoding detection and handling
- **File lifecycle management**:
  - Temporary file support for linting unsaved documents
  - Diagnostics clearing on file delete and rename operations
- **Comprehensive error handling**:
  - Process timeout protection
  - Cancellation support for in-flight lint requests
  - Executable resolution with caching (30s TTL)
- **Development tooling**:
  - Comprehensive test suite (unit tests with 52%+ coverage and E2E tests)
  - Pre-commit hooks with Husky for code quality
  - Automated formatting and linting with Biome
  - CI/CD workflow with GitHub Actions
  - Dependabot for automated dependency updates

### Technical Details
- Uses `vscode-languageclient` and `vscode-languageserver` for LSP implementation
- Built with esbuild for optimized bundle size
- Written in TypeScript with strict type checking
- Test framework: Mocha for unit tests, VS Code Test for E2E tests
- Code coverage with c8 (targets: 50% lines, 80% functions, 75% branches)

### Documentation
- Comprehensive README with installation and usage instructions
- DEVELOPMENT.md for contributor guidance
- ARCHITECTURE.md explaining the internal design
- CLAUDE.md with AI coding assistant instructions

### Requirements
- VS Code version 1.108.1 or higher
- TSQLRefine CLI must be installed separately (via .NET CLI, Chocolatey, or manual installation)

---

**Note**: This is the initial release. Future versions will be documented here with their respective changes.