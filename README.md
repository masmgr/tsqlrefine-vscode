# TSQLRefine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.0.3-blue.svg)](https://github.com/masmgr/tsqlrefine-vscode)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.108.1+-007ACC.svg)](https://code.visualstudio.com/)
[![CI](https://github.com/masmgr/tsqlrefine-vscode/workflows/CI/badge.svg)](https://github.com/masmgr/tsqlrefine-vscode/actions/workflows/ci.yml)
[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/masmgr.tsqlrefine?label=VS%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=masmgr.tsqlrefine)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/masmgr.tsqlrefine)](https://marketplace.visualstudio.com/items?itemName=masmgr.tsqlrefine)

A lightweight Visual Studio Code extension that integrates [TSQLRefine](https://github.com/masmgr/tsqlrefine) into your editor, providing real-time linting, auto-fixing, and formatting for T-SQL files.

## Features

- **Lint** - Real-time linting on save, type, and open with severity filtering
- **Fix** - Auto-fix issues via command or quick fix action
- **Format** - Format T-SQL with editor integration and format-on-save support

For details, see [Features](docs/features.md).

## Quick Start

### 1. Install TSQLRefine CLI

```bash
dotnet tool install -g TSQLRefine
```

> Other options: [Chocolatey](https://community.chocolatey.org/) (`choco install tsqlrefine`) or [GitHub Releases](https://github.com/masmgr/tsqlrefine/releases). See the [TSQLRefine installation guide](https://github.com/masmgr/tsqlrefine#installation) for more.

### 2. Install this extension

Install **TSQLRefine** from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=masmgr.tsqlrefine), or search `masmgr.tsqlrefine` in the Extensions view (`Ctrl+Shift+X`).

### 3. Open a `.sql` file

Linting runs automatically when you open or save a SQL file. You can also use the Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `TSQLRefine: Run` | Lint the current file |
| `TSQLRefine: Format` | Format the current file |
| `TSQLRefine: Fix` | Auto-fix issues in the current file |

## Typical Use Cases

- Formatting and linting SQL files before committing
- Catching errors in stored procedures without running them
- Enforcing team-wide SQL style consistency
- Integrating static analysis into CI pipelines

## Extension Settings

All settings are under the `tsqlrefine` namespace: executable path, lint behavior, timeouts, and feature toggles.

For the full settings reference and configuration examples, see [Settings](docs/settings.md).

## Supported Languages

This extension activates for files with the following language IDs:
- `sql`
- `tsql`
- `mssql`

## Troubleshooting

### "tsqlrefine not found"

1. Verify installation: `tsqlrefine --version`
2. If not in PATH, set `tsqlrefine.path` in settings
3. Restart VS Code after changing settings

### Linting is slow or times out

1. Increase timeout: `"tsqlrefine.timeoutMs": 30000`
2. Disable run-on-type: `"tsqlrefine.runOnType": false`

### Config file not being used

1. Leave `configPath` empty for auto-detection
2. Or set explicitly: `"tsqlrefine.configPath": "${workspaceFolder}/tsqlrefine.json"`

## Contributing

Issues and pull requests are welcome!

- Report issues at the [GitHub repository](https://github.com/masmgr/tsqlrefine-vscode/issues)
- See [DEVELOPMENT.md](DEVELOPMENT.md) for development guidelines
- Run `npm run verify` to execute the full check suite

## About This Extension

This extension serves as an alternative to [tsqlrefine-vscode-extension](https://github.com/tsqlrefine/tsqlrefine-vscode-extension). The original extension references an outdated version of TSQLRefine, so this project was created to enable integration with the latest TSQLRefine releases.

## License

MIT License - see the [LICENSE](LICENSE) file for details.
