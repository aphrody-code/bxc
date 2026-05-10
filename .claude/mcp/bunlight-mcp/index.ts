#!/usr/bin/env bun
/**
 * Bunlight MCP server (stdio transport).
 *
 * Exposes 4 tools to Claude Code:
 *   - bunlight_scrape(url, profile?)
 *   - bunlight_detect(url)
 *   - bunlight_extract_cookies(domain)
 *   - bunlight_pool_run(urls[], profile?, concurrency?)
 *
 * All I/O is Bun-native: Bun.file, Bun.write, Bun.spawn. No node:fs, no node:child_process.
 *
 * Wire format: JSON-RPC 2.0 framed by Content-Length header (MCP standard) over stdin/stdout.
 *
 * This server lazily imports @bunmium/bunlight from the user's project at runtime, so it
 * works whether the package is installed locally or via npm link.
 */

type JsonRpcRequest = {
	jsonrpc: "2.0";
	id?: number | string | null;
	method: string;
	params?: Record<string, unknown>;
};

type JsonRpcResponse = {
	jsonrpc: "2.0";
	id: number | string | null;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

type Profile = "static" | "fast" | "http" | "stealth" | "max";

const SERVER_INFO = {
	name: "bunlight-mcp",
	version: "0.2.0",
} as const;

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
	{
		name: "bunlight_scrape",
		description:
			"Open a URL with the chosen Bunlight profile and return { url, title, profile, contentLength, latencyMs }. " +
			"Profile is one of static, fast, http, stealth, max. Defaults to 'fast'.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Target URL (http or https)." },
				profile: {
					type: "string",
					enum: ["static", "fast", "http", "stealth", "max"],
					description: "Bunlight profile.",
					default: "fast",
				},
				timeoutMs: {
					type: "number",
					description: "Navigation timeout in milliseconds.",
					default: 30000,
				},
			},
			required: ["url"],
		},
	},
	{
		name: "bunlight_detect",
		description:
			"Detect frameworks, CMS, and WAF on a URL and suggest the cheapest Bunlight profile that will succeed. " +
			"Returns { tech: [...], suggestedProfile, rationale }.",
		inputSchema: {
			type: "object",
			properties: {
				url: { type: "string", description: "Target URL (http or https)." },
			},
			required: ["url"],
		},
	},
	{
		name: "bunlight_extract_cookies",
		description:
			"Load a cookie jar from cookies/private/<domain>.json (relative to the project root). Returns parsed cookies as JSON. Refuses paths with traversal.",
		inputSchema: {
			type: "object",
			properties: {
				domain: {
					type: "string",
					description: "Domain name without scheme, e.g. example.com.",
				},
			},
			required: ["domain"],
		},
	},
	{
		name: "bunlight_pool_run",
		description:
			"Open multiple URLs through PagePool with the given profile and concurrency. " +
			"Returns an array of { url, title, latencyMs, error? } records.",
		inputSchema: {
			type: "object",
			properties: {
				urls: {
					type: "array",
					items: { type: "string" },
					description: "URLs to scrape.",
				},
				profile: {
					type: "string",
					enum: ["static", "fast", "http", "stealth", "max"],
					default: "fast",
				},
				concurrency: { type: "number", default: 5, minimum: 1, maximum: 50 },
			},
			required: ["urls"],
		},
	},
] as const;

// stdio JSON-RPC framing helpers (Content-Length style, per MCP spec).

const stdoutWriter = Bun.stdout.writer();

function writeMessage(msg: JsonRpcResponse): void {
	const body = JSON.stringify(msg);
	const bytes = new TextEncoder().encode(body);
	const header = `Content-Length: ${bytes.byteLength}\r\n\r\n`;
	stdoutWriter.write(header);
	stdoutWriter.write(bytes);
	stdoutWriter.flush();
}

async function readMessages(
	onMessage: (req: JsonRpcRequest) => Promise<void>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	const reader = Bun.stdin.stream().getReader();

	for (;;) {
		const { value, done } = await reader.read();
		if (done) {
			return;
		}
		buffer += decoder.decode(value, { stream: true });

		for (;;) {
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) {
				break;
			}
			const header = buffer.slice(0, headerEnd);
			const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
			if (!lengthMatch) {
				buffer = buffer.slice(headerEnd + 4);
				continue;
			}
			const length = Number.parseInt(lengthMatch[1], 10);
			const bodyStart = headerEnd + 4;
			if (buffer.length < bodyStart + length) {
				break;
			}
			const body = buffer.slice(bodyStart, bodyStart + length);
			buffer = buffer.slice(bodyStart + length);

			let parsed: JsonRpcRequest;
			try {
				parsed = JSON.parse(body) as JsonRpcRequest;
			} catch {
				continue;
			}
			await onMessage(parsed);
		}
	}
}

