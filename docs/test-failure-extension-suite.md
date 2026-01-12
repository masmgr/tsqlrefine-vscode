# Current test failure: Extension Test Suite

## Symptom

Running `npm test` fails with:

- `Extension Test Suite` -> `updates diagnostics after lint run`
- Assertion failure: `assert.ok(match)` (no diagnostic whose `source === "tsqllint"` and `code === "FakeRule"`)

Earlier in the same investigation, the failure mode also included:

- `CodeExpectedError: Unable to write to Folder Settings because no resource is provided.`
- `EBUSY: resource busy or locked, rmdir ...` while deleting the temp workspace directory on Windows

## What the test is trying to do

`src/test/extension.test.ts` creates:

- A temporary `.sql` file under `%TEMP%`
- A fake `tsqllint` CLI that prints a single issue in the expected console reporter format
- VS Code settings overrides so that the extension uses the fake CLI and runs on save

Then it:

1. Opens the SQL document
2. Saves it
3. Waits for diagnostics
4. Asserts that the `tsqllint` diagnostic is present

## Expected data flow (high level)

1. Extension activates on SQL documents (`activationEvents: onLanguage:sql`)
2. Language client starts and launches the bundled language server
3. On document save, the language server receives `textDocument/didSave`
4. The server runs `tsqllint` and converts stdout to LSP diagnostics
5. The client surfaces those diagnostics via VS Code diagnostics UI

The current assertion failure means step 4/5 never happens (or happens but diagnostics do not match).

## Suspected causes (ordered)

### 1) Language server may never receive `didSave` (capability mismatch)

In `src/server/server.ts`, the server currently advertises:

- `textDocumentSync: TextDocumentSyncKind.Incremental`

In LSP, advertising a numeric `TextDocumentSyncKind` typically enables open/close/change, but does not necessarily enable save notifications (`textDocument/didSave`).

However, the server logic relies on:

- `documents.onDidSave(...)` to trigger lint-on-save

If VS Code never sends `didSave` to the server, lint-on-save will not run, and the integration test will observe no diagnostics.

This is the most likely root cause because it explains "no diagnostics" even when config is correct.

### 2) Settings scope mismatch between VS Code and the language server

The server reads settings using:

- `connection.workspace.getConfiguration("tsqllint")`

This fetches a configuration object without a per-resource `scopeUri`.

If tests (or users) set `tsqllint.*` at the Workspace Folder scope, the server might still see only the workspace-level values, depending on how VS Code resolves config without a scope.

This can cause the server to run with defaults (e.g., not using the fake CLI path), resulting in no diagnostics.

### 3) Race: saving before the language client/server is ready

Even if activation is triggered by opening a SQL file, the language client start + LSP initialize handshake is asynchronous.

If the test saves the document before the client is ready, the save notification might not reach the server (or configuration changes might not be synchronized yet), resulting in no lint run and no diagnostics.

### 4) `setTextDocumentLanguage` returns a (possibly) different document instance

VS Code API returns a `TextDocument` from `vscode.languages.setTextDocumentLanguage(...)`.

If the test ignores the returned document and continues using the old one, it may not be the document instance the language client tracks for the `sql` selector, depending on VS Code behavior.

### 5) Workspace / folder settings write errors in extension test runner

The error:

- `Unable to write to Folder Settings because no resource is provided.`

occurs when writing Workspace Folder settings but VS Code does not have a concrete folder/workspace context to write them to.

This is why the test runner configuration now opens a workspace folder via `.vscode-test.mjs`.

### 6) Windows temp directory cleanup flakiness (EBUSY)

`EBUSY` during `fs.rm(..., { recursive: true })` is typically caused by:

- Open file handles (e.g., the document still open in an editor)
- Antivirus/indexer interference

Mitigation is to close editors and retry removal with backoff.

## Recommended next steps (to confirm / fix)

1. Confirm whether `textDocument/didSave` reaches the server during the test run.
2. If not, change the server `textDocumentSync` capability to explicitly opt into save notifications.
3. Align settings scoping:
   - Either set workspace-level settings in the test, or
   - Update the server to read configuration with a `scopeUri` per document.
4. Remove races by explicitly waiting for extension activation and language server readiness before saving.

