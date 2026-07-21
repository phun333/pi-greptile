/**
 * Thin JSON-RPC 2.0 client for Greptile's remote MCP endpoint.
 *
 * Greptile exposes its MCP server over streamable HTTP at
 * https://api.greptile.com/mcp — we speak the protocol directly with fetch,
 * so no MCP SDK or adapter process is needed.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_ENDPOINT = "https://api.greptile.com/mcp";
export const CONFIG_PATH = join(homedir(), ".pi", "greptile.json");

const PROTOCOL_VERSION = "2025-06-18";
/** Hard cap on a single request so a hung server can't stall the agent forever. */
const REQUEST_TIMEOUT_MS = 60_000;
/** Cap on tool output fed back into the LLM context. */
const MAX_OUTPUT_CHARS = 200_000;

export class GreptileAuthError extends Error {}

interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

interface JsonRpcResponse {
	jsonrpc?: string;
	id?: number | string | null;
	result?: unknown;
	error?: JsonRpcError;
}

interface ToolCallContent {
	type: string;
	text?: string;
}

interface ToolCallResult {
	content?: ToolCallContent[];
	structuredContent?: unknown;
	isError?: boolean;
}

interface GreptileConfig {
	apiKey?: string;
	endpoint?: string;
}

export function loadGreptileConfig(): GreptileConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as GreptileConfig;
	} catch {
		return {};
	}
}

/** Merge updates into ~/.pi/greptile.json. Pass undefined to delete a field. */
export function saveGreptileConfig(updates: Partial<GreptileConfig>): void {
	const config: Record<string, unknown> = { ...loadGreptileConfig() };
	for (const [key, value] of Object.entries(updates)) {
		if (value === undefined) delete config[key];
		else config[key] = value;
	}
	mkdirSync(dirname(CONFIG_PATH), { recursive: true });
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	// writeFileSync's mode only applies on creation — tighten pre-existing files too.
	try {
		chmodSync(CONFIG_PATH, 0o600);
	} catch {
		// Best effort (e.g. Windows).
	}
}

export function resolveApiKey(): string | null {
	const fromEnv = process.env.GREPTILE_API_KEY?.trim();
	if (fromEnv) return fromEnv;
	const fromConfig = loadGreptileConfig().apiKey?.trim();
	return fromConfig || null;
}

export const MISSING_KEY_MESSAGE = [
	"Greptile API key not found.",
	"Get one at app.greptile.com → Settings → Organization → API Keys, then either:",
	"  1. run /greptile key in pi (interactive setup), or",
	'  2. export GREPTILE_API_KEY="..." in your shell, or',
	`  3. create ${CONFIG_PATH} with {"apiKey": "..."}`,
].join("\n");

/**
 * Validate a Greptile endpoint override. The API key is sent as a Bearer
 * header, so we refuse plaintext HTTP except for localhost (self-hosted dev).
 */
export function validateEndpoint(endpoint: string): string {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		throw new Error(`Invalid Greptile endpoint URL: ${endpoint}`);
	}
	const isLocalhost = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalhost)) {
		throw new Error(
			`Greptile endpoint must use https (got ${url.protocol}//). ` +
				"Plain http is only allowed for localhost.",
		);
	}
	return endpoint;
}

/** Parse a text/event-stream body into the JSON-RPC responses it carries. */
export function parseSseResponses(body: string): JsonRpcResponse[] {
	const responses: JsonRpcResponse[] = [];
	for (const event of body.split(/\n\n+/)) {
		const dataLines = event
			.split("\n")
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim());
		if (dataLines.length === 0) continue;
		try {
			responses.push(JSON.parse(dataLines.join("\n")) as JsonRpcResponse);
		} catch {
			// Ignore non-JSON SSE payloads (comments, keep-alives).
		}
	}
	return responses;
}

