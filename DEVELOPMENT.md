# Development Guide

This document provides guidance for developers working on the tsqllint-lite VS Code extension.

## Project Overview

**tsqllint-lite** is a VS Code extension that integrates [TSQLLint](https://github.com/tsqllint/tsqllint) into the editor. It provides real-time linting for SQL files with support for both manual and automatic linting using a Language Server Protocol (LSP) architecture.

**Note**: This project was built from scratch and is not forked from [tsqllint-vscode-extension](https://github.com/tsqllint/tsqllint-vscode-extension). The codebase is independently developed to support the latest TSQLLint versions and LSP architecture.

## Prerequisites

- **Node.js**: v18 or later
- **npm**: v9 or later
- **VS Code**: v1.108.1 or later
- **TypeScript**: Managed via npm

## Setup

1. Clone the repository:
```bash
git clone https://github.com/masmgr/tsqllint-vscode-lite.git
cd tsqllint-vscode-lite
```

2. Install dependencies:
```bash
npm install
```

3. Verify setup:
```bash
npm run typecheck
```

## Build and Development Commands

### Development Build
```bash
npm run build              # Bundle extension/server to dist/ with esbuild
npm run watch             # Watch mode for development (esbuild)
npm run compile           # Compile TypeScript to out/ (for tests)
npm run typecheck         # Type-check without emitting
```

### Code Quality
```bash
npm run lint              # Lint with Biome
npm run format            # Format with Biome
```

### Testing
```bash
npm test                    # Run unit tests
npm run test:unit          # Run unit tests with Mocha
npm run test:unit:coverage # Run unit tests with c8 coverage reporting
npm run test:coverage      # Alias for test:unit:coverage
npm run test:e2e           # Run E2E tests
```

**Note**: The test scripts run both `npm run build` (to bundle extension code to `dist/`) and `npm run compile` (to compile test files to `out/`). This is necessary because VS Code loads the extension from `dist/extension.js` while the test runner executes tests from `out/test/**/*.test.js`.

**Code Coverage**: Unit tests are run with c8 coverage. Targets are 50% lines, 80% functions, 75% branches. Use `npm run test:unit:coverage` to generate reports in `coverage/`.

### Publishing
```bash
npm run package           # Create VSIX package
npm run vscode:prepublish # Production build with optimizations
```

## Project Structure

```
tsqllint-lite/
├── src/
│   ├── client/
│   │   └── client.ts          # VS Code extension host (LSP client)
│   ├── server/
│   │   ├── server.ts          # LSP server process
│   │   └── lint/
│   │       ├── scheduler.ts    # Concurrency-controlled lint scheduler
│   │       ├── runTsqllint.ts  # TSQLLint CLI executor
│   │       └── parseOutput.ts  # Output parser to VS Code diagnostics
│   ├── test/                  # Unit tests
│   └── e2e/                   # End-to-end tests
├── dist/                      # Bundled extension (generated)
├── out/                       # Compiled test files (generated)
├── esbuild.mjs                # Build configuration
├── tsconfig.json              # TypeScript configuration
├── package.json               # Project metadata and scripts
├── CLAUDE.md                  # Claude Code AI assistant instructions
├── DEVELOPMENT.md             # This file
└── README.md                  # User-facing documentation
```

## Architecture

### Language Server Protocol Pattern

This extension uses the **Language Server Protocol (LSP)** architecture with separate client and server processes:

- **Client** ([src/client/client.ts](src/client/client.ts)): Runs in the VS Code extension host
  - Creates and manages the LanguageClient connection
  - Registers commands (`tsqllint-lite.run`)
  - Handles file lifecycle events (delete, rename)

- **Server** ([src/server/server.ts](src/server/server.ts)): Runs in a separate Node.js process
  - Manages document synchronization
  - Handles lint requests and diagnostics
  - Coordinates with the LintScheduler

This separation allows the linting logic to run independently without blocking the VS Code UI.

### Core Components

#### 1. LintScheduler ([src/server/lint/scheduler.ts](src/server/lint/scheduler.ts))

Manages concurrent lint execution with sophisticated queuing:
- **Semaphore-based concurrency control**: Limits to 4 concurrent lints (`maxConcurrentRuns`)
- **Smart queuing**: Queues pending lints when max concurrency is reached
- **Debouncing**: For "type" events (default 500ms), prevents excessive linting during typing
- **Version tracking**: Ensures lints run against the correct document version
- **Priority handling**: Manual lints (`reason: "manual"`) bypass debouncing and run immediately

The scheduler handles four lint reasons:
- `"save"`: Triggered on document save
- `"type"`: Triggered during typing (if `runOnType` is enabled)
- `"manual"`: Triggered by explicit commands
- `"open"`: Triggered when document is opened (if `runOnOpen` is enabled)

#### 2. TSQLLint Runner ([src/server/lint/runTsqllint.ts](src/server/lint/runTsqllint.ts))

Executes the tsqllint CLI with proper process management:
- **Executable resolution**: Finds tsqllint via `settings.path` or PATH with caching (30s TTL)
- **Windows handling**: Wraps `.cmd`/`.bat` files with `cmd.exe /c`
- **Timeout protection**: Kills processes exceeding `settings.timeoutMs` (default 10s)
- **Cancellation support**: Respects AbortSignal for clean cancellation

#### 3. Output Parser ([src/server/lint/parseOutput.ts](src/server/lint/parseOutput.ts))

Parses tsqllint output into VS Code diagnostics:
- **Pattern**: `<file>(<line>,<col>): <severity> <rule> : <message>`
- **Range mode**: Always highlights entire line (fixed to "line" mode)
- **Path normalization**: Handles Windows case-insensitivity and path resolution
- **Temporary file support**: Maps temp file paths back to original URIs

#### 4. Document Lifecycle Management

The server tracks document state throughout its lifecycle:
- **Unsaved documents**: Creates temporary files in `os.tmpdir()` for linting
- **Version tracking**: Uses `savedVersionByUri` to distinguish saved vs modified states
- **Cleanup**: Removes temporary files and clears diagnostics on document close

### Data Flow

1. User edits SQL file or triggers command
2. Client sends request to server via LSP
3. Server's `LintScheduler` queues the lint request
4. When a slot is available, `runTsqllint()` spawns the CLI process
5. `parseOutput()` converts stdout to VS Code diagnostics
6. Server sends diagnostics back to client
7. Client displays squiggles and problems panel

## Configuration

The extension contributes these settings (namespace: `tsqllint`):

- `path`: Custom tsqllint executable path (default: searches PATH)
- `configPath`: TSQLLint config file path (passed as `-c` argument)
- `runOnSave`: Auto-lint on save (default: true)
- `runOnType`: Lint while typing (default: false)
- `runOnOpen`: Auto-lint on open (default: true)
- `debounceMs`: Debounce delay for typing (default: 500)
- `timeoutMs`: Process timeout (default: 10000)

## Testing Strategy

Tests are organized into two main categories under [src/test/](src/test/) with comprehensive coverage:

1. **Unit tests** ([src/test/unit/](src/test/unit/)): Test individual functions in isolation (70 test cases)
   - [scheduler.test.ts](src/test/unit/scheduler.test.ts) - LintScheduler concurrency, debouncing, queue management (21 tests)
   - [decodeOutput.test.ts](src/test/unit/decodeOutput.test.ts) - Encoding detection and character handling (25 tests)
   - [parseOutput.test.ts](src/test/unit/parseOutput.test.ts) - Output parser and error scenarios
   - [runTsqllint.test.ts](src/test/unit/runTsqllint.test.ts) - CLI runner and error handling
   - [handlers.test.ts](src/test/unit/handlers.test.ts) - File event handlers

2. **E2E tests** ([src/test/e2e/](src/test/e2e/)): Test full integration with VS Code
   - [extension.test.ts](src/test/e2e/extension.test.ts) - Extension activation and commands
   - [localTsqllint.test.ts](src/test/e2e/localTsqllint.test.ts) - Real tsqllint CLI integration

### Test Organization

Test helpers: [src/test/helpers/](src/test/helpers/)
- `testConstants.ts` - Centralized test timeouts, delays, and constants
- `cleanup.ts` - File system cleanup utilities with retry logic
- `testFixtures.ts` - Reusable test data factories
- `e2eTestHarness.ts` - E2E test setup/teardown automation
- `fakeCli.ts` - Mock tsqllint CLI helper

### Code Coverage

- Minimum targets: 50% lines, 80% functions, 75% branches, 50% statements
- Current coverage: 52.73% overall, 79.2% in server/lint
- Configuration: [.c8rc.json](.c8rc.json)
- Generate report: `npm run test:unit:coverage`

### Writing Tests

Use the fake CLI helper for mocking tsqllint:

```typescript
import { runE2ETest } from './helpers/e2eTestHarness';
import { TEST_TIMEOUTS, FAKE_CLI_RULES } from './helpers/testConstants';

test("my test", async function () {
  this.timeout(TEST_TIMEOUTS.MOCHA_TEST);

  await runE2ETest(
    {
      fakeCliRule: FAKE_CLI_RULES.MY_RULE,
      config: { runOnSave: true },
      documentContent: 'select 1;',
    },
    async (context, harness) => {
      const diagnostics = await harness.waitForDiagnostics(
        context.document.uri,
        (entries) => entries.length >= 1
      );
    }
  );
});
```

**Best practices**:
- Always use constants from `testConstants.ts` for timeouts and delays
- Always use `runE2ETest()` harness for new E2E tests
- Use test factories instead of inline scripts
- Run `npm test` before submitting PRs

## Pre-commit Hooks and Automation

### Git Hooks with Husky

The project uses **Husky** for pre-commit hooks to enforce code quality standards:

- **Configuration**: [.husky/pre-commit](.husky/pre-commit)
- **Installation**: Automatic via `npm install` (using `prepare` script in package.json)
- **Actions**:
  1. **lint-staged**: Formats and lints staged files
     - TypeScript files: `biome format --write && biome lint --fix`
     - JSON, Markdown, YAML: `biome format --write`
  2. **Type checking**: Runs `npm run typecheck` for staged TypeScript files

To bypass hooks (not recommended):
```bash
git commit --no-verify
```

### Dependency Management with Dependabot

**Dependabot** automates dependency updates:

- **Configuration**: [.github/dependabot.yml](.github/dependabot.yml)
- **Schedule**: Weekly updates (Monday)
- **NPM Dependencies**:
  - Groups dev and production dependencies separately
  - Only minor and patch updates (no major versions)
  - Time: 09:00 UTC
- **GitHub Actions**: Weekly updates (Monday UTC)
- **PR Labeling**: Automatically labels with `dependencies` and `automated`

## Important Implementation Notes

### Windows Compatibility
- Always use `path.resolve()` and `path.normalize()` for file paths
- Use case-insensitive comparison on Windows (`normalizeForCompare()`)
- Wrap `.cmd`/`.bat` executables with `cmd.exe /c`

### Concurrency and Cancellation
- The `LintScheduler` prevents resource exhaustion with its semaphore
- All lint operations support cancellation via AbortSignal
- In-flight requests are tracked in `inFlightByUri` map and cancelled when superseded

### Error Handling
- TSQLLint errors go to stderr and are shown as warnings
- CLI spawn errors reject the promise and clear diagnostics

### TypeScript Configuration
This project uses strict TypeScript settings including:
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- Always handle array access with optional chaining or default values

## Release and Publishing

### GitHub Actions Workflows

The project includes two CI/CD workflows:

#### 1. CI Workflow ([.github/workflows/ci.yml](.github/workflows/ci.yml))

Runs on every push and pull request:
- Type checking and linting
- Unit tests with coverage reporting (Linux only for performance)
- E2E tests (cross-platform: Ubuntu, Windows, macOS)
- Coverage artifact upload (Linux only)
- Builds VSIX package on Linux
- Uploads VSIX as artifact

#### 2. Release Workflow ([.github/workflows/release.yml](.github/workflows/release.yml))

Runs when a release is published on GitHub:
- Type checking and linting
- Production build (`--production` flag)
- Creates VSIX package
- Publishes to VS Code Marketplace
- Uploads VSIX to GitHub release assets

### Publishing to VS Code Marketplace

#### Prerequisites

1. **VS Code Marketplace Account**: Create a publisher account at https://marketplace.visualstudio.com/manage
2. **Personal Access Token (PAT)**: Generate a token with the **Marketplace → Manage** scope
3. **GitHub Secret**: Add `VSCE_PAT` secret to your repository

#### Setup Instructions

1. Create a PAT at https://dev.azure.com/_usersSettings/tokens:
   - Scope: **Marketplace → Manage**
   - Expiration: Set as needed
   - Copy the token value

2. Add to GitHub repository secrets:
   - Go to Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `VSCE_PAT`
   - Value: (paste your PAT)

3. Ensure publisher ID is set in `package.json`:
   ```json
   "publisher": "tsqllint-lite"
   ```

#### Release Process

1. Update version in `package.json`:
   ```json
   "version": "0.1.0"
   ```

2. Update `CHANGELOG.md` with release notes

3. Commit changes:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to 0.1.0"
   git push
   ```

4. Create a GitHub release:
   - Go to https://github.com/masmgr/tsqllint-vscode-lite/releases
   - Click "Draft a new release"
   - Tag: `v0.1.0` (matches package.json version)
   - Title: Release notes or version summary
   - Description: Detailed release notes
   - Click "Publish release"

5. The release workflow will automatically:
   - Run tests and checks
   - Build the extension
   - Publish to VS Code Marketplace
   - Attach VSIX to GitHub release

#### Manual Publishing

If needed, you can publish manually from your local machine:

```bash
# Install vsce globally
npm install -g @vscode/vsce

# Build for production
npm run vscode:prepublish

# Create VSIX package
npm run package

# Publish to Marketplace
vsce publish --packagePath *.vsix --pat <YOUR_PAT>
```

### Version Management

- Keep `package.json` version in sync with GitHub release tags
- Follow semantic versioning (MAJOR.MINOR.PATCH)
- Update `CHANGELOG.md` before each release

## Contributing

1. Create a feature branch: `git checkout -b feature/my-feature`
2. Make your changes and commit them: `git commit -m "feat: description"`
3. Run tests: `npm test`
4. Run linting: `npm run lint`
5. Push to your fork and create a pull request

## Useful Resources

- [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
- [VS Code Extension API](https://code.visualstudio.com/api)
- [TSQLLint Documentation](https://github.com/tsqllint/tsqllint)
- [esbuild Documentation](https://esbuild.github.io/)
- [TypeScript Documentation](https://www.typescriptlang.org/docs/)

## License

MIT - See [LICENSE](LICENSE) file for details.
