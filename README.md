# greptile-pi

Native [pi](https://github.com/badlogic/pi-mono) tools for [Greptile](https://greptile.com) — AI code reviews, PR data, and organizational custom context, exposed as first-class `greptile_*` tools. No MCP adapter or extra process: the extension speaks JSON-RPC directly to Greptile's remote MCP endpoint (`https://api.greptile.com/mcp`).

## Install

```bash
pi install npm:greptile-pi
# or from a local checkout:
pi install /path/to/greptile-pi
```

## Setup

Get an API key at **app.greptile.com → Settings → Organization → API Keys**, then either:

```bash
export GREPTILE_API_KEY="..."
```

or create `~/.pi/greptile.json`:

```json
{ "apiKey": "..." }
```

Optionally override the endpoint (self-hosted Greptile):

```json
{ "apiKey": "...", "endpoint": "https://greptile.internal.example.com/mcp" }
```

## Tools

| Tool | Purpose |
|---|---|
| `greptile_list_custom_context` | List org custom context (patterns & instructions) |
| `greptile_get_custom_context` | Get one custom context entry by ID |
| `greptile_search_custom_context` | Search custom context by content |
| `greptile_create_custom_context` | Create a new pattern / instruction |
| `greptile_list_pull_requests` | List PRs known to Greptile |
| `greptile_get_pull_request` | Get PR details |
| `greptile_list_pr_comments` | List PR comments (filter Greptile-generated / addressed) |
| `greptile_list_code_reviews` | List AI code reviews (filter by repo, PR, status) |
| `greptile_get_code_review` | Get one code review in detail |
| `greptile_trigger_code_review` | Start a new AI review on a PR |
| `greptile_search_comments` | Search past Greptile review comments |
| `greptile_status` | Diagnostics: verify key, list remote tools |

## Example prompts

- *"List the open PRs Greptile has reviewed in owner/repo"*
- *"Get the latest code review for PR #42 and summarize unaddressed comments"*
- *"Search our custom context for anything about error handling"*
- *"Trigger a Greptile review on PR #10 of owner/repo"*

## Development

```bash
npm run typecheck
pi -e ./src/index.ts --no-extensions   # load just this extension
```

## License

MIT
