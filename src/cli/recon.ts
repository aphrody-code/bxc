#!/usr/bin/env bun
/**
 * `bunlight recon <url>` — one-shot URL → docs.
 *
 * Probes a target URL and produces a Markdown reconnaissance report covering:
 *   - HTTP response headers (server / X-Powered-By / cache / CSP)
 *   - CDN fingerprint (Google Frontend / Cloudflare / Fastly / CloudFront / Akamai / Vercel / nginx)
 *   - Backend frameworks via wappalyzergo (Next.js, Wagtail, Django, Rails, ...)
 *   - All asset URLs grouped by type (stylesheet / script / image / font / iframe)
 *   - CSS selectors extracted from inline <style> + linked stylesheets
 *   - PNG screenshot when --screenshot is passed (uses fast profile)
 *
 * Usage:
 *   bunlight recon <url>
 *   bunlight recon <url> --profile fast
 *   bunlight recon <url> --output report.md --snapshot-dir ./snapshot
 *   bunlight recon <url> --screenshot
 *   bunlight recon <url> --json                    (emit JSON instead of Markdown)
 *
 * Exit codes:
 *   0 success
 *   1 navigation/extraction failed
 *   2 invalid CLI arguments
 */

import { Browser, type Page } from "../api/browser.ts";
import { detectFrameworks } from "../detect.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReconProfile = "static" | "fast" | "http";

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

/**
 * Stable JSON output schema. Agents should branch on this — when we change
 * field semantics, we bump the version (`bunlight-recon-v2`) and keep v1
 * available behind a flag.
 */
export const RECON_SCHEMA = "bunlight-recon-v1";

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

