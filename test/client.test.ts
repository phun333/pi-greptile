import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSseResponses, validateEndpoint } from "../src/client.ts";

test("parseSseResponses extracts JSON-RPC replies from SSE body", () => {
	const body = [
		"event: message",
		'data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
		"",
		": keep-alive comment",
		"",
		"event: message",
		'data: {"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"boom"}}',
		"",
	].join("\n");
	const responses = parseSseResponses(body);
	assert.equal(responses.length, 2);
	assert.deepEqual(responses[0].result, { ok: true });
	assert.equal(responses[1].error?.message, "boom");
});

test("parseSseResponses joins multi-line data fields", () => {
	const body = 'data: {"jsonrpc":"2.0",\ndata: "id":1,"result":{}}\n\n';
	const responses = parseSseResponses(body);
	assert.equal(responses.length, 1);
	assert.equal(responses[0].id, 1);
});

test("parseSseResponses ignores malformed payloads", () => {
	const responses = parseSseResponses("data: not-json\n\ndata: {\"id\":3}\n\n");
	assert.equal(responses.length, 1);
	assert.equal(responses[0].id, 3);
});

test("validateEndpoint accepts https", () => {
	assert.equal(validateEndpoint("https://api.greptile.com/mcp"), "https://api.greptile.com/mcp");
	assert.equal(
		validateEndpoint("https://greptile.internal.example.com/mcp"),
		"https://greptile.internal.example.com/mcp",
	);
});

test("validateEndpoint allows http only for localhost", () => {
	assert.equal(validateEndpoint("http://localhost:8080/mcp"), "http://localhost:8080/mcp");
	assert.equal(validateEndpoint("http://127.0.0.1/mcp"), "http://127.0.0.1/mcp");
	assert.throws(() => validateEndpoint("http://api.greptile.com/mcp"), /https/);
	assert.throws(() => validateEndpoint("http://evil.example.com/mcp"), /https/);
});

test("validateEndpoint rejects garbage and non-http schemes", () => {
	assert.throws(() => validateEndpoint("not a url"), /Invalid/);
	assert.throws(() => validateEndpoint("file:///etc/passwd"), /https/);
	assert.throws(() => validateEndpoint("ftp://api.greptile.com/mcp"), /https/);
});