function extractText(result: ToolCallResult): string {
	const parts: string[] = [];
	for (const item of result.content ?? []) {
		if (item.type === "text" && typeof item.text === "string") {
			parts.push(item.text);
		}
	}
	if (parts.length === 0 && result.structuredContent !== undefined) {
		parts.push(JSON.stringify(result.structuredContent, null, 2));
	}
	const text = parts.join("\n\n") || "(empty response)";
	if (text.length > MAX_OUTPUT_CHARS) {
		return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[pi-greptile: output truncated at ${MAX_OUTPUT_CHARS} characters]`;
	}
	return text;
}

/** Combine the caller's signal with a hard request timeout. */
function withTimeout(signal: AbortSignal | undefined): AbortSignal {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export class GreptileClient {
	private sessionId: string | null = null;
	private initialized = false;
	private nextId = 1;

	private readonly apiKey: string;
	private readonly endpoint: string;

	constructor(apiKey: string, endpoint: string = DEFAULT_ENDPOINT) {
		this.apiKey = apiKey;
		this.endpoint = validateEndpoint(endpoint);
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			Authorization: `Bearer ${this.apiKey}`,
			"MCP-Protocol-Version": PROTOCOL_VERSION,
		};
		if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
		return headers;
	}

	private async post(
		body: unknown,
		signal?: AbortSignal,
	): Promise<{ status: number; responses: JsonRpcResponse[] }> {
		const res = await fetch(this.endpoint, {
			method: "POST",
			headers: this.headers(),
			body: JSON.stringify(body),
			signal: withTimeout(signal),
		});
		const sid = res.headers.get("mcp-session-id");
		if (sid) this.sessionId = sid;

		if (res.status === 401 || res.status === 403) {
			await res.body?.cancel().catch(() => {});
			throw new GreptileAuthError(
				`Greptile rejected the API key (HTTP ${res.status}). ` +
					"Check that the key is valid and has access to this organization.",
			);
		}

		const contentType = res.headers.get("content-type") ?? "";
		const text = await res.text();
		let responses: JsonRpcResponse[] = [];
		if (text.trim().length > 0) {
			if (contentType.includes("text/event-stream")) {
				responses = parseSseResponses(text);
			} else {
				try {
					const parsed = JSON.parse(text) as JsonRpcResponse | JsonRpcResponse[];
					responses = Array.isArray(parsed) ? parsed : [parsed];
				} catch {
					if (!res.ok) {
						throw new Error(`Greptile MCP HTTP ${res.status}: ${text.slice(0, 300)}`);
					}
				}
			}
		}
		if (!res.ok && responses.length === 0) {
			throw new Error(`Greptile MCP HTTP ${res.status}`);
		}
		return { status: res.status, responses };
	}

	private async ensureInitialized(signal?: AbortSignal): Promise<void> {
		if (this.initialized) return;
		const id = this.nextId++;
		const { responses } = await this.post(
			{
				jsonrpc: "2.0",
				id,
				method: "initialize",
				params: {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: {},
					clientInfo: { name: "pi-greptile", version: "0.1.0" },
				},
			},
			signal,
		);
		const reply = responses.find((r) => r.id === id);
		if (reply?.error) {
			throw new Error(`Greptile MCP initialize failed: ${reply.error.message}`);
		}
		// Best-effort: some servers require the initialized notification, others 202 it.
		await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, signal).catch(() => {});
		this.initialized = true;
	}

	private async requestOnce(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		const id = this.nextId++;
		const { responses } = await this.post({ jsonrpc: "2.0", id, method, params }, signal);
		const reply = responses.find((r) => r.id === id) ?? responses.find((r) => r.result || r.error);
		if (!reply) throw new Error(`Greptile MCP returned no response for ${method}`);
		if (reply.error) {
			throw new Error(`Greptile error (${reply.error.code}): ${reply.error.message}`);
		}
		return reply.result;
	}

	/**
	 * Greptile's MCP endpoint is stateless, so we skip the initialize handshake
	 * (saves two round-trips per session). If the server ever demands a session,
	 * we initialize once and retry.
	 */
	private async request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown> {
		if (this.initialized) return this.requestOnce(method, params, signal);
		try {
			return await this.requestOnce(method, params, signal);
		} catch (err) {
			if (err instanceof GreptileAuthError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			if (!/session|initializ/i.test(message)) throw err;
			await this.ensureInitialized(signal);
			return this.requestOnce(method, params, signal);
		}
	}

	/** Call a remote Greptile tool and return its text output. */
	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<string> {
		const result = (await this.request("tools/call", { name, arguments: args }, signal)) as ToolCallResult;
		const text = extractText(result);
		if (result.isError) {
			throw new Error(`Greptile tool ${name} failed: ${text}`);
		}
		return text;
	}

	/** List tools exposed by the remote server (diagnostics). */
	async listTools(signal?: AbortSignal): Promise<unknown> {
		return this.request("tools/list", {}, signal);
	}

	/**
	 * Fast (~0.5s) API key check. tools/list is unauthenticated on Greptile's
	 * side and list_custom_context takes ~9s, so probe with a bogus
	 * get_custom_context: an auth failure means bad key, any other reply means
	 * the key is valid.
	 */
	async probeAuth(signal?: AbortSignal): Promise<{ valid: boolean; error: string | null }> {
		try {
			await this.callTool("get_custom_context", { customContextId: "pi-greptile-auth-probe" }, signal);
			return { valid: true, error: null };
		} catch (err) {
			if (err instanceof GreptileAuthError) {
				return { valid: false, error: err.message };
			}
			return { valid: true, error: null };
		}
	}
}
