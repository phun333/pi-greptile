import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	CONFIG_PATH,
	GreptileClient,
	DEFAULT_ENDPOINT,
	loadGreptileConfig,
	resolveApiKey,
	saveGreptileConfig,
} from "./client.ts";

function maskKey(key: string): string {
	if (key.length <= 8) return "****";
	return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function keySource(): "env" | "config" | null {
	if (process.env.GREPTILE_API_KEY?.trim()) return "env";
	if (loadGreptileConfig().apiKey?.trim()) return "config";
	return null;
}

export function registerGreptileCommands(pi: ExtensionAPI): void {
	pi.registerCommand("greptile", {
		description: "Greptile setup & status — /greptile key to set API key, /greptile clear to remove it",
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

			// Default: status
			const source = keySource();
			if (!source) {
				ctx.ui.notify(
					"No Greptile API key. Run /greptile key to set one (or export GREPTILE_API_KEY).",
					"warning",
				);
				return;
			}
			const key = resolveApiKey()!;
			const origin = source === "env" ? "GREPTILE_API_KEY env var" : CONFIG_PATH;
			try {
				const client = new GreptileClient(key, loadGreptileConfig().endpoint ?? DEFAULT_ENDPOINT);
				await client.callTool("list_custom_context", { limit: 1 });
				ctx.ui.notify(
					`Greptile connected — key ${maskKey(key)} from ${origin} is valid.`,
					"info",
				);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				ctx.ui.notify(`Greptile key ${maskKey(key)} from ${origin} failed: ${message}`, "error");
			}
		},
	});
}
