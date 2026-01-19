# TSQLLint Lite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.0.2-blue.svg)](https://github.com/masmgr/tsqllint-vscode-lite)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.108.1+-007ACC.svg)](https://code.visualstudio.com/)

A lightweight Visual Studio Code extension that integrates [TSQLLint](https://github.com/tsqllint/tsqllint) into your editor, providing real-time linting for T-SQL files with a powerful Language Server Protocol architecture.

## About This Extension

This extension serves as an alternative to [tsqllint-vscode-extension](https://github.com/tsqllint/tsqllint-vscode-extension). The original extension references an outdated version of TSQLLint, so this project was created to enable integration with the latest TSQLLint releases.

### Key Points

- **TSQLLint must be installed separately** - This extension does not automatically download or bundle TSQLLint. You need to install it independently.
- **Distinguishes errors and warnings** - This extension displays TSQLLint errors and warnings with appropriate severity levels in VS Code's diagnostic interface.

## Features

- **Real-time linting**: Automatically lint SQL files as you type or save
- **Manual commands**: Run lint commands on demand
- **Customizable**: Configure lint behavior, timeouts, and diagnostic display
- **Efficient architecture**: Uses LSP for non-blocking operation

## Requirements

**TSQLLint CLI must be installed separately.** This extension is a VS Code integration for TSQLLint.

### Installing TSQLLint

#### Using .NET CLI (recommended):
```bash
dotnet tool install -g TSQLLint
```

#### Using Chocolatey (Windows):
```bash
choco install tsqllint
```

#### Other options:
Download from the [TSQLLint releases page](https://github.com/tsqllint/tsqllint/releases) or follow the [TSQLLint installation guide](https://github.com/tsqllint/tsqllint#installation).

After installation, verify TSQLLint is available:
```bash
tsqllint --version
```

## Extension Settings

This extension contributes the following settings under the `tsqllint` namespace:

### `tsqllint.path`
- **Type**: `string`
- **Default**: `""` (searches PATH)
- **Description**: Path to the tsqllint executable. Leave empty to use the tsqllint found in your PATH.
- **Example**: `"C:\\tools\\tsqllint\\tsqllint.exe"` or `"/usr/local/bin/tsqllint"`

### `tsqllint.configPath`
- **Type**: `string`
- **Default**: `""` (uses tsqllint default)
- **Description**: Path to your TSQLLint configuration file (`.tsqllintrc`). Passed as the `-c` argument to tsqllint.
- **Example**: `"${workspaceFolder}/.tsqllintrc"`

### `tsqllint.runOnSave`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Automatically run lint when a SQL document is saved.

### `tsqllint.runOnType`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Run lint while typing (debounced). Useful for real-time feedback but may impact performance on large files.

### `tsqllint.debounceMs`
- **Type**: `number`
- **Default**: `500`
- **Description**: Debounce time in milliseconds for run-on-type. Higher values reduce CPU usage but increase delay before seeing lint results.

### `tsqllint.timeoutMs`
- **Type**: `number`
- **Default**: `10000` (10 seconds)
- **Description**: Timeout in milliseconds for lint execution. If tsqllint takes longer than this, the process will be killed.

## Configuration Examples

### Basic Configuration (`.vscode/settings.json`)

```json
{
  "tsqllint.runOnSave": true,
  "tsqllint.runOnType": false
}
```

### Advanced Configuration with Custom Path and Config

```json
{
  "tsqllint.path": "C:\\tools\\tsqllint\\tsqllint.exe",
  "tsqllint.configPath": "${workspaceFolder}/.tsqllintrc",
  "tsqllint.runOnSave": true,
  "tsqllint.runOnType": true,
  "tsqllint.debounceMs": 1000,
  "tsqllint.timeoutMs": 15000
}
```

### Real-time Linting Setup

```json
{
  "tsqllint.runOnType": true,
  "tsqllint.debounceMs": 500
}
```

## Commands

This extension provides the following commands:

### `TSQLLint: Run`
- **Command ID**: `tsqllint-lite.run`
- **Description**: Manually run lint on the current SQL file
- **Usage**: Command Palette (Ctrl+Shift+P / Cmd+Shift+P) → "TSQLLint: Run"

## How It Works

This extension uses the **Language Server Protocol (LSP)** architecture to provide efficient, non-blocking linting:

1. Your SQL file is automatically linted when saved (or while typing if enabled)
2. The extension spawns the TSQLLint CLI and parses its output
3. Results are displayed as diagnostics (squiggles) in your editor
4. The lint scheduler manages concurrency to prevent performance issues

For detailed architecture information, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Troubleshooting

### "tsqllint not found" or "Command failed: tsqllint"

**Cause**: The tsqllint executable is not in your PATH or the specified path is incorrect.

**Solutions**:
1. Verify tsqllint is installed: `tsqllint --version`
2. If not installed, follow the [installation instructions](#installing-tsqllint)
3. If installed but not in PATH, set `tsqllint.path` in your settings:
   ```json
   {
     "tsqllint.path": "C:\\path\\to\\tsqllint.exe"
   }
   ```
4. Restart VS Code after changing settings

### Linting is slow or times out

**Cause**: Large files or complex queries may take longer than the default timeout.

**Solutions**:
1. Increase the timeout in settings:
   ```json
   {
     "tsqllint.timeoutMs": 30000
   }
   ```
2. Disable run-on-type for large files:
   ```json
   {
     "tsqllint.runOnType": false
   }
   ```
3. Use manual lint commands instead of automatic linting

### Path issues on Windows

**Cause**: Windows paths require proper escaping in JSON.

**Solution**: Use double backslashes or forward slashes:
```json
{
  "tsqllint.path": "C:\\tools\\tsqllint.exe"
}
```
or
```json
{
  "tsqllint.path": "C:/tools/tsqllint.exe"
}
```

### Config file not being used

**Cause**: The `configPath` is not set or points to an incorrect location.

**Solution**: Set the config path explicitly:
```json
{
  "tsqllint.configPath": "${workspaceFolder}/.tsqllintrc"
}
```

## Known Issues

- The extension currently only activates for files with the "sql" language ID
- On Windows, `.cmd` and `.bat` executables are wrapped with `cmd.exe /c`

## Release Notes

### 0.0.2

Initial release of tsqllint-lite:
- Real-time linting with LSP architecture
- Manual lint commands
- Configurable timeout and debouncing
- Support for custom tsqllint paths and config files
- Full-line diagnostic highlighting

## Contributing

Issues and pull requests are welcome!

- Report issues at the [GitHub repository](https://github.com/masmgr/tsqllint-vscode-lite/issues)
- See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and development guidelines

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Enjoy linting your T-SQL code!**