// Lazy-load @bunmium/bunlight from the project's node_modules.

type BunlightModule = {
	Browser: {
		newPage: (opts: { profile?: Profile; timeoutMs?: number }) => Promise<{
			goto: (url: string, opts?: { timeoutMs?: number }) => Promise<void>;
			title: () => Promise<string>;
			url: () => Promise<string>;
			content: () => Promise<string>;
			close: () => Promise<void>;
		}>;
	};
};

async function loadBunlight(): Promise<BunlightModule | null> {
	try {
		// Prefer the project the server was launched from.
		return (await import("@bunmium/bunlight")) as unknown as BunlightModule;
	} catch {
		return null;
	}
}

// Tool implementations.

async function toolScrape(
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	const url = String(args.url ?? "");
	const profile = (args.profile ?? "fast") as Profile;
	const timeoutMs = Number(args.timeoutMs ?? 30000);

	if (!/^https?:\/\//.test(url)) {
		return {
			isError: true,
			content: [
				{ type: "text", text: `Invalid URL: ${url}. Must start with http:// or https://.` },
			],
		};
	}

	const bunlight = await loadBunlight();
	if (!bunlight) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text:
						"Bunlight not installed in the project. Run `bun add @bunmium/bunlight` and try again.",
				},
			],
		};
	}

	const start = performance.now();
	const page = await bunlight.Browser.newPage({ profile });
	try {
		await page.goto(url, { timeoutMs });
		const title = await page.title();
		const content = await page.content();
		const elapsed = Math.round(performance.now() - start);
		const result = {
			url,
			title,
			profile,
			contentLength: content.length,
			latencyMs: elapsed,
		};
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
	} catch (err) {
		return {
			isError: true,
			content: [
				{ type: "text", text: `Scrape failed: ${(err as Error).message}` },
			],
		};
	} finally {
		await page.close();
	}
}

async function toolDetect(
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	const url = String(args.url ?? "");
	if (!/^https?:\/\//.test(url)) {
		return {
			isError: true,
			content: [{ type: "text", text: `Invalid URL: ${url}.` }],
		};
	}

	// Defer to @bunmium/bunlight/detect if available.
	let detectMod: { detectFrameworks: (url: string) => Promise<unknown> } | null = null;
	try {
		detectMod = (await import("@bunmium/bunlight/detect")) as unknown as {
			detectFrameworks: (url: string) => Promise<unknown>;
		};
	} catch {
		// fall through
	}

	if (!detectMod) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: "Bunlight detect module not available. Install @bunmium/bunlight.",
				},
			],
		};
	}

	try {
		const tech = await detectMod.detectFrameworks(url);
		const suggestedProfile = suggestFromTech(tech as Array<{ name: string }>);
		const result = {
			tech,
			suggestedProfile,
			rationale: rationaleFor(tech as Array<{ name: string }>, suggestedProfile),
		};
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
	} catch (err) {
		return {
			isError: true,
			content: [{ type: "text", text: `Detect failed: ${(err as Error).message}` }],
		};
	}
}

function suggestFromTech(tech: Array<{ name: string }>): Profile {
	const names = tech.map((t) => t.name.toLowerCase());
	if (names.some((n) => n.includes("turnstile"))) {
		return "max";
	}
	if (names.some((n) => n.includes("cloudflare") && n.includes("iuam"))) {
		return "stealth";
	}
	if (names.some((n) => n.includes("cloudflare"))) {
		return "http";
	}
	if (names.some((n) => /next|react|vue|nuxt|svelte/.test(n))) {
		return "fast";
	}
	return "static";
}

function rationaleFor(tech: Array<{ name: string }>, profile: Profile): string {
	const top = tech
		.slice(0, 3)
		.map((t) => t.name)
		.join(", ");
	return `Detected: ${top || "no signals"}. Suggested: ${profile}.`;
}

