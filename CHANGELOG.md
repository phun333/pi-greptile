# Changelog

## 0.1.0

Initial release.

- 12 native `greptile_*` tools for pi, mapped onto Greptile's remote MCP server (custom context, pull requests, code reviews, comment search, diagnostics).
- `/greptile` command: instant status panel, `/greptile key` interactive setup with live validation, `/greptile check` connectivity test, `/greptile clear`.
- Direct JSON-RPC 2.0 client over streamable HTTP — no MCP adapter process. Skips the initialize handshake for Greptile's stateless endpoint (2 fewer round-trips per session), with automatic fallback for session-based servers.
- Security hardening: https-only endpoints (localhost exempt), 60s request timeout, 200k character output cap, key file written `0600`, masked key display.
