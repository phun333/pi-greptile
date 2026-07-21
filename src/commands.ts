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
	/** true when a live connectivity/auth check was performed (/greptile check). */
	checked: boolean;
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
	["setup", "/greptile key · /greptile check · /greptile clear"],
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
	} else if (!d.checked) {
		lines.push(
			`Greptile: key ${d.keyMasked} (${d.keySource}) · ${endpointHost(d.endpoint)} — run /greptile check to verify connectivity`,
		);
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

function localStatus(): GreptileStatusDetails {
	const key = resolveApiKey();
	return {
		keyMasked: key ? maskKey(key) : null,
		keySource: keySource(),
		endpoint: loadGreptileConfig().endpoint ?? DEFAULT_ENDPOINT,
		checked: false,
		reachable: false,
		authValid: null,
		remoteToolCount: null,
		error: null,
	};
}

async function collectStatus(): Promise<GreptileStatusDetails> {
	const details = localStatus();
	details.checked = true;
	const key = resolveApiKey();
	if (!key) return details;
	const endpoint = details.endpoint;

	const client = new GreptileClient(key, endpoint);
	const [toolsResult, authResult] = await Promise.allSettled([client.listTools(), client.probeAuth()]);
	if (toolsResult.status === "fulfilled") {
		details.reachable = true;
		details.remoteToolCount =
			(toolsResult.value as { tools?: unknown[] })?.tools?.length ?? null;
	} else {
		details.error = toolsResult.reason instanceof Error ? toolsResult.reason.message : String(toolsResult.reason);
	}
	if (authResult.status === "fulfilled") {
		details.authValid = authResult.value.valid;
		if (!authResult.value.valid && authResult.value.error) details.error = authResult.value.error;
	} else {
		details.authValid = false;
		if (!details.error) {
			details.error = authResult.reason instanceof Error ? authResult.reason.message : String(authResult.reason);
		}
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
		} else if (!d.checked) {
			dot = theme.fg("accent", "●");
			headline =
				`${theme.fg("text", "Greptile")} ${theme.fg("dim", "·")} ` +
				theme.fg("dim", `key ${d.keyMasked} (${d.keySource}) · ${endpointHost(d.endpoint)} · /greptile check to verify`);
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
					const probe = await client.probeAuth();
					if (!probe.valid) throw new Error(probe.error ?? "Greptile rejected the API key.");
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

			if (sub === "check" || sub === "test") {
				ctx.ui.notify("Checking Greptile connectivity…", "info");
				const details = await collectStatus();
				pi.sendMessage({
					customType: STATUS_TYPE,
					content: statusText(details),
					display: true,
					details,
				});
				return;
			}

			// Default: instant, purely local status + tools panel (no network).
			const details = localStatus();
			pi.sendMessage({
				customType: STATUS_TYPE,
				content: statusText(details),
				display: true,
				details,
			});
		},
	});
}
