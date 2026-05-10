#!/usr/bin/env bun
/**
 * `bunlight api` — turn any website into a JSON API.
 *
 * Spawns a `Bun.serve` instance that exposes bunlight's recon / detect /
 * scrape / next-data / snapshot / screenshot capabilities as HTTP routes.
 * Each request fetches the target URL, runs the extraction, and returns
 * structured JSON.
 *
 * Endpoints (GET unless noted) :
 *
 *   GET  /                                  Landing : list of routes + OpenAPI link
 *   GET  /openapi.json                      OpenAPI 3.1 spec auto-generated
 *   GET  /healthz                           Liveness probe
 *
 *   GET  /api/recon?url=…                   Full reconnaissance (HTTP + CDN
 *                                           + frameworks + assets + CSS)
 *   GET  /api/detect?url=…                  Deep tech detection (frontend +
 *                                           backend + cdn + dns + hosting +
 *                                           cms + analytics)
 *   GET  /api/scrape?url=…&selector=…       textContent of CSS-matched
 *                                           elements (JSON array)
 *   GET  /api/next?url=…                    Next.js / Nuxt / Remix / Astro
 *                                           hydration payload
 *   GET  /api/next-data?url=…&buildId=…&route=…
 *                                           Hit `/_next/data/<id>/<route>.json`
 *   GET  /api/snapshot?url=…&format=html|text
 *                                           Raw HTML snapshot (or text)
 *
 *   POST /api/recon                         Same as GET, body = JSON
 *   POST /api/detect                        Same as GET, body = JSON
 *   POST /api/scrape                        Same as GET, body = JSON
 *
 * Output contract :
 *   - All responses are JSON unless `format=html` (snapshot only)
 *   - 200 on success, 4xx on misuse, 5xx on extraction error
 *   - `X-Bunlight-Version` header on every response
 *   - Optional `Authorization: Bearer <TOKEN>` enforcement via `--auth`
 *   - Permissive CORS by default (configurable via `--cors-origin`)
 *   - In-memory LRU cache (max 256 entries, 60 s TTL) — disable with `--no-cache`
 *
 * Reference :
 *   https://bun.com/docs/api/http
 *   https://bun.com/docs/runtime/plugins
 */

import { recon, type ReconResult } from "./recon.ts";
import { deepDetect, type DeepDetectionResult } from "../detect-deep.ts";
import { Browser, type Page } from "../api/browser.ts";
import {
	parseNextData,
	parseAppRouterFlight,
	parseNuxtState,
	parseRemixContext,
	parseAstroIslands,
	detectHydration,
	fetchNextData,
} from "../react/parser.ts";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface ApiServerOptions {
	port: number;
	hostname: string;
	authToken: string | null;
	corsOrigin: string;
	cacheEnabled: boolean;
	cacheTtlMs: number;
	cacheMax: number;
}

const DEFAULTS: ApiServerOptions = {
	port: 8787,
	hostname: "0.0.0.0",
	authToken: null,
	corsOrigin: "*",
	cacheEnabled: true,
	cacheTtlMs: 60_000,
	cacheMax: 256,
};

// ---------------------------------------------------------------------------
// Tiny LRU cache (response-level)
// ---------------------------------------------------------------------------

interface CacheEntry {
	body: string;
	contentType: string;
	expiresAt: number;
}

