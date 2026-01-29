# TSQLRefine

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)](https://github.com/masmgr/tsqllint-vscode-lite)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.108.1+-007ACC.svg)](https://code.visualstudio.com/)

A lightweight Visual Studio Code extension that integrates [TSQLRefine](https://github.com/tsqlrefine/tsqlrefine) into your editor, providing real-time linting for T-SQL files with a powerful Language Server Protocol architecture.

## About This Extension

This extension serves as an alternative to [tsqlrefine-vscode-extension](https://github.com/tsqlrefine/tsqlrefine-vscode-extension). The original extension references an outdated version of TSQLRefine, so this project was created to enable integration with the latest TSQLRefine releases.

### Key Points

- **TSQLRefine must be installed separately** - This extension does not automatically download or bundle TSQLRefine. You need to install it independently.
- **Distinguishes errors and warnings** - This extension displays TSQLRefine errors and warnings with appropriate severity levels in VS Code's diagnostic interface.

## Features

- **Real-time linting**: Automatically lint SQL files as you type or save
- **Manual commands**: Run lint commands on demand
- **Customizable**: Configure lint behavior, timeouts, and diagnostic display
- **Efficient architecture**: Uses LSP for non-blocking operation

## Requirements

**TSQLRefine CLI must be installed separately.** This extension is a VS Code integration for TSQLRefine.

### Supported Language IDs

This extension runs on files with the following language IDs:
- `sql`
- `tsql`
- `mssql`

### Installing TSQLRefine

#### Using .NET CLI (recommended):
```bash
dotnet tool install -g TSQLRefine
```

#### Using Chocolatey (Windows):
```bash
choco install tsqlrefine
```

#### Other options:
Download from the [TSQLRefine releases page](https://github.com/tsqlrefine/tsqlrefine/releases) or follow the [TSQLRefine installation guide](https://github.com/tsqlrefine/tsqlrefine#installation).

After installation, verify TSQLRefine is available:
```bash
tsqlrefine --version
```

## Extension Settings

This extension contributes the following settings under the `tsqlrefine` namespace:

### `tsqlrefine.path`
- **Type**: `string`
- **Default**: `""` (searches PATH)
- **Description**: Path to the tsqlrefine executable. Leave empty to use the tsqlrefine found in your PATH.
- **Example**: `"C:\\tools\\tsqlrefine\\tsqlrefine.exe"` or `"/usr/local/bin/tsqlrefine"`

### `tsqlrefine.configPath`
- **Type**: `string`
- **Default**: `""` (auto-detects `.tsqlrefinerc` in the workspace; otherwise uses tsqlrefine default)
- **Description**: Path to your TSQLRefine configuration file (`.tsqlrefinerc`). If set, passed as the `-c` argument to tsqlrefine. If empty, the extension searches for the nearest `.tsqlrefinerc` from the SQL file's folder up to the workspace root.
- **Example**: `"${workspaceFolder}/.tsqlrefinerc"`

### `tsqlrefine.runOnSave`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically run lint when a SQL document is saved.

### `tsqlrefine.runOnType`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Run lint while typing (debounced). Useful for real-time feedback but may impact performance on large files.

### `tsqlrefine.runOnOpen`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Run lint when a SQL document is opened.

### `tsqlrefine.debounceMs`
- **Type**: `number`
- **Default**: `500`
- **Description**: Debounce time in milliseconds for run-on-type. Higher values reduce CPU usage but increase delay before seeing lint results.

### `tsqlrefine.timeoutMs`
- **Type**: `number`
- **Default**: `10000` (10 seconds)
- **Description**: Timeout in milliseconds for lint execution. If tsqlrefine takes longer than this, the process will be killed.

### `tsqlrefine.maxFileSizeKb`
- **Type**: `number`
- **Default**: `0` (disabled)
- **Description**: Maximum file size in KB for automatic linting (open/save/type). Manual lint still works. Set this to prevent accidental linting on very large files.

## Configuration Examples

### Basic Configuration (`.vscode/settings.json`)

```json
{
  "tsqlrefine.runOnSave": true,
  "tsqlrefine.runOnType": false
}
```

### Advanced Configuration with Custom Path and Config

```json
{
  "tsqlrefine.path": "C:\\tools\\tsqlrefine\\tsqlrefine.exe",
  "tsqlrefine.configPath": "${workspaceFolder}/.tsqlrefinerc",
  "tsqlrefine.runOnSave": true,
  "tsqlrefine.runOnType": true,
  "tsqlrefine.debounceMs": 1000,
  "tsqlrefine.timeoutMs": 15000
}
```

### Real-time Linting Setup

```json
{
  "tsqlrefine.runOnType": true,
  "tsqlrefine.debounceMs": 500
}
```

## Commands

This extension provides the following commands:

### `TSQLRefine: Run`
- **Command ID**: `tsqlrefine.run`
- **Description**: Manually run lint on the current SQL file
- **Usage**: Command Palette (Ctrl+Shift+P / Cmd+Shift+P) → "TSQLRefine: Run"

### `TSQLRefine: Open Install Guide`
- **Command ID**: `tsqlrefine.openInstallGuide`
- **Description**: Open the installation guide for tsqlrefine (TSQLRefine CLI)
- **Usage**: Command Palette → "TSQLRefine: Open Install Guide"

## How It Works

This extension uses the **Language Server Protocol (LSP)** architecture to provide efficient, non-blocking linting:

1. Your SQL file is automatically linted when saved (or while typing if enabled)
2. The extension spawns the TSQLRefine CLI and parses its output
3. Results are displayed as diagnostics (squiggles) in your editor
4. The lint scheduler manages concurrency to prevent performance issues

For detailed architecture information, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Troubleshooting

### "tsqlrefine not found" or "Command failed: tsqlrefine"

**Cause**: The tsqlrefine executable is not in your PATH or the specified path is incorrect.

**Solutions**:
1. Verify tsqlrefine is installed: `tsqlrefine --version`
2. If not installed, follow the [installation instructions](#installing-tsqlrefine)
3. If installed but not in PATH, set `tsqlrefine.path` in your settings:
   ```json
   {
     "tsqlrefine.path": "C:\\path\\to\\tsqlrefine.exe"
   }
   ```
4. Restart VS Code after changing settings

**Tips**:
- The extension will also show a diagnostic in the Problems panel and offer an "Open Install Guide" button.
- Check logs in the VS Code Output panel under `tsqlrefine`.

### Linting is slow or times out

**Cause**: Large files or complex queries may take longer than the default timeout.

**Solutions**:
1. Increase the timeout in settings:
   ```json
   {
     "tsqlrefine.timeoutMs": 30000
   }
   ```
2. Disable run-on-type for large files:
   ```json
   {
     "tsqlrefine.runOnType": false
   }
   ```
3. Use manual lint commands instead of automatic linting

### Path issues on Windows

**Cause**: Windows paths require proper escaping in JSON.

**Solution**: Use double backslashes or forward slashes:
```json
{
  "tsqlrefine.path": "C:\\tools\\tsqlrefine.exe"
}
```
or
```json
{
  "tsqlrefine.path": "C:/tools/tsqlrefine.exe"
}
```

### Config file not being used

**Cause**: The `configPath` is not set, points to an incorrect location, or a different `.tsqlrefinerc` is being picked up.

**Solutions**:
1. Leave `tsqlrefine.configPath` empty to auto-detect `.tsqlrefinerc` (nearest to the file in the workspace)
2. Or set the config path explicitly (overrides auto-detection):
```json
{
  "tsqlrefine.configPath": "${workspaceFolder}/.tsqlrefinerc"
}
```

## Known Issues

- The extension activates for language IDs: `sql`, `tsql`, `mssql`
- On Windows, `.cmd` and `.bat` executables are wrapped with `cmd.exe /c`

## Release Notes

### 1.0.0

Stable release with enhanced features and improved tooling:
- **TSQLRefine installation verification**: Proactive startup check for tsqlrefine availability
- **Comprehensive logging system**: Added logging infrastructure for better diagnostics
- **Node.js 24 support**: Upgraded for improved performance and security
- **Dependency updates**: Updated Biome to 2.3.11 and GitHub Actions to latest versions
- **Cleaner project structure**: Removed unnecessary `.vscode-test` configuration files
- All features from 0.0.2 (Real-time linting with LSP architecture, manual commands, configurable options)

### 0.0.2

Initial release of tsqlrefine:
- Real-time linting with LSP architecture
- Manual lint commands
- Configurable timeout and debouncing
- Support for custom tsqlrefine paths and config files
- Full-line diagnostic highlighting

## Contributing

Issues and pull requests are welcome!

- Report issues at the [GitHub repository](https://github.com/masmgr/tsqllint-vscode-lite/issues)
- See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and development guidelines
- Run `npm run verify` to execute the full check suite (tests, typecheck, lint, format)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Enjoy linting your T-SQL code!**
