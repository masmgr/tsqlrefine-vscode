# Extension Settings

All settings are under the `tsqlrefine` namespace.

## Executable Path

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `path` | string | `""` | Path to tsqlrefine executable (empty = search PATH) |
| `configPath` | string | `""` | Path to `tsqlrefine.json` config file (empty = auto-detect) |

## Lint Behavior

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `runOnSave` | boolean | `true` | Lint on save |
| `runOnType` | boolean | `false` | Lint while typing (debounced) |
| `runOnOpen` | boolean | `true` | Lint on open |
| `debounceMs` | number | `500` | Debounce delay for run-on-type (ms) |
| `minSeverity` | string | `"info"` | Minimum severity level (`error`, `warning`, `info`, `hint`) |
| `maxFileSizeKb` | number | `0` | Max file size for auto-lint (0 = unlimited) |

## Timeouts

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `timeoutMs` | number | `10000` | Lint timeout (ms) |
| `formatTimeoutMs` | number | `10000` | Format timeout (ms) |

## Feature Toggles

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
  "tsqlrefine.configPath": "${workspaceFolder}/tsqlrefine.json"
}
```

### Filter by Severity

```json
{
  "tsqlrefine.minSeverity": "warning"
}
```