class LruCache {
	#map = new Map<string, CacheEntry>();
	constructor(private readonly max: number) {}
	get(key: string): CacheEntry | null {
		const e = this.#map.get(key);
		if (!e) return null;
		if (Date.now() > e.expiresAt) {
			this.#map.delete(key);
			return null;
		}
		// Touch (LRU)
		this.#map.delete(key);
		this.#map.set(key, e);
		return e;
	}
	set(key: string, value: CacheEntry): void {
		if (this.#map.size >= this.max) {
			const oldest = this.#map.keys().next().value;
			if (oldest !== undefined) this.#map.delete(oldest);
		}
		this.#map.set(key, value);
	}
	clear(): void {
		this.#map.clear();
	}
	size(): number {
		return this.#map.size;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(
	status: number,
	body: unknown,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function corsHeaders(origin: string): Record<string, string> {
	return {
		"access-control-allow-origin": origin,
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type, authorization",
	};
}

function isAuthorized(req: Request, opts: ApiServerOptions): boolean {
	if (!opts.authToken) return true;
	const h = req.headers.get("authorization") ?? "";
	return h === `Bearer ${opts.authToken}`;
}

async function readUrlParam(
	req: Request,
	pathParams: Record<string, string>,
): Promise<{ url?: string; extras: Record<string, string> }> {
	const u = new URL(req.url);
	const extras: Record<string, string> = {};
	for (const [k, v] of u.searchParams) extras[k] = v;
	for (const [k, v] of Object.entries(pathParams)) extras[k] = v;
	let urlValue = extras["url"];

	if (req.method === "POST") {
		try {
			const body = (await req.json()) as Record<string, unknown>;
			for (const [k, v] of Object.entries(body)) {
				if (typeof v === "string") extras[k] = v;
			}
			if (typeof body["url"] === "string") urlValue = body["url"] as string;
		} catch {
			// non-JSON body — ignore
		}
	}

	return { url: urlValue, extras };
}

// ---------------------------------------------------------------------------
// OpenAPI spec
// ---------------------------------------------------------------------------

/**
 * OpenAPI 3.1 spec — typed via reusable `components.schemas` so consumers can
 * generate a fully-typed client with `openapi-typescript` :
 *
 *   bunx openapi-typescript http://localhost:8787/openapi.json -o api.d.ts
 *
 * The schemas mirror our internal interfaces (`ReconResult`,
 * `DeepDetectionResult`, `NextDataPayload`, `ScrapeResultItem`,
 * `HydrationSnapshot`) so the generated TS types align 1:1 with the JS
 * objects emitted by the handlers.
 */
function openApiSpec(opts: ApiServerOptions): unknown {
	const errorResponses = {
		"400": {
			description: "Misuse — missing or invalid query parameters",
			content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
		},
		"401": {
			description: "Unauthorized — missing or invalid Bearer token",
			content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
		},
		"500": {
			description: "Server error during extraction (fetch / parse / render)",
			content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
		},
	};

	return {
		openapi: "3.1.0",
		info: {
			title: "bunlight API",
			version: "0.1.0-alpha.0",
			description:
				"Turns any website into a JSON API : recon, framework detection, CSS extraction, Next.js data, snapshots.",
			license: { name: "0BSD" },
		},
		servers: [{ url: `http://${opts.hostname}:${opts.port}` }],
		components: {
			securitySchemes: {
				bearerAuth: { type: "http", scheme: "bearer", description: "Optional, set via --auth." },
			},
			schemas: {
				Error: {
					type: "object",
					required: ["error"],
					properties: {
						error: { type: "string" },
						reason: { type: "string" },
					},
				},
				Health: {
					type: "object",
					required: ["ok", "version", "cacheSize"],
					properties: {
						ok: { type: "boolean" },
						version: { type: "string" },
						cacheSize: { type: "integer", minimum: 0 },
					},
				},
				ReconHeaders: {
					type: "object",
					required: ["cdnVendor", "cspHosts"],
					properties: {
						server: { type: "string" },
						xPoweredBy: { type: "string" },
						cdnRayId: { type: "string" },
						cdnVendor: { type: "string" },
						cspHosts: { type: "array", items: { type: "string" } },
						cacheControl: { type: "string" },
						contentSecurityPolicy: { type: "string" },
						contentType: { type: "string" },
					},
				},
				ReconAsset: {
					type: "object",
					required: ["type", "url", "host"],
					properties: {
						type: {
							type: "string",
							enum: ["stylesheet", "script", "image", "font", "iframe"],
						},
						url: { type: "string", format: "uri" },
						host: { type: "string" },
					},
				},
				ReconFramework: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string" },
						categories: { type: "array", items: { type: "string" } },
						version: { type: "string" },
					},
				},
				ReconResult: {
					type: "object",
					required: [
						"$schema",
						"url",
						"finalUrl",
						"httpStatus",
						"bytes",
						"gotoMs",
						"profile",
						"headers",
						"frameworks",
						"assets",
						"cssSelectors",
					],
					properties: {
						$schema: { type: "string", const: "bunlight-recon-v1" },
						url: { type: "string", format: "uri" },
						finalUrl: { type: "string", format: "uri" },
						httpStatus: { type: "integer" },
						bytes: { type: "integer", minimum: 0 },
						gotoMs: { type: "number" },
						profile: { type: "string", enum: ["static", "fast", "http"] },
						headers: { $ref: "#/components/schemas/ReconHeaders" },
						frameworks: { type: "array", items: { $ref: "#/components/schemas/ReconFramework" } },
						assets: { type: "array", items: { $ref: "#/components/schemas/ReconAsset" } },
						cssSelectors: { type: "array", items: { type: "string" } },
						screenshotPath: { type: "string" },
						screenshotBytes: { type: "integer", minimum: 0 },
					},
				},
				DetectionEvidence: {
					type: "object",
					required: ["name", "evidence", "source"],
					properties: {
						name: { type: "string" },
						evidence: { type: "string" },
						source: {
							type: "string",
							enum: ["header", "dns", "ip", "body", "csp", "wappalyzer", "cert"],
						},
						confidence: { type: "number", minimum: 0, maximum: 1 },
						version: { type: "string" },
						categories: { type: "array", items: { type: "string" } },
					},
				},
				DeepDetectionResult: {
					type: "object",
					required: [
						"url",
						"finalUrl",
						"httpStatus",
						"hostname",
						"resolvedIps",
						"cnameChain",
						"nsRecords",
						"reversePtr",
						"frontend",
						"backend",
						"cdn",
						"dns",
						"hosting",
						"server",
						"language",
						"cms",
						"analytics",
						"tagManagers",
						"framework",
						"library",
						"other",
					],
					properties: {
						url: { type: "string", format: "uri" },
						finalUrl: { type: "string", format: "uri" },
						httpStatus: { type: "integer" },
						hostname: { type: "string" },
						resolvedIps: { type: "array", items: { type: "string" } },
						cnameChain: { type: "array", items: { type: "string" } },
						nsRecords: { type: "array", items: { type: "string" } },
						reversePtr: {
							type: "object",
							additionalProperties: { type: "array", items: { type: "string" } },
						},
						frontend: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						backend: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						cdn: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						dns: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						hosting: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						server: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						language: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						cms: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						analytics: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						tagManagers: {
							type: "array",
							items: { $ref: "#/components/schemas/DetectionEvidence" },
						},
						framework: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						library: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
						other: { type: "array", items: { $ref: "#/components/schemas/DetectionEvidence" } },
					},
				},
				ScrapeItem: {
					type: "object",
					required: ["index", "text"],
					properties: {
						index: { type: "integer", minimum: 0 },
						text: { type: "string" },
					},
				},
				NextDataPayload: {
					type: "object",
					required: ["raw"],
					properties: {
						page: { type: "string" },
						query: { type: "object", additionalProperties: true },
						props: {
							type: "object",
							properties: {
								pageProps: { type: "object", additionalProperties: true },
							},
							additionalProperties: true,
						},
						buildId: { type: "string" },
						isFallback: { type: "boolean" },
						dev: { type: "boolean" },
						locale: { type: "string" },
						locales: { type: "array", items: { type: "string" } },
						defaultLocale: { type: "string" },
						raw: { type: "object", additionalProperties: true },
					},
				},
				HydrationSignal: {
					type: "object",
					required: ["framework", "hydrated"],
					properties: {
						framework: {
							type: "string",
							enum: [
								"next-pages",
								"next-app",
								"nuxt",
								"remix",
								"astro",
								"sveltekit",
								"react",
								"unknown",
							],
						},
						hydrated: { type: "boolean" },
						version: { type: "string" },
					},
				},
				HydrationSnapshot: {
					type: "object",
					required: ["url", "finalUrl", "httpStatus", "bytes", "signal"],
					properties: {
						url: { type: "string", format: "uri" },
						finalUrl: { type: "string", format: "uri" },
						httpStatus: { type: "integer" },
						bytes: { type: "integer", minimum: 0 },
						signal: { $ref: "#/components/schemas/HydrationSignal" },
						nextData: {
							oneOf: [{ $ref: "#/components/schemas/NextDataPayload" }, { type: "null" }],
						},
						appRouterChunks: {
							type: "array",
							items: {
								type: "object",
								required: ["index", "payload"],
								properties: {
									index: { type: "integer" },
									payload: { type: "string" },
								},
							},
						},
						nuxtState: { nullable: true },
						remixContext: { nullable: true },
						astroIslands: {
							type: "array",
							items: { type: "object", additionalProperties: { type: "string" } },
						},
					},
				},
				PostBody: {
					type: "object",
					properties: {
						url: { type: "string", format: "uri" },
						selector: { type: "string" },
						max: { type: "integer" },
						format: { type: "string", enum: ["html", "text"] },
						buildId: { type: "string" },
						route: { type: "string" },
					},
				},
			},
		},
		paths: {
			"/healthz": {
				get: {
					operationId: "healthz",
					summary: "Liveness probe",
					responses: {
						"200": {
							description: "Server status",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/Health" } },
							},
						},
					},
				},
			},
			"/api/recon": {
				get: {
					operationId: "reconGet",
					summary: "Reconnaissance (HTTP + CDN + frameworks + assets + CSS)",
					parameters: [
						{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } },
					],
					responses: {
						"200": {
							description: "Recon result",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/ReconResult" } },
							},
						},
						...errorResponses,
					},
				},
				post: {
					operationId: "reconPost",
					summary: "Same as GET, body = { url }",
					requestBody: {
						required: true,
						content: {
							"application/json": { schema: { $ref: "#/components/schemas/PostBody" } },
						},
					},
					responses: {
						"200": {
							description: "Recon result",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/ReconResult" } },
							},
						},
						...errorResponses,
					},
				},
			},
			"/api/detect": {
				get: {
					operationId: "detect",
					summary: "Deep tech detection (frontend + backend + cdn + dns + hosting + cms)",
					parameters: [
						{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } },
					],
					responses: {
						"200": {
							description: "Multi-bucket detection",
							content: {
								"application/json": {
									schema: { $ref: "#/components/schemas/DeepDetectionResult" },
								},
							},
						},
						...errorResponses,
					},
				},
			},
			"/api/scrape": {
				get: {
					operationId: "scrape",
					summary: "Extract textContent of CSS-matched elements",
					parameters: [
						{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } },
						{ name: "selector", in: "query", required: true, schema: { type: "string" } },
						{ name: "max", in: "query", schema: { type: "integer", default: 50, minimum: 1 } },
					],
					responses: {
						"200": {
							description: "Array of selector matches",
							content: {
								"application/json": {
									schema: { type: "array", items: { $ref: "#/components/schemas/ScrapeItem" } },
								},
							},
						},
						...errorResponses,
					},
				},
			},
			"/api/next": {
				get: {
					operationId: "nextHydration",
					summary: "Next.js / Nuxt / Remix / Astro hydration payload",
					parameters: [
						{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } },
					],
					responses: {
						"200": {
							description: "Hydration snapshot",
							content: {
								"application/json": { schema: { $ref: "#/components/schemas/HydrationSnapshot" } },
							},
						},
						...errorResponses,
					},
				},
			},
			"/api/next-data": {
				get: {
					operationId: "nextData",
					summary: "Fetch /_next/data/<buildId>/<route>.json",
					parameters: [
						{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } },
						{ name: "buildId", in: "query", required: true, schema: { type: "string" } },
						{ name: "route", in: "query", required: true, schema: { type: "string" } },
					],
					responses: {
						"200": {
							description: "Raw SSR data JSON",
							content: { "application/json": { schema: { type: "object" } } },
						},
						...errorResponses,
					},
				},
			},
			"/api/snapshot": {
				get: {
					operationId: "snapshot",
					summary: "Raw HTML / text snapshot",
					parameters: [
						{ name: "url", in: "query", required: true, schema: { type: "string", format: "uri" } },
						{
							name: "format",
							in: "query",
							schema: { type: "string", enum: ["html", "text"], default: "html" },
						},
					],
					responses: {
						"200": {
							description: "Snapshot body",
							content: {
								"text/html": { schema: { type: "string" } },
								"text/plain": { schema: { type: "string" } },
							},
						},
						...errorResponses,
					},
				},
			},
		},
		security: opts.authToken ? [{ bearerAuth: [] }] : [],
	};
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

