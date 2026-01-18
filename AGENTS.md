# Agent Guide: tsqllint-vscode-lite

## Purpose
- VS Code extension named `tsqllint-lite`.
- Source is in `src/`; compiled output goes to `out/`.

## Key paths
- `src/extension.ts`: main extension entrypoint.
- `out/`: build output (do not edit by hand).
- `test/`: extension tests.

## Common commands
- Install deps: `npm install`
- Build: `npm run build`
- Watch: `npm run watch`
- Typecheck only: `npm run typecheck`
- Lint: `npm run lint`
- Format: `npm run format`
- Tests: `npm test`

## Conventions
- Prefer editing TypeScript in `src/`, then rebuild.
- Use Biome for lint/format.
- Keep changes ASCII unless the file already uses Unicode.