interface ReconCliOptions {
	url: string;
	profile: ReconProfile;
	outputPath?: string;
	snapshotDir?: string;
	screenshot: boolean;
	emitJson: boolean;
	timeoutMs: number;
	quiet: boolean;
	plain: boolean;
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
	timeoutMs: number,
): Promise<{
	headers: Record<string, string>;
	status: number;
	finalUrl: string;
	body: string;
}> {
	const r = await fetch(url, {
		method: "GET",
		signal: AbortSignal.timeout(timeoutMs),
		redirect: "follow",
		headers: {
			"User-Agent":
				"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		},
	});
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

	// <link rel="stylesheet"|"preload" ...>
	for (const m of html.matchAll(
		/<link[^>]+rel=["']?(?:stylesheet|preload)["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
	)) {
		push("stylesheet", m[1]);
	}
	// <script src=...>
	for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
		push("script", m[1]);
	}
	// <img src=...>
	for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
		push("image", m[1]);
	}
	// <link as="font"> + <link rel="font">
	for (const m of html.matchAll(
		/<link[^>]+(?:as=["']?font["']?|rel=["']?font["']?)[^>]+href=["']([^"']+)["'][^>]*>/gi,
	)) {
		push("font", m[1]);
	}
	// <iframe src=...>
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
	maxStylesheets = 5,
	timeoutMs = 10_000,
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
			const r = await fetch(cssUrl, { signal: AbortSignal.timeout(timeoutMs) });
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
	// Fast path: a single fetch() returns headers + body in one round-trip.
	// Bun's native HTTP client is HTTP/2-capable and respects Accept-Encoding,
	// so this is ~250ms cold vs ~30s for Browser.newPage().
	const t0 = Bun.nanoseconds();
	const fetched = await fetchFull(opts.url, opts.timeoutMs);
	const headers = reconHeaders(fetched.headers);
	let body = fetched.body;
	let finalUrl = fetched.finalUrl;
	let gotoMs = (Bun.nanoseconds() - t0) / 1e6;
	let screenshotBytes: number | undefined;
	let screenshotPath: string | undefined;

	// Browser stack only when we need rendering (screenshot, JS-heavy pages).
	// Default profile=http stays in fast path.
	const needsBrowser = opts.screenshot || opts.profile === "fast" || opts.profile === "static";
	let browserError: string | null = null;
	if (needsBrowser) {
		let page: Page | undefined;
		const t1 = Bun.nanoseconds();
		try {
			page = (await Browser.newPage({
				profile: opts.profile,
				spawnOpts:
					opts.profile === "fast" ? { logLevel: "error", readyTimeoutMs: 10_000 } : undefined,
			})) as Page;

			await Promise.race([
				page.goto(opts.url, { timeoutMs: opts.timeoutMs }),
				new Promise<never>((_, rej) =>
					setTimeout(() => rej(new Error("navigation timeout")), opts.timeoutMs),
				),
			]);
			gotoMs = (Bun.nanoseconds() - t1) / 1e6;
			finalUrl = page.url();
			const rendered = await page.content().catch(() => "");
			if (rendered) body = rendered;

			if (opts.screenshot && opts.profile === "fast" && opts.snapshotDir) {
				try {
					const png = await page.screenshot({ format: "png" });
					screenshotPath = `${opts.snapshotDir}/screenshot.png`;
					await Bun.write(screenshotPath, png);
					screenshotBytes = png.byteLength;
				} catch {
					// screenshot failed — continue without
				}
			}
		} catch (err) {
			browserError = err instanceof Error ? err.message : String(err);
			// Graceful fallback: continue with the body we already fetched.
			// The recon doc will lack the rendered DOM (and screenshot), but the
			// HTTP/CDN/asset/CSS analysis is intact.
		} finally {
			try {
				await page?.close();
			} catch {
				// ignore close errors
			}
		}
	}

	// Surface browser failures in stderr for debugging without breaking the doc.
	// Suppressed by --quiet so machine pipelines stay clean.
	if (browserError && !opts.quiet) {
		process.stderr.write(
			`bunlight recon: browser path failed (${browserError.slice(0, 120)}); falling back to fetch-only.\n`,
		);
	}

	// Step 3: extraction (assets / selectors / frameworks) in parallel
	const [assets, cssSelectors, frameworks] = await Promise.all([
		Promise.resolve(extractAssets(body, opts.url)),
		extractCssSelectors(body, opts.url),
		detectFrameworks({ html: body, headers: {} }).catch(() => []),
	]);

	// Optionally persist HTML snapshot
	if (opts.snapshotDir) {
		await Bun.write(`${opts.snapshotDir}/${opts.profile}.html`, body).catch(() => {});
		await Bun.write(
			`${opts.snapshotDir}/headers.json`,
			JSON.stringify(fetched.headers, null, 2),
		).catch(() => {});
		await Bun.write(`${opts.snapshotDir}/css-selectors.txt`, cssSelectors.join("\n")).catch(
			() => {},
		);
	}

	return {
		$schema: RECON_SCHEMA,
		url: opts.url,
		finalUrl,
		httpStatus: fetched.status,
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
// Markdown rendering
// ---------------------------------------------------------------------------

/**
 * Plain text rendering — line-oriented, grep/awk friendly, no Markdown tables.
 * Each line is `key: value` or `bullet`-prefixed lists. Stable across versions
 * for shell pipelines.
 */
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
	if (r.screenshotPath) lines.push(`screenshot: ${r.screenshotPath} ${r.screenshotBytes ?? 0}b`);
	return lines.join("\n");
}

export function renderMarkdown(r: ReconResult): string {
	const lines: string[] = [];
	lines.push(`# Recon report — ${r.url}`);
	lines.push("");
	lines.push(`Date: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`);
	if (r.url !== r.finalUrl) {
		lines.push(`Final URL: ${r.finalUrl}`);
	}
	lines.push(`Profile used: \`${r.profile}\``);
	lines.push("");

	// HTTP / CDN
	lines.push(`## HTTP & CDN`);
	lines.push("");
	lines.push(`- **HTTP status**: ${r.httpStatus}`);
	lines.push(`- **Body bytes**: ${r.bytes} (${(r.bytes / 1024).toFixed(0)} KB)`);
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

	// Frameworks
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

	// Assets
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
	for (const t of ["stylesheet", "script", "image", "font", "iframe"] as const) {
		const list = byType.get(t) ?? [];
		if (list.length === 0) continue;
		lines.push(`### ${t} (${list.length})`);
		lines.push("");
		for (const a of list.slice(0, 20)) lines.push(`- ${a.url}`);
		if (list.length > 20) lines.push(`- _... ${list.length - 20} more_`);
		lines.push("");
	}

	// CSS selectors
	lines.push(`## CSS selectors (${r.cssSelectors.length} total) — sample top 50`);
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

	// Screenshot
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
// CLI parsing
// ---------------------------------------------------------------------------

function printUsage(): void {
	process.stdout.write(
		`bunlight recon — one-shot URL → docs (schema ${RECON_SCHEMA})

Usage:
  bunlight recon <url> [options]

Options:
  --profile <name>      static | fast | http  (default: http)
  --output <path>       write to file (default: stdout)
  --snapshot-dir <dir>  also persist HTML, headers.json, css-selectors.txt
  --screenshot          capture PNG (forces profile=fast)
  --json                emit JSON instead of Markdown (machine-readable)
  --plain               line-oriented Markdown without tables (grep/awk-friendly)
  --quiet               suppress stderr progress and warnings
  --timeout <ms>        navigation timeout in ms (default: 30000)
  --help, -h            print this help

Exit codes (UNIX sysexits-friendly):
  0   success
  2   misuse (invalid CLI args)
  65  data error (fetch returned non-2xx)
  70  software error (extraction or rendering failed)
  130 SIGINT (user cancelled)

Output contract:
  - stdout = data (Markdown or JSON, depending on flags)
  - stderr = progress / warnings / errors
  - JSON output starts with {"$schema":"${RECON_SCHEMA}"}
  - NO_COLOR=1 honored (plain ASCII output regardless)

Examples:
  bunlight recon https://design.google
  bunlight recon https://nextjs.org --profile fast --screenshot --snapshot-dir ./report
  bunlight recon https://m3.material.io --json > m3.json
  bunlight recon https://m3.material.io --plain --quiet | grep -i framework
`,
	);
}

function parseArgs(argv: readonly string[]): ReconCliOptions | null {
	const opts: ReconCliOptions = {
		url: "",
		profile: "http",
		screenshot: false,
		emitJson: false,
		timeoutMs: 30_000,
		quiet: process.env.BUNLIGHT_QUIET === "1",
		plain: process.env.NO_COLOR === "1",
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i];
				if (v !== "static" && v !== "fast" && v !== "http") {
					process.stderr.write(`Invalid profile: ${v} (expected static|fast|http)\n`);
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
				opts.profile = "fast"; // screenshot requires rendering engine
				break;
			case "--json":
				opts.emitJson = true;
				break;
			case "--plain":
				opts.plain = true;
				break;
			case "--quiet":
			case "-q":
				opts.quiet = true;
				break;
			case "--timeout":
				opts.timeoutMs = parseInt(argv[++i], 10);
				break;
			case "--help":
			case "-h":
				printUsage();
				return null;
			default:
				if (!opts.url && /^https?:\/\//.test(a)) {
					opts.url = a;
				} else if (a.startsWith("-")) {
					process.stderr.write(`Unknown option: ${a}\n`);
					return null;
				}
		}
	}

	if (!opts.url) {
		process.stderr.write(`Missing URL argument\n`);
		printUsage();
		return null;
	}
	return opts;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Exit codes follow the BSD `sysexits.h` convention so AI agents can branch
 * on `$?` without parsing stderr. Document changes in --help output too.
 */
const EXIT = {
	OK: 0,
	USAGE: 2,
	DATA_ERR: 65,
	SOFTWARE: 70,
	SIGINT: 130,
} as const;

function logProgress(opts: ReconCliOptions, msg: string): void {
	if (!opts.quiet) {
		process.stderr.write(`bunlight recon: ${msg}\n`);
	}
}

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		process.exit(EXIT.USAGE);
	}

	if (opts.snapshotDir) {
		await Bun.$`mkdir -p ${opts.snapshotDir}`.quiet();
	}

	let result: ReconResult;
	try {
		result = await recon(opts);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`bunlight recon: fetch/extraction failed — ${msg}\n`);
		await Browser.close().catch(() => {});
		process.exit(EXIT.DATA_ERR);
	}

	if (result.httpStatus >= 400) {
		logProgress(opts, `target returned HTTP ${result.httpStatus}`);
	}

	let rendered: string;
	try {
		rendered = opts.emitJson
			? JSON.stringify(result, null, 2)
			: opts.plain
				? renderPlain(result)
				: renderMarkdown(result);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`bunlight recon: rendering failed — ${msg}\n`);
		await Browser.close().catch(() => {});
		process.exit(EXIT.SOFTWARE);
	}

	if (opts.outputPath) {
		await Bun.write(opts.outputPath, rendered);
		logProgress(opts, `wrote ${rendered.length} bytes to ${opts.outputPath}`);
	} else {
		process.stdout.write(rendered + "\n");
	}

	await Browser.close().catch(() => {});
	process.exit(result.httpStatus >= 400 ? EXIT.DATA_ERR : EXIT.OK);
}

// ---------------------------------------------------------------------------
// Entry point when run directly
// ---------------------------------------------------------------------------

if (import.meta.main) {
	await main(process.argv.slice(2));
}
