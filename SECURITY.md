# Security Policy

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/phun333/pi-greptile/security/advisories/new) rather than public issues.

## Security model

- Your Greptile API key is read from `GREPTILE_API_KEY` or `~/.pi/greptile.json` (written with mode `0600`) and sent **only** to the configured Greptile endpoint as a `Bearer` header.
- Endpoint overrides must use `https://` (plain `http://` is allowed only for `localhost`, for self-hosted development).
- The key is never logged; UI surfaces show a masked form (`abcd…wxyz`).
- All requests have a 60s hard timeout; tool output fed to the LLM is capped at 200k characters.

## Things to be aware of

- **Prompt injection:** tool outputs (PR comments, review bodies, custom context) come from your organization's repositories and are placed into the LLM context. A malicious PR comment could attempt to influence the agent. This is inherent to any code-review integration — review agent actions as you would with any MCP server.
- **Write actions:** `greptile_create_custom_context` and `greptile_trigger_code_review` modify organization state. If you want a read-only setup, disable them in `pi config`.
