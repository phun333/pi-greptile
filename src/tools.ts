import { StringEnum } from "@earendil-works/pi-ai/compat";
import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";

import {
	DEFAULT_ENDPOINT,
	GreptileClient,
	MISSING_KEY_MESSAGE,
	loadGreptileConfig,
	resolveApiKey,
} from "./client.ts";

/** Local pi tool definition mapped onto a remote Greptile MCP tool. */
interface GreptileToolDef {
	name: string;
	remoteName: string;
	label: string;
	description: string;
	parameters: TSchema;
}

const repoName = (required: boolean) => {
	const schema = Type.String({ description: "Repository in owner/repo format" });
	return required ? schema : Type.Optional(schema);
};
const repoRemote = (required: boolean) => {
	const schema = StringEnum(["github", "gitlab", "bitbucket", "perforce"] as const, {
		description: "Repository host",
	});
	return required ? schema : Type.Optional(schema);
};
const repoBranch = (required: boolean) => {
	const schema = Type.String({ description: "Repository default branch (e.g. main)" });
	return required ? schema : Type.Optional(schema);
};
const remoteUrl = Type.Optional(
	Type.String({ description: "Self-hosted GitHub/GitLab instance URL (omit for cloud)" }),
);
const limit = (max: number, def: number) =>
	Type.Optional(
		Type.Integer({ description: `Maximum results (1-${max}, default ${def})`, minimum: 1, maximum: max }),
	);
const offset = Type.Optional(
	Type.Integer({ description: "Skip results for pagination (default 0)", minimum: 0 }),
);

const TOOLS: GreptileToolDef[] = [
	// ── Custom context ────────────────────────────────────────────────────────
	{
		name: "greptile_list_custom_context",
		remoteName: "list_custom_context",
		label: "Greptile: List Custom Context",
		description:
			"List the organization's Greptile custom context entries (coding patterns and custom review instructions).",
		parameters: Type.Object({
			type: Type.Optional(
				StringEnum(["CUSTOM_INSTRUCTION", "PATTERN"] as const, {
					description: "Filter by context type",
				}),
			),
			greptileGenerated: Type.Optional(
				Type.Boolean({ description: "Filter by Greptile-generated content" }),
			),
			limit: limit(100, 20),
			offset,
		}),
	},
	{
		name: "greptile_get_custom_context",
		remoteName: "get_custom_context",
		label: "Greptile: Get Custom Context",
		description: "Get one Greptile custom context entry in detail by its ID.",
		parameters: Type.Object({
			customContextId: Type.String({ description: "Custom context ID" }),
		}),
	},
	{
		name: "greptile_search_custom_context",
		remoteName: "search_custom_context",
		label: "Greptile: Search Custom Context",
		description:
			"Search the organization's Greptile custom context (patterns and instructions) by content.",
		parameters: Type.Object({
			query: Type.String({ description: "Search term" }),
			limit: limit(50, 10),
			offset,
		}),
	},
	{
		name: "greptile_create_custom_context",
		remoteName: "create_custom_context",
		label: "Greptile: Create Custom Context",
		description:
			"Create a new Greptile custom context entry (a coding pattern or custom review instruction) for the organization.",
		parameters: Type.Object({
			type: Type.Optional(
				StringEnum(["CUSTOM_INSTRUCTION", "PATTERN"] as const, {
					description: "Context type (default CUSTOM_INSTRUCTION)",
				}),
			),
			body: Type.Optional(Type.String({ description: "Context content" })),
			scopes: Type.Optional(
				Type.Any({ description: "Boolean expression defining where the context applies" }),
			),
			status: Type.Optional(
				StringEnum(["ACTIVE", "INACTIVE", "SUGGESTED"] as const, {
					description: "Context status (default ACTIVE)",
				}),
			),
			metadata: Type.Optional(Type.Any({ description: "Additional metadata object" })),
		}),
	},
	// ── Pull requests ─────────────────────────────────────────────────────────
	{
		name: "greptile_list_pull_requests",
		remoteName: "list_pull_requests",
		label: "Greptile: List Pull Requests",
		description:
			"List pull/merge requests known to Greptile. Repository parameters (name, remote, defaultBranch) must be provided together or omitted entirely.",
		parameters: Type.Object({
			name: repoName(false),
			remote: repoRemote(false),
			defaultBranch: repoBranch(false),
			remoteUrl,
			sourceBranch: Type.Optional(Type.String({ description: "Filter by source branch" })),
			authorLogin: Type.Optional(Type.String({ description: "Filter by PR author login" })),
			state: Type.Optional(
				StringEnum(["open", "closed", "merged"] as const, { description: "Filter by PR state" }),
			),
			limit: limit(100, 20),
			offset,
		}),
	},
	{
		name: "greptile_get_pull_request",
		remoteName: "get_merge_request",
		label: "Greptile: Get Pull Request",
		description: "Get detailed pull/merge request information from Greptile.",
		parameters: Type.Object({
			name: repoName(true),
			remote: repoRemote(true),
			defaultBranch: repoBranch(true),
			remoteUrl,
			prNumber: Type.Integer({ description: "Pull request number" }),
		}),
	},
	{
		name: "greptile_list_pr_comments",
		remoteName: "list_merge_request_comments",
		label: "Greptile: List PR Comments",
		description:
			"List comments on a pull/merge request, optionally filtered to Greptile-generated review comments and their addressed status.",
		parameters: Type.Object({
			name: repoName(true),
			remote: repoRemote(true),
			defaultBranch: repoBranch(true),
			remoteUrl,
			prNumber: Type.Integer({ description: "Pull request number" }),
			greptileGenerated: Type.Optional(
				Type.Boolean({ description: "Only Greptile-generated comments" }),
			),
			addressed: Type.Optional(Type.Boolean({ description: "Filter by addressed status" })),
			createdAfter: Type.Optional(Type.String({ description: "Only comments created after this ISO date" })),
			createdBefore: Type.Optional(Type.String({ description: "Only comments created before this ISO date" })),
		}),
	},
	// ── Code reviews ──────────────────────────────────────────────────────────
	{
		name: "greptile_list_code_reviews",
		remoteName: "list_code_reviews",
		label: "Greptile: List Code Reviews",
		description: "List Greptile AI code reviews, optionally filtered by repository, PR, or status.",
		parameters: Type.Object({
			name: repoName(false),
			remote: repoRemote(false),
			defaultBranch: repoBranch(false),
			remoteUrl,
			prNumber: Type.Optional(Type.Integer({ description: "Filter by pull request number" })),
			status: Type.Optional(
				StringEnum(
					["PENDING", "REVIEWING_FILES", "GENERATING_SUMMARY", "COMPLETED", "FAILED", "SKIPPED"] as const,
					{ description: "Filter by review status" },
				),
			),
			limit: limit(100, 20),
			offset,
		}),
	},
	{
		name: "greptile_get_code_review",
		remoteName: "get_code_review",
		label: "Greptile: Get Code Review",
		description: "Get one Greptile code review in detail (summary, comments, status) by its ID.",
		parameters: Type.Object({
			codeReviewId: Type.String({ description: "Code review ID" }),
		}),
	},
	{
		name: "greptile_trigger_code_review",
		remoteName: "trigger_code_review",
		label: "Greptile: Trigger Code Review",
		description: "Start a new Greptile AI code review on a pull request. GitHub and GitLab only.",
		parameters: Type.Object({
			name: repoName(true),
			remote: StringEnum(["github", "gitlab"] as const, {
				description: "Repository host (code review supports github and gitlab only)",
			}),
			defaultBranch: repoBranch(true),
			branch: Type.Optional(Type.String({ description: "Working branch of the PR" })),
			remoteUrl,
			prNumber: Type.Integer({ description: "Pull request number" }),
		}),
	},
	// ── Comments ──────────────────────────────────────────────────────────────
	{
		name: "greptile_search_comments",
		remoteName: "search_greptile_comments",
		label: "Greptile: Search Comments",
		description:
			"Search Greptile-generated review comments (including code suggestions) across all merge requests. Useful for finding patterns in Greptile's review feedback.",
		parameters: Type.Object({
			query: Type.String({ description: "Search term" }),
			limit: limit(50, 10),
			includeAddressed: Type.Optional(
				Type.Boolean({ description: "Include comments already marked addressed" }),
			),
			createdAfter: Type.Optional(Type.String({ description: "Only comments created after this ISO date" })),
		}),
	},
];

