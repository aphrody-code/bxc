/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * `bxc recon <url>` — one-shot URL → docs.
 *
 * Probes a target URL and produces a Markdown reconnaissance report.
 */

import { Browser, type Page } from "../api/browser.ts";
import { detectFrameworks } from "../detect.ts";
import { EXIT, type CommonOptions, logger, parseCommonArgs } from "./shared.ts";
import { bxcFetch } from "../utils/bxc-fetch.ts";
import { extractStructuredData } from "../google/fetch.ts";
import { generateOpenApiSchema } from "../utils/openapi.ts";
import { getEmbedding } from "../utils/vector.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconProfile = "static" | "fast" | "http" | "stealth" | "max";

export interface ReconAsset {
	type: "stylesheet" | "script" | "image" | "font" | "iframe";
	url: string;
	host: string;
}

export interface ReconHeaders {
	server?: string;
	xPoweredBy?: string;
	cdnRayId?: string;
	cdnVendor: string;
	cspHosts: string[];
	cacheControl?: string;
	contentSecurityPolicy?: string;
	contentType?: string;
}

export const RECON_SCHEMA = "bxc-recon-v1";

export interface ReconResult {
	$schema: typeof RECON_SCHEMA;
	url: string;
	finalUrl: string;
	httpStatus: number;
	bytes: number;
	gotoMs: number;
	profile: ReconProfile;
	headers: ReconHeaders;
	frameworks: Array<{ name: string; categories?: string[]; version?: string }>;
	assets: ReconAsset[];
	cssSelectors: string[];
	screenshotPath?: string;
	screenshotBytes?: number;
}

interface ReconCliOptions extends CommonOptions {
	url: string;
	profile: ReconProfile;
	outputPath?: string;
	snapshotDir?: string;
	screenshot: boolean;
	plain: boolean;
	headless?: boolean;
	cookies?: string | any[];
	userAgent?: string;
	viewport?: { width: number; height: number };
	proxyAuth?: string;
	spawnOpts?: any;
}

// ---------------------------------------------------------------------------
// CDN fingerprinting
// ---------------------------------------------------------------------------

function fingerprintCdn(headers: Record<string, string>): string {
	const get = (k: string): string | undefined => headers[k.toLowerCase()];
	const server = (get("server") ?? "").toLowerCase();
	if (get("cf-ray") || server.includes("cloudflare")) return "Cloudflare";
	if (get("x-amz-cf-id") || get("x-amz-cf-pop")) return "AWS CloudFront";
	if (get("x-served-by") && get("x-cache")) return "Fastly";
	if (server.includes("akamai") || get("x-akamai-edge")) return "Akamai";
	if (
		server === "google frontend" ||
		server.includes("gws") ||
		server.includes("esf") ||
		get("x-cloud-trace-context")
	) {
		return "Google Frontend";
	}
	if (get("x-vercel-id")) return "Vercel";
	if (server.includes("cloudfront")) return "AWS CloudFront";
	if (server.includes("nginx")) return "nginx (origin or self-hosted)";
	return server || "unknown";
}

function extractCspHosts(csp: string): string[] {
	const out = new Set<string>();
	for (const directive of csp.split(";")) {
		const trimmed = directive.trim();
		if (!trimmed) continue;
		for (const part of trimmed.split(/\s+/).slice(1)) {
			if (part.startsWith("http")) {
				try {
					out.add(new URL(part).hostname);
				} catch {
					// not a valid URL — skip
				}
			}
		}
	}
	return [...out].sort();
}

async function fetchFull(
	url: string,
	opts: Partial<ReconCliOptions>,
): Promise<{
	headers: Record<string, string>;
	status: number;
	finalUrl: string;
	body: string;
}> {
	const r = await bxcFetch(url, opts);
	const headers: Record<string, string> = {};
	r.headers.forEach((v, k) => {
		headers[k.toLowerCase()] = v;
	});
	const body = await r.text();
	return { headers, status: r.status, finalUrl: r.url, body };
}

function reconHeaders(headers: Record<string, string>): ReconHeaders {
	return {
		server: headers["server"],
		xPoweredBy: headers["x-powered-by"],
		cdnRayId:
			headers["cf-ray"] ??
			headers["x-amz-cf-id"] ??
			headers["x-served-by"] ??
			headers["x-cloud-trace-context"],
		cdnVendor: fingerprintCdn(headers),
		cspHosts: headers["content-security-policy"]
			? extractCspHosts(headers["content-security-policy"])
			: [],
		cacheControl: headers["cache-control"],
		contentSecurityPolicy: headers["content-security-policy"],
		contentType: headers["content-type"],
	};
}

