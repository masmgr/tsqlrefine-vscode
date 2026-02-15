# Features

## Lint

Automatically detect issues in your T-SQL code with real-time linting.

- **Run on save**: Automatically lint when you save a SQL file (enabled by default)
- **Run on type**: Lint while typing with debouncing (optional)
- **Run on open**: Lint when opening a SQL file (enabled by default)
- **Manual lint**: Run `TSQLRefine: Run` command from the Command Palette
- **Severity filtering**: Filter diagnostics by severity level (error, warning, info, hint)

Issues are displayed as squiggles in the editor and listed in the Problems panel.

### File Size Limiting

The extension can skip automatic linting for large files:

- Controlled by the `maxFileSizeKb` setting (0 = unlimited)
- Only affects automatic linting (save, type, open)
- Manual linting (`TSQLRefine: Run`) always runs regardless of file size

### Debouncing

When `runOnType` is enabled, linting is debounced to avoid excessive executions:

- Default delay: 500ms (configurable via `debounceMs`)
- Each new keystroke resets the timer
- Manual and save triggers bypass the debounce

## Fix

Automatically fix linting issues with a single command or quick fix action.

- **Fix command**: Run `TSQLRefine: Fix` from the Command Palette to apply all available fixes
- **Quick Fix**: Click the lightbulb icon or press `Ctrl+.` / `Cmd+.` to see "Fix all tsqlrefine issues"
- **Severity-aware**: Fixes are applied based on the configured minimum severity level

After a fix is applied, linting is automatically re-run to update diagnostics.

## Format

Format your T-SQL code using TSQLRefine's formatter.

- **Format command**: Run `TSQLRefine: Format` from the Command Palette
- **Editor integration**: Use VS Code's built-in format commands (`Shift+Alt+F` / `Shift+Option+F`)
- **Format on save**: Works with VS Code's `editor.formatOnSave` setting

### Default Formatter

This extension automatically registers itself as the default formatter for `sql`, `tsql`, and `mssql` languages. If another extension (e.g., mssql) overrides this, add the following to your `settings.json`:

```json
"[sql]": {
    "editor.defaultFormatter": "masmgr.tsqlrefine"
},
"[tsql]": {
    "editor.defaultFormatter": "masmgr.tsqlrefine"
},
"[mssql]": {
    "editor.defaultFormatter": "masmgr.tsqlrefine"
}
```

To enable format-on-save, add:

```json
"editor.formatOnSave": true
```

## Commands

| Command | Description |
|---------|-------------|
| `TSQLRefine: Run` | Manually lint the current SQL file |
| `TSQLRefine: Fix` | Apply auto-fixes to the current SQL file |
| `TSQLRefine: Format` | Format the current SQL file |
| `TSQLRefine: Open Install Guide` | Open the TSQLRefine installation guide |
