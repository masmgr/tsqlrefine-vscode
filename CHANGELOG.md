# Change Log

All notable changes to the "tsqllint-lite" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.1] - 2026-01-17

### Added
- **Real-time T-SQL linting** with TSQLLint integration
- **Language Server Protocol (LSP) architecture** for non-blocking, efficient operation
  - Client-server architecture with separate processes
  - Supports document synchronization and lifecycle management
- **Automatic linting triggers**:
  - On save (`tsqllint.runOnSave` setting, enabled by default)
  - While typing (`tsqllint.runOnType` setting, disabled by default)
- **Manual lint command**: `TSQLLint: Run` for on-demand linting
- **Intelligent lint scheduling**:
  - Concurrent execution control (max 4 simultaneous lint processes)
  - Smart queuing for pending lint requests
  - Debouncing for typing events (configurable via `tsqllint.debounceMs`)
  - Document version tracking to ensure accuracy
- **Customizable diagnostic display**:
  - Character-level highlighting (default)
  - Full-line highlighting option (`tsqllint.rangeMode`)
- **Flexible configuration options**:
  - Custom TSQLLint executable path (`tsqllint.path`)
  - Custom TSQLLint config file path (`tsqllint.configPath`)
  - Configurable timeout (`tsqllint.timeoutMs`, default 10 seconds)
  - Configurable debounce delay (`tsqllint.debounceMs`, default 500ms)
- **Cross-platform support**:
  - Windows, macOS, and Linux compatibility
  - Proper handling of Windows `.cmd` and `.bat` executables
  - Case-insensitive path comparison on Windows
- **Temporary file support** for linting unsaved documents
- **Comprehensive error handling**:
  - Process timeout protection
  - Cancellation support for in-flight lint requests
  - Executable resolution with caching (30s TTL)

### Technical Details
- Uses `vscode-languageclient` and `vscode-languageserver` for LSP implementation
- Built with esbuild for optimized bundle size
- Written in TypeScript with strict type checking
- Comprehensive test suite (unit tests and E2E tests)

### Requirements
- VS Code version 1.108.1 or higher
- TSQLLint CLI must be installed separately (via .NET CLI, Chocolatey, or manual installation)

---

**Note**: This is the initial release. Future versions will be documented here with their respective changes.