let cachedClient: GreptileClient | null = null;
let cachedKey: string | null = null;

function getClient(): GreptileClient {
	const apiKey = resolveApiKey();
	if (!apiKey) throw new Error(MISSING_KEY_MESSAGE);
	if (!cachedClient || cachedKey !== apiKey) {
		const endpoint = loadGreptileConfig().endpoint ?? DEFAULT_ENDPOINT;
		cachedClient = new GreptileClient(apiKey, endpoint);
		cachedKey = apiKey;
	}
	return cachedClient;
}

function stripUndefined(params: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) out[key] = value;
	}
	return out;
}

function textResult(text: string): AgentToolResult<{ error: string | null }> {
	return { content: [{ type: "text", text }], details: { error: null } };
}

export function registerGreptileTools(pi: ExtensionAPI): void {
	for (const def of TOOLS) {
		pi.registerTool({
			name: def.name,
			label: def.label,
			description: def.description,
			parameters: def.parameters,
			async execute(_toolCallId, params, signal) {
				const args = stripUndefined((params ?? {}) as Record<string, unknown>);
				const text = await getClient().callTool(def.remoteName, args, signal);
				return textResult(text);
			},
		});
	}

	pi.registerTool({
		name: "greptile_status",
		label: "Greptile: Status",
		description:
			"Check Greptile connectivity: verifies the API key and lists the tools exposed by the remote Greptile MCP server. Use for diagnostics.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, signal) {
			const apiKey = resolveApiKey();
			if (!apiKey) return textResult(MISSING_KEY_MESSAGE);
			const client = getClient();
			const [result, probe] = await Promise.all([client.listTools(signal), client.probeAuth(signal)]);
			const tools = (result as { tools?: Array<{ name: string; description?: string }> })?.tools ?? [];
			const authLine = probe.valid
				? "API key: valid"
				: `API key: INVALID — ${probe.error ?? "rejected"}`;
			const lines = [
				`Greptile MCP: reachable (${tools.length} remote tools)`,
				authLine,
				...tools.map((t) => `  - ${t.name}${t.description ? `: ${t.description.split("\n")[0]}` : ""}`),
			];
			return textResult(lines.join("\n"));
		},
	});
}