// ---------------------------------------------------------------------------
// Asset extraction
// ---------------------------------------------------------------------------

function extractAssets(html: string, base: string): ReconAsset[] {
	const assets: ReconAsset[] = [];
	const baseUrl = new URL(base);

	const resolve = (href: string): string | null => {
		try {
			return new URL(href, baseUrl).href;
		} catch {
			return null;
		}
	};

	const push = (type: ReconAsset["type"], href: string): void => {
		const url = resolve(href);
		if (!url) return;
		try {
			assets.push({ type, url, host: new URL(url).hostname });
		} catch {
			// invalid host — ignore
		}
	};

	for (const m of html.matchAll(
		/<link[^>]+rel=["']?(?:stylesheet|preload)["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
	)) {
		push("stylesheet", m[1]);
	}
	for (const m of html.matchAll(/<script[^+]+src=["']([^"']+)["']/gi)) {
		push("script", m[1]);
	}
	for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
		push("image", m[1]);
	}
	for (const m of html.matchAll(
		/<link[^>]+(?:as=["']?font["']?|rel=["']?font["']?)[^>]+href=["']([^"']+)["'][^>]*>/gi,
	)) {
		push("font", m[1]);
	}
	for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
		push("iframe", m[1]);
	}

	return assets;
}

// ---------------------------------------------------------------------------
// CSS selectors
// ---------------------------------------------------------------------------

async function extractCssSelectors(
	html: string,
	base: string,
	opts: Partial<ReconCliOptions>,
	maxStylesheets = 5,
): Promise<string[]> {
	const allCss: string[] = [];

	// Inline <style>
	for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
		allCss.push(m[1]);
	}

	// Linked stylesheets (limited)
	const baseUrl = new URL(base);
	const cssUrls = new Set<string>();
	for (const m of html.matchAll(
		/<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
	)) {
		try {
			cssUrls.add(new URL(m[1], baseUrl).href);
		} catch {
			// skip invalid URL
		}
	}

	let fetched = 0;
	for (const cssUrl of cssUrls) {
		if (fetched >= maxStylesheets) break;
		try {
			const r = await bxcFetch(cssUrl, opts);
			if (r.ok) {
				allCss.push(await r.text());
				fetched++;
			}
		} catch {
			// skip unreachable stylesheet
		}
	}

	// Heuristic selector extraction
	const selectorSet = new Set<string>();
	const combined = allCss.join("\n");
	for (const m of combined.matchAll(/([^{}@]+)\{[^{}]*\}/g)) {
		const sel = m[1].trim().replace(/\s+/g, " ");
		if (
			!sel ||
			sel.startsWith("@") ||
			sel.startsWith("/*") ||
			sel.length > 200 ||
			/^\d/.test(sel)
		) {
			continue;
		}
		for (const s of sel.split(",")) {
			const trimmed = s.trim();
			if (trimmed && trimmed.length < 200) selectorSet.add(trimmed);
		}
	}

	return [...selectorSet].sort();
}

// ---------------------------------------------------------------------------
// Recon API (programmatic)
// ---------------------------------------------------------------------------

