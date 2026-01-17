# TSQLLint Lite

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-0.0.1-blue.svg)](https://github.com/masmgr/tsqllint-vscode-lite)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.108.1+-007ACC.svg)](https://code.visualstudio.com/)

A lightweight Visual Studio Code extension that integrates [TSQLLint](https://github.com/tsqllint/tsqllint) into your editor, providing real-time linting for T-SQL files with a powerful Language Server Protocol architecture.

## Features

- **Real-time linting**: Automatically lint SQL files as you type or save
- **Manual commands**: Run lint commands on demand
- **Customizable**: Configure lint behavior, timeouts, and diagnostic display
- **Language Server Protocol**: Uses LSP architecture for efficient, non-blocking operation

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

#### Manual installation:
Download from the [TSQLLint releases page](https://github.com/tsqllint/tsqllint/releases).

After installation, verify TSQLLint is available:
```bash
tsqllint --version
```

## Installation

### From VS Code Marketplace:
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "tsqllint-lite"
4. Click Install

### From VSIX file:
```bash
code --install-extension tsqllint-lite-0.0.1.vsix
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

### `tsqllint.rangeMode`
- **Type**: `string`
- **Enum**: `"character"` | `"line"`
- **Default**: `"character"`
- **Description**: Diagnostic range mode for reported issues.
  - `"character"`: Highlights only the specific character where the issue occurs
  - `"line"`: Highlights the entire line

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
  "tsqllint.timeoutMs": 15000,
  "tsqllint.rangeMode": "line"
}
```

### Real-time Linting Setup

```json
{
  "tsqllint.runOnType": true,
  "tsqllint.debounceMs": 500,
  "tsqllint.rangeMode": "character"
}
```

## Commands

This extension provides the following commands:

### `TSQLLint: Run`
- **Command ID**: `tsqllint-lite.run`
- **Description**: Manually run lint on the current SQL file
- **Usage**: Command Palette (Ctrl+Shift+P / Cmd+Shift+P) → "TSQLLint: Run"

## How It Works

This extension uses the **Language Server Protocol (LSP)** architecture:

1. **Client** (runs in VS Code extension host):
   - Manages the language client connection
   - Registers commands and file lifecycle events

2. **Server** (runs in a separate Node.js process):
   - Handles document synchronization
   - Manages lint scheduling with concurrency control
   - Spawns tsqllint CLI processes
   - Parses output and sends diagnostics back to the client

3. **Lint Scheduler**:
   - Limits to 4 concurrent lint processes
   - Debounces typing events to prevent excessive linting
   - Tracks document versions to ensure lints run against correct content

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

### Diagnostics show entire line instead of specific character

**Cause**: `rangeMode` is set to `"line"`.

**Solution**: Change to character mode:
```json
{
  "tsqllint.rangeMode": "character"
}
```

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

### 0.0.1

Initial release of tsqllint-lite:
- Real-time linting with LSP architecture
- Manual lint commands
- Configurable timeout and debouncing
- Support for custom tsqllint paths and config files
- Character and line range modes for diagnostics

## Contributing

Issues and pull requests are welcome! Please report issues at the [GitHub repository](https://github.com/masmgr/tsqllint-vscode-lite/issues).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

**Enjoy linting your T-SQL code!**
