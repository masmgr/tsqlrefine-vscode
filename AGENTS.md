# Agent Guide: tsqlrefine-vscode

## Purpose
- VS Code extension named `tsqlrefine` that integrates TSQLRefine (T-SQL linter/formatter/fixer).
- Uses Language Server Protocol (LSP) with separate client and server processes.
- Source is in `src/`; bundled output goes to `dist/`; test compilation output goes to `out/`.

## Key paths
- `src/extension.ts`: extension activation entrypoint (client side).
- `src/client/`: language client, status bar, file event handlers.
- `src/server/server.ts`: LSP server entrypoint.
- `src/server/lint/`, `src/server/format/`, `src/server/fix/`: operation modules.
- `src/test/`: unit and E2E tests.
- `dist/`: bundled extension output (do not edit by hand).
- `out/`: test compilation output (do not edit by hand).

## Common commands
- Install deps: `npm install`
- Build: `npm run build`
- Watch: `npm run watch`
- Typecheck only: `npm run typecheck`
- Lint: `npm run lint`
- Format: `npm run format`
- Tests: `npm test`
- All checks: `npm run verify`

## Conventions
- Prefer editing TypeScript in `src/`, then rebuild.
- Use Biome for lint/format.
- Keep changes ASCII unless the file already uses Unicode.
