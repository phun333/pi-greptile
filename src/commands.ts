import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

import {
	CONFIG_PATH,
	GreptileClient,
	DEFAULT_ENDPOINT,
	loadGreptileConfig,
	resolveApiKey,
	saveGreptileConfig,
} from "./client.ts";

const STATUS_TYPE = "greptile-status";

interface GreptileStatusDetails {
	keyMasked: string | null;
	keySource: "env" | "config" | null;
	endpoint: string;
	reachable: boolean;
	authValid: boolean | null;
	remoteToolCount: number | null;
	error: string | null;
}

/** Compact tool groups shown in the /greptile panel. */
const TOOL_GROUPS: Array<[label: string, tools: string]> = [
	["context", "greptile_{list,get,search,create}_custom_context"],
	["prs", "greptile_list_pull_requests · greptile_get_pull_request · greptile_list_pr_comments"],
	["reviews", "greptile_{list,get,trigger}_code_review{,s}"],
	["search", "greptile_search_comments · greptile_search_custom_context"],
	["misc", "greptile_status"],
	["setup", "/greptile key · /greptile clear · /greptile"],
];

function maskKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function keySource(): "env" | "config" | null {
	if (process.env.GREPTILE_API_KEY?.trim()) return "env";
	if (loadGreptileConfig().apiKey?.trim()) return "config";
	return null;
}

function endpointHost(endpoint: string): string {
	try {
		return new URL(endpoint).host;
	} catch {
		return endpoint;
	}
}

function statusText(d: GreptileStatusDetails): string {
	const lines: string[] = [];
	if (!d.keySource) {
		lines.push("Greptile: no API key configured.");
		lines.push(`Set one with /greptile key, GREPTILE_API_KEY, or ${CONFIG_PATH}`);
	} else if (d.authValid === false) {
		lines.push(`Greptile: API key ${d.keyMasked} (${d.keySource}) was REJECTED.`);
		if (d.error) lines.push(d.error);
	} else if (!d.reachable) {
		lines.push(`Greptile: unreachable at ${d.endpoint}`);
		if (d.error) lines.push(d.error);
	} else {
		lines.push(
			`Greptile: connected — key ${d.keyMasked} (${d.keySource}), ${d.remoteToolCount ?? "?"} remote tools at ${endpointHost(d.endpoint)}`,
		);
	}
	lines.push("");
	lines.push("Available pi tools:");
	for (const [label, tools] of TOOL_GROUPS) {
		lines.push(`  ${label.padEnd(8)} ${tools}`);
	}
	return lines.join("\n");
}

async function collectStatus(): Promise<GreptileStatusDetails> {
	const endpoint = loadGreptileConfig().endpoint ?? DEFAULT_ENDPOINT;
	const source = keySource();
	const key = resolveApiKey();
	const details: GreptileStatusDetails = {
		keyMasked: key ? maskKey(key) : null,
		keySource: source,
		endpoint,
		reachable: false,
		authValid: null,
		remoteToolCount: null,
		error: null,
	};
	if (!key) return details;

	const client = new GreptileClient(key, endpoint);
	const [toolsResult, authResult] = await Promise.allSettled([
		client.listTools(),
		// tools/list is unauthenticated on Greptile's side — this validates the key.
		client.callTool("list_custom_context", { limit: 1 }),
	]);
	if (toolsResult.status === "fulfilled") {
		details.reachable = true;
		details.remoteToolCount =
			(toolsResult.value as { tools?: unknown[] })?.tools?.length ?? null;
	} else {
		details.error = toolsResult.reason instanceof Error ? toolsResult.reason.message : String(toolsResult.reason);
	}
	details.authValid = authResult.status === "fulfilled";
	if (authResult.status === "rejected" && !details.error) {
		details.error = authResult.reason instanceof Error ? authResult.reason.message : String(authResult.reason);
	}
	return details;
}