async function toolExtractCookies(
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	const domain = String(args.domain ?? "");
	if (!domain || /[\\/]|\.\./.test(domain)) {
		return {
			isError: true,
			content: [
				{ type: "text", text: `Invalid domain (path traversal blocked): ${domain}.` },
			],
		};
	}

	const path = `${process.cwd()}/cookies/private/${domain}.json`;
	const file = Bun.file(path);
	if (!(await file.exists())) {
		return {
			isError: true,
			content: [{ type: "text", text: `Cookie jar not found at ${path}.` }],
		};
	}

	try {
		const cookies = JSON.parse(await file.text());
		return {
			content: [
				{
					type: "text",
					text: JSON.stringify(
						{
							path,
							count: Array.isArray(cookies) ? cookies.length : 0,
							cookies,
						},
						null,
						2,
					),
				},
			],
		};
	} catch (err) {
		return {
			isError: true,
			content: [
				{ type: "text", text: `Failed to parse cookie jar: ${(err as Error).message}` },
			],
		};
	}
}

async function toolPoolRun(
	args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
	const urls = Array.isArray(args.urls) ? (args.urls as string[]) : [];
	const profile = (args.profile ?? "fast") as Profile;
	const concurrency = Math.max(1, Math.min(50, Number(args.concurrency ?? 5)));

	if (urls.length === 0) {
		return {
			isError: true,
			content: [{ type: "text", text: "No URLs provided." }],
		};
	}

	const bunlight = await loadBunlight();
	if (!bunlight) {
		return {
			isError: true,
			content: [
				{
					type: "text",
					text: "Bunlight not installed in the project. Run `bun add @bunmium/bunlight`.",
				},
			],
		};
	}

	// Simple semaphore-based concurrency without depending on PagePool, to avoid loading
	// optional sub-paths that may not exist in older Bunlight versions.
	const results: Array<{
		url: string;
		title?: string;
		latencyMs?: number;
		error?: string;
	}> = [];
	let cursor = 0;

	async function worker(): Promise<void> {
		for (;;) {
			const i = cursor++;
			if (i >= urls.length) {
				return;
			}
			const url = urls[i];
			const start = performance.now();
			let page: Awaited<ReturnType<typeof bunlight.Browser.newPage>> | null = null;
			try {
				page = await bunlight.Browser.newPage({ profile });
				await page.goto(url, { timeoutMs: 30000 });
				const title = await page.title();
				results[i] = { url, title, latencyMs: Math.round(performance.now() - start) };
			} catch (err) {
				results[i] = { url, error: (err as Error).message };
			} finally {
				if (page) {
					try {
						await page.close();
					} catch {
						// ignore
					}
				}
			}
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => worker()));

	return {
		content: [
			{
				type: "text",
				text: results.map((r) => JSON.stringify(r)).join("\n"),
			},
		],
	};
}

// JSON-RPC dispatch.

async function handleRequest(req: JsonRpcRequest): Promise<void> {
	const id = req.id ?? null;

	const respond = (result: unknown): void => {
		writeMessage({ jsonrpc: "2.0", id, result });
	};
	const error = (code: number, message: string): void => {
		writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
	};

	try {
		switch (req.method) {
			case "initialize":
				respond({
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: SERVER_INFO,
				});
				return;
			case "initialized":
			case "notifications/initialized":
				return; // notification, no response
			case "tools/list":
				respond({ tools: TOOLS });
				return;
			case "tools/call": {
				const params = req.params ?? {};
				const name = String(params.name ?? "");
				const args = (params.arguments ?? {}) as Record<string, unknown>;
				let result: { content: unknown; isError?: boolean };
				switch (name) {
					case "bunlight_scrape":
						result = await toolScrape(args);
						break;
					case "bunlight_detect":
						result = await toolDetect(args);
						break;
					case "bunlight_extract_cookies":
						result = await toolExtractCookies(args);
						break;
					case "bunlight_pool_run":
						result = await toolPoolRun(args);
						break;
					default:
						error(-32601, `Unknown tool: ${name}`);
						return;
				}
				respond(result);
				return;
			}
			case "ping":
				respond({});
				return;
			default:
				if (id !== null) {
					error(-32601, `Unknown method: ${req.method}`);
				}
				return;
		}
	} catch (err) {
		error(-32603, `Internal error: ${(err as Error).message}`);
	}
}

await readMessages(handleRequest);
