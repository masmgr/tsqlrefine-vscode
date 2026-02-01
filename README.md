# TSQLRefine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)](https://github.com/masmgr/tsqllint-vscode-lite)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.108.1+-007ACC.svg)](https://code.visualstudio.com/)

A lightweight Visual Studio Code extension that integrates [TSQLRefine](https://github.com/tsqlrefine/tsqlrefine) into your editor, providing real-time linting, auto-fixing, and formatting for T-SQL files.

## Requirements

**TSQLRefine CLI must be installed separately.** This extension is a VS Code integration for TSQLRefine.

```bash
# Using .NET CLI (recommended)
dotnet tool install -g TSQLRefine

# Verify installation
tsqlrefine --version
```

For other installation options, see [Installing TSQLRefine](#installing-tsqlrefine).

## Features

### Lint

Automatically detect issues in your T-SQL code with real-time linting.

- **Run on save**: Automatically lint when you save a SQL file (enabled by default)
- **Run on type**: Lint while typing with debouncing (optional)
- **Run on open**: Lint when opening a SQL file (enabled by default)
- **Manual lint**: Run `TSQLRefine: Run` command from the Command Palette
- **Severity filtering**: Filter diagnostics by severity level (error, warning, info, hint)

Issues are displayed as squiggles in the editor and listed in the Problems panel.

### Fix

Automatically fix linting issues with a single command or quick fix action.

- **Fix command**: Run `TSQLRefine: Fix` from the Command Palette to apply all available fixes
- **Quick Fix**: Click the lightbulb icon or press `Ctrl+.` / `Cmd+.` to see "Fix all tsqlrefine issues"
- **Severity-aware**: Fixes are applied based on the configured minimum severity level

### Format

Format your T-SQL code using TSQLRefine's formatter.

- **Format command**: Run `TSQLRefine: Format` from the Command Palette
- **Editor integration**: Use VS Code's built-in format commands (`Shift+Alt+F` / `Shift+Option+F`)
- **Format on save**: Works with VS Code's `editor.formatOnSave` setting

## Commands

| Command | Description |
|---------|-------------|
| `TSQLRefine: Run` | Manually lint the current SQL file |
| `TSQLRefine: Fix` | Apply auto-fixes to the current SQL file |
| `TSQLRefine: Format` | Format the current SQL file |
| `TSQLRefine: Open Install Guide` | Open the TSQLRefine installation guide |

## Extension Settings

All settings are under the `tsqlrefine` namespace.

### Executable Path

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `path` | string | `""` | Path to tsqlrefine executable (empty = search PATH) |
| `configPath` | string | `""` | Path to `.tsqlrefinerc` config file (empty = auto-detect) |

### Lint Behavior

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `runOnSave` | boolean | `true` | Lint on save |
| `runOnType` | boolean | `false` | Lint while typing (debounced) |
| `runOnOpen` | boolean | `true` | Lint on open |
| `debounceMs` | number | `500` | Debounce delay for run-on-type (ms) |
| `minSeverity` | string | `"info"` | Minimum severity level (`error`, `warning`, `info`, `hint`) |
| `maxFileSizeKb` | number | `0` | Max file size for auto-lint (0 = unlimited) |

### Timeouts

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `timeoutMs` | number | `10000` | Lint timeout (ms) |
| `formatTimeoutMs` | number | `10000` | Format timeout (ms) |

### Feature Toggles

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `enableLint` | boolean | `true` | Enable linting |
| `enableFormat` | boolean | `true` | Enable formatting |
| `enableFix` | boolean | `true` | Enable auto-fix |

## Configuration Examples

### Basic Setup

```json
{
  "tsqlrefine.runOnSave": true,
  "tsqlrefine.runOnType": false
}
```

### Real-time Linting

```json
{
  "tsqlrefine.runOnType": true,
  "tsqlrefine.debounceMs": 500
}
```

### Custom Executable Path

```json
{
  "tsqlrefine.path": "C:\\tools\\tsqlrefine.exe",
  "tsqlrefine.configPath": "${workspaceFolder}/.tsqlrefinerc"
}
```

### Filter by Severity

```json
{
  "tsqlrefine.minSeverity": "warning"
}
```

## Installing TSQLRefine

### Using .NET CLI (recommended)

```bash
dotnet tool install -g TSQLRefine
```

### Using Chocolatey (Windows)

```bash
choco install tsqlrefine
```

### Other Options

Download from the [TSQLRefine releases page](https://github.com/tsqlrefine/tsqlrefine/releases) or follow the [TSQLRefine installation guide](https://github.com/tsqlrefine/tsqlrefine#installation).

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
2. Or set explicitly: `"tsqlrefine.configPath": "${workspaceFolder}/.tsqlrefinerc"`

## About This Extension

This extension serves as an alternative to [tsqlrefine-vscode-extension](https://github.com/tsqlrefine/tsqlrefine-vscode-extension). The original extension references an outdated version of TSQLRefine, so this project was created to enable integration with the latest TSQLRefine releases.

## Contributing

Issues and pull requests are welcome!

- Report issues at the [GitHub repository](https://github.com/masmgr/tsqllint-vscode-lite/issues)
- See [DEVELOPMENT.md](DEVELOPMENT.md) for development guidelines
- Run `npm run verify` to execute the full check suite

## License

MIT License - see the [LICENSE](LICENSE) file for details.