export function registerGreptileCommands(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<GreptileStatusDetails>(STATUS_TYPE, (message, _options, theme) => {
		const d = message.details;
		if (!d) return undefined;

		const box = new Box(1, 0);
		let dot: string;
		let headline: string;
		if (!d.keySource) {
			dot = theme.fg("warning", "○");
			headline = `${theme.fg("text", "Greptile")} ${theme.fg("dim", "·")} ${theme.fg("warning", "no API key")} ${theme.fg("dim", "— run /greptile key")}`;
		} else if (d.authValid === false) {
			dot = theme.fg("error", "●");
			headline = `${theme.fg("text", "Greptile")} ${theme.fg("dim", "·")} ${theme.fg("error", `key ${d.keyMasked} rejected`)} ${theme.fg("dim", `(${d.keySource})`)}`;
		} else if (!d.reachable) {
			dot = theme.fg("error", "●");
			headline = `${theme.fg("text", "Greptile")} ${theme.fg("dim", "·")} ${theme.fg("error", "unreachable")} ${theme.fg("dim", endpointHost(d.endpoint))}`;
		} else {
			dot = theme.fg("success", "●");
			headline =
				`${theme.fg("text", "Greptile")} ${theme.fg("dim", "·")} ${theme.fg("success", "connected")} ` +
				theme.fg(
					"dim",
					`— key ${d.keyMasked} (${d.keySource}) · ${endpointHost(d.endpoint)} · ${d.remoteToolCount ?? "?"} remote tools`,
				);
		}
		box.addChild(new Text(`${dot} ${headline}`, 0, 0));
		if (d.error && d.authValid === false) {
			box.addChild(new Text(theme.fg("dim", `  ${d.error}`), 0, 0));
		}
		box.addChild(new Text("", 0, 0));
		for (const [label, tools] of TOOL_GROUPS) {
			box.addChild(
				new Text(`  ${theme.fg("accent", label.padEnd(8))} ${theme.fg("muted", tools)}`, 0, 0),
			);
		}
		return box;
	});

	pi.registerCommand("greptile", {
		description: "Greptile status & tools — /greptile key to set API key, /greptile clear to remove it",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase();

			if (sub === "key" || sub === "login" || sub === "setup") {
				const entered = await ctx.ui.input(
					"Greptile API key",
					"app.greptile.com → Settings → Organization → API Keys",
				);
				const apiKey = entered?.trim();
				if (!apiKey) {
					ctx.ui.notify("Cancelled — no key saved.", "info");
					return;
				}
				try {
					const client = new GreptileClient(apiKey, loadGreptileConfig().endpoint ?? DEFAULT_ENDPOINT);
					// tools/list is unauthenticated — validate with a real authenticated call.
					await client.callTool("list_custom_context", { limit: 1 });
					saveGreptileConfig({ apiKey });
					ctx.ui.notify(
						`Greptile key validated. ${maskKey(apiKey)} saved to ${CONFIG_PATH}`,
						"info",
					);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					const saveAnyway = await ctx.ui.confirm(
						"Greptile validation failed",
						`${message}\n\nSave the key anyway?`,
					);
					if (saveAnyway) {
						saveGreptileConfig({ apiKey });
						ctx.ui.notify(`Key ${maskKey(apiKey)} saved to ${CONFIG_PATH} (unvalidated).`, "warning");
					} else {
						ctx.ui.notify("Key not saved.", "info");
					}
				}
				return;
			}

			if (sub === "clear" || sub === "logout") {
				if (!loadGreptileConfig().apiKey) {
					ctx.ui.notify(`No saved key in ${CONFIG_PATH}.`, "info");
					return;
				}
				saveGreptileConfig({ apiKey: undefined });
				ctx.ui.notify(`Saved key removed from ${CONFIG_PATH}.`, "info");
				return;
			}

			// Default: compact status + tools panel
			const details = await collectStatus();
			pi.sendMessage({
				customType: STATUS_TYPE,
				content: statusText(details),
				display: true,
				details,
			});
		},
	});
}