async function handleRecon(url: string): Promise<ReconResult> {
	return recon({
		url,
		profile: "http",
		screenshot: false,
		emitJson: true,
		timeoutMs: 25_000,
		quiet: true,
		plain: false,
	});
}

async function handleDetect(url: string): Promise<DeepDetectionResult> {
	return deepDetect(url);
}

async function handleScrape(
	url: string,
	selector: string,
	max: number,
): Promise<Array<{ index: number; text: string }>> {
	let page: Page | undefined;
	try {
		page = (await Browser.newPage({ profile: "static" })) as Page;
		await page.goto(url, { timeoutMs: 25_000 });
		const els = await page.$$(selector);
		const out: Array<{ index: number; text: string }> = [];
		for (let i = 0; i < els.length && i < max; i++) {
			const el = els[i] as { textContent?: () => Promise<string> };
			const text = (await el.textContent?.()) ?? "";
			out.push({ index: i, text: text.trim().slice(0, 500) });
		}
		return out;
	} finally {
		try {
			await page?.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

async function handleNext(url: string): Promise<unknown> {
	const r = await fetch(url, {
		signal: AbortSignal.timeout(20_000),
		headers: {
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		},
	});
	const html = await r.text();
	return {
		url,
		finalUrl: r.url,
		httpStatus: r.status,
		bytes: html.length,
		signal: detectHydration(html),
		nextData: parseNextData(html),
		appRouterChunks: parseAppRouterFlight(html),
		nuxtState: parseNuxtState(html),
		remixContext: parseRemixContext(html),
		astroIslands: parseAstroIslands(html),
	};
}

async function handleSnapshot(
	url: string,
	format: "html" | "text",
): Promise<{ body: string; contentType: string }> {
	const r = await fetch(url, {
		signal: AbortSignal.timeout(20_000),
		headers: {
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		},
	});
	const html = await r.text();
	if (format === "text") {
		const text = html
			.replace(/<script[\s\S]*?<\/script>/gi, "")
			.replace(/<style[\s\S]*?<\/style>/gi, "")
			.replace(/<[^>]+>/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		return { body: text, contentType: "text/plain; charset=utf-8" };
	}
	return { body: html, contentType: "text/html; charset=utf-8" };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

function landingHtml(opts: ApiServerOptions): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>bunlight API</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:720px;margin:2em auto;padding:0 1em}
code{background:#f5f5f5;padding:2px 4px;border-radius:3px}h1{margin-top:0}</style>
</head><body>
<h1>bunlight API</h1>
<p>Turn any website into a JSON API. <a href="/openapi.json">OpenAPI spec</a> &middot; <a href="/healthz">Health</a></p>
<h2>Endpoints</h2>
<ul>
<li><code>GET /api/recon?url=…</code> — full reconnaissance</li>
<li><code>GET /api/detect?url=…</code> — frameworks + CDN + DNS</li>
<li><code>GET /api/scrape?url=…&amp;selector=…</code> — CSS extraction</li>
<li><code>GET /api/next?url=…</code> — Next/Nuxt/Remix/Astro hydration</li>
<li><code>GET /api/next-data?url=…&amp;buildId=…&amp;route=…</code></li>
<li><code>GET /api/snapshot?url=…&amp;format=html|text</code></li>
</ul>
<p>Listening on <code>${opts.hostname}:${opts.port}</code> &middot; cache: ${opts.cacheEnabled ? `${opts.cacheTtlMs / 1000}s LRU max ${opts.cacheMax}` : "disabled"} &middot; auth: ${opts.authToken ? "required" : "open"}</p>
</body></html>`;
}

export async function startApiServer(options: Partial<ApiServerOptions> = {}): Promise<{
	port: number;
	stop: () => void;
}> {
	const opts: ApiServerOptions = { ...DEFAULTS, ...options };
	const cache = new LruCache(opts.cacheMax);
	const VERSION =
		typeof (globalThis as unknown as { __BUNLIGHT_VERSION__?: string }).__BUNLIGHT_VERSION__ ===
		"string"
			? (globalThis as unknown as { __BUNLIGHT_VERSION__: string }).__BUNLIGHT_VERSION__
			: "0.1.0-alpha.0";

	const server = Bun.serve({
		port: opts.port,
		hostname: opts.hostname,
		fetch: async (req) => {
			const u = new URL(req.url);
			const baseHeaders: Record<string, string> = {
				...corsHeaders(opts.corsOrigin),
				"x-bunlight-version": VERSION,
			};

			// Preflight
			if (req.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: baseHeaders });
			}

			// Auth
			if (!isAuthorized(req, opts)) {
				return jsonResponse(401, { error: "unauthorized" }, baseHeaders);
			}

			// Routes
			try {
				if (u.pathname === "/" || u.pathname === "") {
					return new Response(landingHtml(opts), {
						headers: { "content-type": "text/html; charset=utf-8", ...baseHeaders },
					});
				}
				if (u.pathname === "/healthz") {
					return jsonResponse(
						200,
						{ ok: true, version: VERSION, cacheSize: cache.size() },
						baseHeaders,
					);
				}
				if (u.pathname === "/openapi.json") {
					return jsonResponse(200, openApiSpec(opts), baseHeaders);
				}

				if (u.pathname === "/api/recon") {
					const { url } = await readUrlParam(req, {});
					if (!url) return jsonResponse(400, { error: "missing url" }, baseHeaders);
					const cached = opts.cacheEnabled ? cache.get(`recon:${url}`) : null;
					if (cached)
						return new Response(cached.body, {
							headers: { "content-type": cached.contentType, "x-cache": "hit", ...baseHeaders },
						});
					const r = await handleRecon(url);
					const body = JSON.stringify(r, null, 2);
					if (opts.cacheEnabled)
						cache.set(`recon:${url}`, {
							body,
							contentType: "application/json",
							expiresAt: Date.now() + opts.cacheTtlMs,
						});
					return new Response(body, {
						headers: { "content-type": "application/json", "x-cache": "miss", ...baseHeaders },
					});
				}

				if (u.pathname === "/api/detect") {
					const { url } = await readUrlParam(req, {});
					if (!url) return jsonResponse(400, { error: "missing url" }, baseHeaders);
					const cached = opts.cacheEnabled ? cache.get(`detect:${url}`) : null;
					if (cached)
						return new Response(cached.body, {
							headers: { "content-type": cached.contentType, "x-cache": "hit", ...baseHeaders },
						});
					const r = await handleDetect(url);
					const body = JSON.stringify(r, null, 2);
					if (opts.cacheEnabled)
						cache.set(`detect:${url}`, {
							body,
							contentType: "application/json",
							expiresAt: Date.now() + opts.cacheTtlMs,
						});
					return new Response(body, {
						headers: { "content-type": "application/json", "x-cache": "miss", ...baseHeaders },
					});
				}

				if (u.pathname === "/api/scrape") {
					const { url, extras } = await readUrlParam(req, {});
					const selector = extras["selector"];
					const max = Number.parseInt(extras["max"] ?? "50", 10);
					if (!url || !selector)
						return jsonResponse(400, { error: "missing url or selector" }, baseHeaders);
					const r = await handleScrape(url, selector, max);
					return jsonResponse(200, r, baseHeaders);
				}

				if (u.pathname === "/api/next") {
					const { url } = await readUrlParam(req, {});
					if (!url) return jsonResponse(400, { error: "missing url" }, baseHeaders);
					const r = await handleNext(url);
					return jsonResponse(200, r, baseHeaders);
				}

				if (u.pathname === "/api/next-data") {
					const { extras } = await readUrlParam(req, {});
					const url = extras["url"];
					const buildId = extras["buildId"];
					const route = extras["route"];
					if (!url || !buildId || !route)
						return jsonResponse(400, { error: "missing url, buildId, or route" }, baseHeaders);
					const data = await fetchNextData(url, route, buildId);
					return jsonResponse(200, data, baseHeaders);
				}

				if (u.pathname === "/api/snapshot") {
					const { url, extras } = await readUrlParam(req, {});
					if (!url) return jsonResponse(400, { error: "missing url" }, baseHeaders);
					const format = (extras["format"] ?? "html") === "text" ? "text" : "html";
					const r = await handleSnapshot(url, format);
					return new Response(r.body, {
						headers: { "content-type": r.contentType, ...baseHeaders },
					});
				}

				return jsonResponse(404, { error: "not found", path: u.pathname }, baseHeaders);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return jsonResponse(
					500,
					{ error: "extraction failed", reason: msg.slice(0, 200) },
					baseHeaders,
				);
			}
		},
	});

	process.stderr.write(
		`bunlight api: listening on http://${opts.hostname}:${server.port}  (cache: ${opts.cacheEnabled ? "on" : "off"}, auth: ${opts.authToken ? "required" : "open"})\n`,
	);

	return {
		port: server.port,
		stop: () => server.stop(true),
	};
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage(): void {
	process.stdout.write(
		`bunlight api — turn any website into a JSON API

Usage:
  bunlight api [options]

Options:
  --port <N>           listen port (default 8787)
  --host <H>           listen hostname (default 0.0.0.0)
  --auth <TOKEN>       require Authorization: Bearer <TOKEN>
  --cors-origin <O>    Access-Control-Allow-Origin (default *)
  --no-cache           disable response cache
  --cache-ttl <ms>     cache TTL in ms (default 60000)
  --cache-max <N>      max cache entries (default 256)
  --help, -h           print this help

Endpoints:
  GET  /                    landing page
  GET  /openapi.json        OpenAPI 3.1 spec
  GET  /healthz             liveness
  GET  /api/recon?url=…     reconnaissance
  GET  /api/detect?url=…    framework / CDN / DNS / hosting detection
  GET  /api/scrape?url=…&selector=…
  GET  /api/next?url=…
  GET  /api/next-data?url=…&buildId=…&route=…
  GET  /api/snapshot?url=…&format=html|text

Example:
  bunlight api --port 8080 &
  curl 'http://localhost:8080/api/detect?url=https://nextjs.org' | jq .
`,
	);
}

function parseArgs(argv: readonly string[]): Partial<ApiServerOptions> | null {
	const opts: Partial<ApiServerOptions> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--port":
				opts.port = Number.parseInt(argv[++i], 10);
				break;
			case "--host":
			case "--hostname":
				opts.hostname = argv[++i];
				break;
			case "--auth":
				opts.authToken = argv[++i];
				break;
			case "--cors-origin":
				opts.corsOrigin = argv[++i];
				break;
			case "--no-cache":
				opts.cacheEnabled = false;
				break;
			case "--cache-ttl":
				opts.cacheTtlMs = Number.parseInt(argv[++i], 10);
				break;
			case "--cache-max":
				opts.cacheMax = Number.parseInt(argv[++i], 10);
				break;
			case "--help":
			case "-h":
				printUsage();
				return null;
			default:
				process.stderr.write(`bunlight api: unknown option ${a}\n`);
				return null;
		}
	}
	return opts;
}

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		process.exit(opts === null ? 0 : 2);
	}
	await startApiServer(opts);
}

if (import.meta.main) {
	await main(process.argv.slice(2));
}
