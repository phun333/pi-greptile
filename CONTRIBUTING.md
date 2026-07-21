# Contributing to pi-greptile

Thanks for your interest! This is a small, focused codebase — PRs are welcome.

## Development setup

```bash
git clone https://github.com/phun333/pi-greptile.git
cd pi-greptile
pi install ./            # installs the local checkout into pi
```

Because pi loads extensions from source, any edit takes effect the next time you start `pi` — no build step.

To load only this extension (isolating it from your other packages):

```bash
pi -e ./src/index.ts --no-extensions
```

## Checks

```bash
node --test test/*.test.ts   # unit tests (Node 24+, runs TS directly)
npx tsc -p tsconfig.json     # typecheck (needs peer deps, see CI workflow)
```

Both run in CI on every PR.

## Project layout

| File | Purpose |
|---|---|
| `src/index.ts` | Extension entry — registers tools + commands |
| `src/client.ts` | JSON-RPC 2.0 client for Greptile's remote MCP endpoint (auth, SSE parsing, timeouts) |
| `src/tools.ts` | The 12 `greptile_*` tool definitions (typebox schemas) |
| `src/commands.ts` | `/greptile` command: status panel, key setup, connectivity check |

## Guidelines

- Keep tool schemas in sync with the live server (`greptile_status` lists remote tools — compare before/after).
- Never log or echo the API key; use `maskKey` for display.
- New network calls must respect the request timeout and the caller's `AbortSignal`.
- Constructor parameter properties are not allowed (Node type-stripping runs the TS directly).

## Reporting security issues

Please do not open public issues for security vulnerabilities — see [SECURITY.md](SECURITY.md).