export async function recon(opts: ReconCliOptions): Promise<ReconResult> {
	const t0 = Bun.nanoseconds();
	const cacheKey = `bxc:cache:url:${opts.url}`;
	const { redis } = await import("bun");
	const { BxcDB } = await import("../db/BxcDB.ts");
	const { isCrawlFailure, profilesOrder } = await import("../crawler/crawl-utils.ts");

	// 1. Cache Check (unless screenshot is requested)
	if (!opts.screenshot) {
		try {
			const cached = await redis.get(cacheKey);
			if (cached) {
				const parsed = JSON.parse(cached);
				const body = parsed.html || "";
				const [assets, cssSelectors, frameworks] = await Promise.all([
					Promise.resolve(extractAssets(body, opts.url)),
					extractCssSelectors(body, opts.url, opts),
					detectFrameworks(
						{ html: body, headers: {} },
						{ insecure: opts.insecure, timeoutMs: 10_000 },
					).catch(() => []),
				]);
				return {
					$schema: RECON_SCHEMA,
					url: opts.url,
					finalUrl: parsed.url || opts.url,
					httpStatus: parsed.status || 200,
					bytes: body.length,
					gotoMs: 0,
					profile: parsed.profileUsed || opts.profile,
					headers: { cdnVendor: "Cached (Redis)", cspHosts: [] },
					frameworks: frameworks.map((f) => ({
						name: f.name,
						categories: f.categories,
						version: f.version,
					})),
					assets,
					cssSelectors,
				};
			}
		} catch (err) {
			logger.error(`[recon-cache] Redis lookup error: ${err}`);
		}

		const db = new BxcDB();
		try {
			const row = db.getScrapeByUrl(opts.url);
			if (row) {
				const body = row.content || "";
				const [assets, cssSelectors, frameworks] = await Promise.all([
					Promise.resolve(extractAssets(body, opts.url)),
					extractCssSelectors(body, opts.url, opts),
					detectFrameworks(
						{ html: body, headers: {} },
						{ insecure: opts.insecure, timeoutMs: 10_000 },
					).catch(() => []),
				]);
				const result: ReconResult = {
					$schema: RECON_SCHEMA,
					url: opts.url,
					finalUrl: row.url || opts.url,
					httpStatus: row.status,
					bytes: body.length,
					gotoMs: 0,
					profile: row.profile || opts.profile,
					headers: { cdnVendor: "Cached (SQLite)", cspHosts: [] },
					frameworks: frameworks.map((f) => ({
						name: f.name,
						categories: f.categories,
						version: f.version,
					})),
					assets,
					cssSelectors,
				};
				// populate redis cache
				try {
					await redis.set(
						cacheKey,
						JSON.stringify({
							html: body,
							url: row.url,
							status: row.status,
							profileUsed: row.profile,
							markdown: row.markdown || "",
							structured: row.json_data ? JSON.parse(row.json_data) : null,
							openapi: row.openapi_spec ? JSON.parse(row.openapi_spec) : null,
						}),
						"EX",
						86400,
					);
				} catch {}
				return result;
			}
		} catch (err) {
			logger.error(`[recon-cache] SQLite lookup error: ${err}`);
		} finally {
			db.close();
		}
	}

	// 2. Live Crawl with Profile Escalation
	const idx = profilesOrder.indexOf(opts.profile);
	const escalationPath = idx === -1 ? profilesOrder : profilesOrder.slice(idx);

	let lastError: Error | null = null;
	let headers: ReconHeaders = { cdnVendor: "unknown", cspHosts: [] };
	let rawHeaders: Record<string, string> = {};
	let body = "";
	let finalUrl = opts.url;
	let httpStatus = 200;
	let profileUsed = opts.profile;
	let gotoMs = 0;
	let screenshotBytes: number | undefined;
	let screenshotPath: string | undefined;

	for (const profile of escalationPath) {
		if (!opts.quiet) logger.log(`[recon] Probing target using profile: ${profile}`);
		const tStart = Bun.nanoseconds();
		let page: any = null;
		try {
			// First, do a lightweight fetch to get headers (fingerprint CDN)
			try {
				const fetched = await fetchFull(opts.url, opts);
				rawHeaders = fetched.headers;
				headers = reconHeaders(rawHeaders);
				httpStatus = fetched.status;
				finalUrl = fetched.finalUrl;
				body = fetched.body;
			} catch (fetchErr) {
				// if http fetch fails, we still try browser profiles
				if (profile === "http") throw fetchErr;
			}

			if (profile === "http") {
				if (isCrawlFailure(httpStatus, body, "")) {
					throw new Error(`Crawl failure detected (status: ${httpStatus})`);
				}
				gotoMs = (Bun.nanoseconds() - tStart) / 1e6;
				profileUsed = "http";
			} else {
				// Browser profiles: fast, stealth, max
				const isBrowserProfile =
					profile === "fast" || profile === "stealth" || profile === "max";
				page = (await Browser.newPage({
					profile,
					headless: opts.headless ?? true,
					cookies: opts.cookies,
					userAgent: opts.userAgent,
					viewport: opts.viewport,
					insecure: opts.insecure,
					proxy: opts.proxy,
					proxyAuth: opts.proxyAuth,
					spawnOpts:
						opts.spawnOpts ??
						(isBrowserProfile
							? { logLevel: "error", readyTimeoutMs: 10000 }
							: undefined),
				})) as Page;

				const navigationPromise = page.goto(opts.url, {
					timeoutMs: opts.timeoutMs ?? 30000,
				});
				const timeoutPromise = new Promise<never>((_, rej) =>
					setTimeout(
						() => rej(new Error("navigation timeout")),
						opts.timeoutMs ?? 30000,
					),
				);
				const nav = await Promise.race([navigationPromise, timeoutPromise]);

				gotoMs = (Bun.nanoseconds() - tStart) / 1e6;
				finalUrl = page.url();
				body = await page.content();
				const title = await page.title();
				httpStatus = nav?.status ?? 200;

				if (isCrawlFailure(httpStatus, body, title)) {
					throw new Error(
						`Crawl failure detected (status: ${httpStatus}, title: "${title}")`,
					);
				}

				if (opts.screenshot && isBrowserProfile && opts.snapshotDir) {
					try {
						const png = await page.screenshot({ format: "png" });
						screenshotPath = `${opts.snapshotDir}/screenshot.png`;
						await Bun.write(screenshotPath, png);
						screenshotBytes = png.byteLength;
					} catch (screenshotErr) {
						logger.warn(`Screenshot failed: ${screenshotErr}`);
					}
				}
				profileUsed = profile;
			}

			// Save to cache (Redis and SQLite)
			const markdown = page
				? await page.markdown()
				: body.replace(/<[^>]*>/g, " ").slice(0, 10000);
			const structured = await extractStructuredData(body);
			const openapi = generateOpenApiSchema({
				url: opts.url,
				title: page ? await page.title() : "Recon Target",
				description: structured.description || undefined,
				markdown,
				structuredData: structured,
				timestamp: new Date().toISOString(),
			});
			const vector = await getEmbedding(markdown);

			const db = new BxcDB();
			try {
				db.saveScrape(
					opts.url,
					profile,
					httpStatus,
					body,
					{
						title: page ? await page.title() : "Recon Target",
						canonical: structured.canonical,
						openGraph: structured.openGraph,
					},
					markdown,
					structured,
					openapi,
					vector,
				);
			} catch (dbErr) {
				logger.error(`[recon-cache] SQLite save error: ${dbErr}`);
			} finally {
				db.close();
			}

			try {
				await redis.set(
					cacheKey,
					JSON.stringify({
						html: body,
						url: finalUrl,
						status: httpStatus,
						profileUsed: profile,
						markdown,
						structured,
						openapi,
						vector,
						timestamp: new Date().toISOString(),
					}),
					"EX",
					86400,
				);
			} catch (redisErr) {
				logger.error(`[recon-cache] Redis save error: ${redisErr}`);
			}

			break; // Succeeded! Break out of loop
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (!opts.quiet)
				logger.warn(`[recon] Profile ${profile} failed: ${message}`);
			lastError = err instanceof Error ? err : new Error(message);
		} finally {
			if (page) {
				try {
					await page.close();
				} catch {}
			}
		}
	}

	if (body === "") {
		throw (
			lastError ??
			new Error(`Failed to recon target ${opts.url} using escalation path.`)
		);
	}

	const [assets, cssSelectors, frameworks] = await Promise.all([
		Promise.resolve(extractAssets(body, opts.url)),
		extractCssSelectors(body, opts.url, opts),
		detectFrameworks(
			{ html: body, headers: {} },
			{ insecure: opts.insecure, timeoutMs: 10_000 },
		).catch(() => []),
	]);

	if (opts.snapshotDir) {
		await Bun.write(`${opts.snapshotDir}/${opts.profile}.html`, body).catch(
			() => {},
		);
		await Bun.write(
			`${opts.snapshotDir}/headers.json`,
			JSON.stringify(rawHeaders, null, 2),
		).catch(() => {});
		await Bun.write(
			`${opts.snapshotDir}/css-selectors.txt`,
			cssSelectors.join("\n"),
		).catch(() => {});
	}

	return {
		$schema: RECON_SCHEMA,
		url: opts.url,
		finalUrl,
		httpStatus,
		bytes: body.length,
		gotoMs,
		profile: opts.profile,
		headers,
		frameworks: frameworks.map((f) => ({
			name: f.name,
			categories: f.categories,
			version: f.version,
		})),
		assets,
		cssSelectors,
		screenshotPath,
		screenshotBytes,
	};
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPlain(r: ReconResult): string {
	const lines: string[] = [];
	lines.push(`schema: ${RECON_SCHEMA}`);
	lines.push(`url: ${r.url}`);
	lines.push(`final_url: ${r.finalUrl}`);
	lines.push(`http_status: ${r.httpStatus}`);
	lines.push(`bytes: ${r.bytes}`);
	lines.push(`goto_ms: ${r.gotoMs.toFixed(0)}`);
	lines.push(`profile: ${r.profile}`);
	lines.push(`server: ${r.headers.server ?? ""}`);
	lines.push(`x_powered_by: ${r.headers.xPoweredBy ?? ""}`);
	lines.push(`cdn: ${r.headers.cdnVendor}`);
	lines.push(`cache_control: ${r.headers.cacheControl ?? ""}`);
	lines.push(`content_type: ${r.headers.contentType ?? ""}`);
	for (const h of r.headers.cspHosts) lines.push(`csp_host: ${h}`);
	for (const f of r.frameworks) {
		lines.push(`framework: ${f.name}${f.version ? `@${f.version}` : ""}`);
	}
	for (const a of r.assets) lines.push(`asset:${a.type} ${a.url}`);
	for (const s of r.cssSelectors) lines.push(`css_selector: ${s}`);
	if (r.screenshotPath)
		lines.push(`screenshot: ${r.screenshotPath} ${r.screenshotBytes ?? 0}b`);
	return lines.join("\n");
}

export function renderMarkdown(r: ReconResult): string {
	const lines: string[] = [];
	lines.push(`# Recon report — ${r.url}`);
	lines.push("");
	lines.push(
		`Date: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
	);
	if (r.url !== r.finalUrl) {
		lines.push(`Final URL: ${r.finalUrl}`);
	}
	lines.push(`Profile used: \`${r.profile}\``);
	lines.push("");

	lines.push(`## HTTP & CDN`);
	lines.push("");
	lines.push(`- **HTTP status**: ${r.httpStatus}`);
	lines.push(
		`- **Body bytes**: ${r.bytes} (${(r.bytes / 1024).toFixed(0)} KB)`,
	);
	lines.push(`- **goto duration**: ${r.gotoMs.toFixed(0)} ms`);
	lines.push(`- **Server**: \`${r.headers.server ?? "n/a"}\``);
	lines.push(`- **X-Powered-By**: \`${r.headers.xPoweredBy ?? "n/a"}\``);
	lines.push(`- **Content-Type**: \`${r.headers.contentType ?? "n/a"}\``);
	lines.push(`- **CDN fingerprint**: ${r.headers.cdnVendor}`);
	lines.push(`- **Trace/Ray ID**: \`${r.headers.cdnRayId ?? "n/a"}\``);
	lines.push(`- **Cache-Control**: \`${r.headers.cacheControl ?? "n/a"}\``);
	lines.push("");

	if (r.headers.cspHosts.length > 0) {
		lines.push(`### CSP-allowed hosts (${r.headers.cspHosts.length})`);
		lines.push("");
		for (const h of r.headers.cspHosts) lines.push(`- \`${h}\``);
		lines.push("");
	}

	lines.push(`## Frameworks (wappalyzergo)`);
	lines.push("");
	if (r.frameworks.length === 0) {
		lines.push("_No framework detected._");
	} else {
		lines.push(`| Name | Categories | Version |`);
		lines.push(`|---|---|---|`);
		for (const f of r.frameworks) {
			lines.push(
				`| ${f.name} | ${(f.categories ?? []).join(", ") || "n/a"} | ${f.version ?? "n/a"} |`,
			);
		}
	}
	lines.push("");

	const byHost = new Map<string, number>();
	for (const a of r.assets) byHost.set(a.host, (byHost.get(a.host) ?? 0) + 1);
	lines.push(`## Asset hosts (${r.assets.length} total)`);
	lines.push("");
	lines.push(`| Host | Asset count |`);
	lines.push(`|---|---|`);
	for (const [h, c] of [...byHost.entries()].sort((a, b) => b[1] - a[1])) {
		lines.push(`| \`${h}\` | ${c} |`);
	}
	lines.push("");

	const byType = new Map<string, ReconAsset[]>();
	for (const a of r.assets) {
		const arr = byType.get(a.type) ?? [];
		arr.push(a);
		byType.set(a.type, arr);
	}
	for (const t of [
		"stylesheet",
		"script",
		"image",
		"font",
		"iframe",
	] as const) {
		const list = byType.get(t) ?? [];
		if (list.length === 0) continue;
		lines.push(`### ${t} (${list.length})`);
		lines.push("");
		for (const a of list.slice(0, 20)) lines.push(`- ${a.url}`);
		if (list.length > 20) lines.push(`- _... ${list.length - 20} more_`);
		lines.push("");
	}

	lines.push(
		`## CSS selectors (${r.cssSelectors.length} total) — sample top 50`,
	);
	lines.push("");
	lines.push("```css");
	for (const s of r.cssSelectors.slice(0, 50)) lines.push(`${s} {}`);
	if (r.cssSelectors.length > 50) {
		lines.push(
			`/* ... ${r.cssSelectors.length - 50} more (use --snapshot-dir to dump full list) */`,
		);
	}
	lines.push("```");
	lines.push("");

	if (r.screenshotPath) {
		lines.push(`## Screenshot`);
		lines.push("");
		lines.push(
			`PNG ${(r.screenshotBytes ?? 0).toLocaleString()} bytes saved to \`${r.screenshotPath}\``,
		);
		lines.push("");
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage(): void {
	Bun.stdout.write(
		`bxc recon — one-shot URL → docs

Usage:
  bxc recon <url> [options]

Options:
  --profile <name>      static | fast | http | stealth | max  (default: http)
  --output <path>       write to file (default: stdout)
  --snapshot-dir <dir>  also persist HTML, headers.json, css-selectors.txt
  --screenshot          capture PNG (forces profile=fast)
  --plain               line-oriented Markdown without tables
  --help, -h            print this help

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): ReconCliOptions | null {
	const opts: ReconCliOptions = {
		...baseOpts,
		url: "",
		profile: "http",
		screenshot: false,
		plain: Bun.env.NO_COLOR === "1",
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i] as any;
				if (
					v !== "static" &&
					v !== "fast" &&
					v !== "http" &&
					v !== "stealth" &&
					v !== "max"
				) {
					logger.error(`Invalid profile: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--output":
				opts.outputPath = argv[++i];
				break;
			case "--snapshot-dir":
				opts.snapshotDir = argv[++i];
				break;
			case "--screenshot":
				opts.screenshot = true;
				if (
					opts.profile !== "fast" &&
					opts.profile !== "stealth" &&
					opts.profile !== "max"
				) {
					opts.profile = "fast";
				}
				break;
			case "--plain":
				opts.plain = true;
				break;
			case "--help":
			case "-h":
				printUsage();
				return null;
			default:
				if (!opts.url && /^https?:\/\//.test(a)) {
					opts.url = a;
				} else if (a.startsWith("-")) {
					logger.error(`Unknown option: ${a}`);
					return null;
				}
		}
	}

	if (!opts.url) {
		logger.error(`Missing URL argument`);
		printUsage();
		return null;
	}
	return opts;
}

export async function main(
	argv: readonly string[],
	baseOpts: CommonOptions,
): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		process.exit(EXIT.MISUSE);
	}

	if (opts.snapshotDir) {
		await Bun.$`mkdir -p ${opts.snapshotDir}`.quiet();
	}

	let result: ReconResult;
	try {
		result = await recon(opts);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`fetch/extraction failed — ${msg}`);
		await Browser.close().catch(() => {});
		process.exit(EXIT.DATA_ERR);
	}

	if (result.httpStatus >= 400 && !opts.quiet) {
		logger.warn(`target returned HTTP ${result.httpStatus}`);
	}

	let rendered: string;
	try {
		rendered = opts.json
			? JSON.stringify(result, null, 2)
			: opts.plain
				? renderPlain(result)
				: renderMarkdown(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error(`rendering failed — ${msg}`);
		await Browser.close().catch(() => {});
		process.exit(EXIT.SOFTWARE);
	}

	if (opts.outputPath) {
		await Bun.write(opts.outputPath, rendered);
		if (!opts.quiet)
			logger.log(`wrote ${rendered.length} bytes to ${opts.outputPath}`);
	} else {
		Bun.stdout.write(rendered + "\n");
	}

	await Browser.close().catch(() => {});
	process.exit(result.httpStatus >= 400 ? EXIT.DATA_ERR : EXIT.OK);
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
