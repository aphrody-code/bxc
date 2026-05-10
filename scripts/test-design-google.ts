#!/usr/bin/env bun
/**
 * Deep recon: bunlight × https://design.google/
 *
 * Reports for each profile (static / fast / http):
 *   1. HTTP response headers (server, CDN signals, CSP, cache)
 *   2. Backend framework via wappalyzergo (Next.js, Wagtail, GAE...)
 *   3. CDN / hosting fingerprints (Google Frontend, Cloudflare, Akamai, Fastly)
 *   4. All asset URLs grouped by type (JS / CSS / images / fonts / iframes)
 *   5. CSS selectors extracted from inline <style> + linked stylesheets
 *   6. Screenshot via Page.captureScreenshot (profile=fast only)
 *
 * Output:
 *   test/e2e/results/<date>-design-google.md
 *   test/e2e/snapshots/design-google/{static,fast,http}.html
 *   test/e2e/snapshots/design-google/screenshot.png  (if profile=fast supports)
 *   test/e2e/snapshots/design-google/css-selectors.txt
 */

import { Browser } from "../src/api/browser.ts";
import { detectFrameworks } from "../src/detect.ts";
import { resolveLightpandaBin } from "../test/e2e/helpers.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TARGET_URL = process.env.BUNLIGHT_TARGET_URL ?? "https://design.google/";
const HOST_LABEL = new URL(TARGET_URL).hostname.replace(/\./g, "-");
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_PATH = `${import.meta.dir}/../test/e2e/results/${REPORT_DATE}-${HOST_LABEL}.md`;
const SNAPSHOT_DIR = `${import.meta.dir}/../test/e2e/snapshots/${HOST_LABEL}`;
const NAV_TIMEOUT_MS = 30_000;

const PROFILES = ["static", "fast", "http"] as const;
type ProfileName = (typeof PROFILES)[number];

interface Asset {
	type: "stylesheet" | "script" | "image" | "font" | "iframe" | "other";
	url: string;
	host: string;
}

interface HeaderRecon {
	server?: string;
	xPoweredBy?: string;
	cdnRay?: string;
	cdnVendor?: string;
	cspConnects: string[];
	cacheControl?: string;
}

interface ProbeResult {
	profile: ProfileName;
	status: "pass" | "fail";
	httpStatus?: number;
	bytes?: number;
	gotoMs?: number;
	headers: HeaderRecon;
	frameworks: Array<{ name: string; categories?: string[]; version?: string }>;
	assets: Asset[];
	cssSelectors: string[];
	screenshotBytes?: number;
	error?: string;
}

// ---------------------------------------------------------------------------
// Headers + CDN fingerprinting
// ---------------------------------------------------------------------------

function fingerprintCdn(headers: Record<string, string | string[]>): string {
	const get = (k: string): string | undefined => {
		const v = headers[k.toLowerCase()] ?? headers[k];
		return Array.isArray(v) ? v[0] : v;
	};
	const server = get("server")?.toLowerCase() ?? "";
	if (get("cf-ray") || server.includes("cloudflare")) return "Cloudflare";
	if (get("x-amz-cf-id") || get("x-amz-cf-pop")) return "AWS CloudFront";
	if (get("x-served-by") && get("x-cache")) return "Fastly";
	if (server.includes("akamai") || get("x-akamai-edge")) return "Akamai";
	if (server === "google frontend" || server.includes("gws") || server.includes("esf"))
		return "Google Frontend";
	if (server.includes("nginx") && get("x-vercel-id")) return "Vercel";
	if (get("x-vercel-id")) return "Vercel";
	if (server.includes("cloudfront")) return "AWS CloudFront";
	if (server.includes("nginx")) return "nginx (origin or self-hosted)";
	return server || "unknown";
}

async function fetchHeaders(
	url: string,
): Promise<{ headers: Record<string, string>; status: number }> {
	const r = await fetch(url, {
		method: "GET",
		signal: AbortSignal.timeout(20_000),
		redirect: "follow",
		headers: { "User-Agent": "bunlight-recon/1.0 Mozilla/5.0" },
	});
	const headers: Record<string, string> = {};
	r.headers.forEach((v, k) => {
		headers[k.toLowerCase()] = v;
	});
	// Drain body to free socket
	await r.text();
	return { headers, status: r.status };
}

function extractCspConnects(csp: string): string[] {
	const out = new Set<string>();
	for (const directive of csp.split(";")) {
		const trimmed = directive.trim();
		if (
			trimmed.startsWith("connect-src") ||
			trimmed.startsWith("frame-src") ||
			trimmed.startsWith("script-src") ||
			trimmed.startsWith("img-src") ||
			trimmed.startsWith("frame-ancestors")
		) {
			for (const part of trimmed.split(/\s+/).slice(1)) {
				if (part.startsWith("http")) {
					try {
						out.add(new URL(part).hostname);
					} catch {}
				}
			}
		}
	}
	return [...out].sort();
}

function reconHeaders(headers: Record<string, string>): HeaderRecon {
	const recon: HeaderRecon = {
		server: headers["server"],
		xPoweredBy: headers["x-powered-by"],
		cdnRay:
			headers["cf-ray"] ??
			headers["x-amz-cf-id"] ??
			headers["x-served-by"] ??
			headers["x-cloud-trace-context"],
		cdnVendor: fingerprintCdn(headers),
		cspConnects: headers["content-security-policy"]
			? extractCspConnects(headers["content-security-policy"])
			: [],
		cacheControl: headers["cache-control"],
	};
	return recon;
}

// ---------------------------------------------------------------------------
// Asset extraction
// ---------------------------------------------------------------------------

function extractAssets(html: string, base: string): Asset[] {
	const assets: Asset[] = [];
	const baseUrl = new URL(base);

	const resolve = (href: string): string => {
		try {
			return new URL(href, baseUrl).href;
		} catch {
			return href;
		}
	};

	// <link rel="stylesheet" href=...>
	for (const m of html.matchAll(
		/<link[^>]+rel=["']?(?:stylesheet|preload)["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
	)) {
		const url = resolve(m[1]);
		try {
			assets.push({ type: "stylesheet", url, host: new URL(url).hostname });
		} catch {}
	}
	// <script src=...>
	for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
		const url = resolve(m[1]);
		try {
			assets.push({ type: "script", url, host: new URL(url).hostname });
		} catch {}
	}
	// <img src=...>
	for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
		const url = resolve(m[1]);
		try {
			assets.push({ type: "image", url, host: new URL(url).hostname });
		} catch {}
	}
	// <link rel="...font...">
	for (const m of html.matchAll(
		/<link[^>]+(?:as=["']?font["']?|rel=["']?(?:font|preload)["']?)[^>]+href=["']([^"']+)["'][^>]*>/gi,
	)) {
		const url = resolve(m[1]);
		try {
			assets.push({ type: "font", url, host: new URL(url).hostname });
		} catch {}
	}
	// <iframe src=...>
	for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
		const url = resolve(m[1]);
		try {
			assets.push({ type: "iframe", url, host: new URL(url).hostname });
		} catch {}
	}

	return assets;
}

// ---------------------------------------------------------------------------
// CSS selectors extraction
// ---------------------------------------------------------------------------

async function extractCssSelectors(html: string, base: string): Promise<string[]> {
	const allCss: string[] = [];

	// Inline <style>...</style> blocks
	for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
		allCss.push(m[1]);
	}

	// Linked <link rel="stylesheet" href=...> — fetch each one
	const baseUrl = new URL(base);
	const cssUrls = new Set<string>();
	for (const m of html.matchAll(
		/<link[^>]+rel=["']?stylesheet["']?[^>]*href=["']([^"']+)["'][^>]*>/gi,
	)) {
		try {
			cssUrls.add(new URL(m[1], baseUrl).href);
		} catch {}
	}

	// Limit to 5 stylesheets to keep test bounded
	let fetched = 0;
	for (const cssUrl of cssUrls) {
		if (fetched >= 5) break;
		try {
			const r = await fetch(cssUrl, { signal: AbortSignal.timeout(10_000) });
			if (r.ok) {
				allCss.push(await r.text());
				fetched++;
			}
		} catch {}
	}

	// Extract selectors (heuristic: tokens before "{")
	const selectorSet = new Set<string>();
	const combinedCss = allCss.join("\n");
	for (const m of combinedCss.matchAll(/([^{}@]+)\{[^{}]*\}/g)) {
		const sel = m[1].trim().replace(/\s+/g, " ");
		// Skip @-rules, keyframes content, comments
		if (
			!sel ||
			sel.startsWith("@") ||
			sel.startsWith("/*") ||
			sel.length > 200 ||
			/^\d/.test(sel) // skip "0%", "100%" inside keyframes already gone but defensive
		) {
			continue;
		}
		// Split compound selectors "a, b, c" into individual ones
		for (const s of sel.split(",")) {
			const trimmed = s.trim();
			if (trimmed && trimmed.length < 200) selectorSet.add(trimmed);
		}
	}

	return [...selectorSet].sort();
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

let lightpandaBin: string | null = null;

async function probe(profile: ProfileName, baselineHeaders: HeaderRecon): Promise<ProbeResult> {
	const r: ProbeResult = {
		profile,
		status: "fail",
		headers: baselineHeaders,
		frameworks: [],
		assets: [],
		cssSelectors: [],
	};

	const t0 = Bun.nanoseconds();
	let page: Awaited<ReturnType<typeof Browser.newPage>> | undefined;

	try {
		page = await Browser.newPage({
			profile,
			spawnOpts:
				profile === "fast"
					? { logLevel: "error", readyTimeoutMs: 10_000, binaryPath: lightpandaBin ?? undefined }
					: undefined,
		});

		const nav = await Promise.race([
			page.goto(TARGET_URL, { timeoutMs: NAV_TIMEOUT_MS }),
			new Promise<never>((_, rej) =>
				setTimeout(() => rej(new Error("timeout 30s")), NAV_TIMEOUT_MS),
			),
		]);
		r.gotoMs = (Bun.nanoseconds() - t0) / 1e6;

		if (nav && typeof nav === "object" && "status" in nav) {
			r.httpStatus = (nav as { status: number }).status;
		}

		const body = await page.content().catch(() => "");
		r.bytes = body.length;

		if (r.bytes > 1000 && (r.httpStatus === undefined || r.httpStatus < 400)) {
			r.status = "pass";

			// Save snapshot
			await Bun.write(`${SNAPSHOT_DIR}/${profile}.html`, body).catch(() => {});

			// Extract assets, CSS selectors, frameworks (concurrent)
			const [assets, cssSelectors, frameworks] = await Promise.all([
				Promise.resolve(extractAssets(body, TARGET_URL)),
				extractCssSelectors(body, TARGET_URL),
				detectFrameworks({ html: body, headers: {} }).catch(() => []),
			]);
			r.assets = assets;
			r.cssSelectors = cssSelectors;
			r.frameworks = frameworks.map((f) => ({
				name: f.name,
				categories: f.categories,
				version: f.version,
			}));

			// Try screenshot (only fast profile has rendering — static throws CDP -32000)
			if (profile === "fast") {
				try {
					const png = await page.screenshot({ format: "png" });
					await Bun.write(`${SNAPSHOT_DIR}/screenshot-fast.png`, png);
					r.screenshotBytes = png.byteLength;
				} catch (err) {
					r.error = `screenshot failed: ${err instanceof Error ? err.message : String(err)}`;
				}
			}
		} else {
			r.error = r.httpStatus ? `HTTP ${r.httpStatus}` : `body too small ${r.bytes}b`;
		}
	} catch (err) {
		r.gotoMs = (Bun.nanoseconds() - t0) / 1e6;
		r.error = err instanceof Error ? err.message : String(err);
	} finally {
		try {
			await page?.close();
		} catch {}
	}

	return r;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`[recon] Target: ${TARGET_URL}`);
await Bun.$`mkdir -p ${SNAPSHOT_DIR}`.quiet();

// Step 1: capture canonical headers via plain fetch
console.log(`[recon] Fetching baseline headers...`);
const baseline = await fetchHeaders(TARGET_URL);
const baselineRecon = reconHeaders(baseline.headers);
console.log(`[recon] HTTP ${baseline.status}`);
console.log(`[recon] Server: ${baselineRecon.server ?? "n/a"}`);
console.log(`[recon] X-Powered-By: ${baselineRecon.xPoweredBy ?? "n/a"}`);
console.log(`[recon] CDN: ${baselineRecon.cdnVendor}`);
console.log(`[recon] CSP hosts: ${baselineRecon.cspConnects.length}`);
console.log("");

await Bun.write(`${SNAPSHOT_DIR}/headers.json`, JSON.stringify(baseline.headers, null, 2));

lightpandaBin = await resolveLightpandaBin();

const results: ProbeResult[] = [];

for (const profile of PROFILES) {
	console.log(`[recon] Probing with profile=${profile}...`);
	const r = await probe(profile, baselineRecon);
	results.push(r);

	const tag = r.status === "pass" ? "PASS" : "FAIL";
	console.log(
		`  ${tag} HTTP ${r.httpStatus ?? "?"} ${((r.bytes ?? 0) / 1024) | 0}KB ${r.gotoMs?.toFixed(0) ?? "?"}ms - ${r.frameworks.length} frameworks, ${r.assets.length} assets, ${r.cssSelectors.length} CSS selectors${r.screenshotBytes ? `, screenshot ${(r.screenshotBytes / 1024).toFixed(0)}KB` : ""}${r.error ? ` err=${r.error.slice(0, 60)}` : ""}`,
	);

	await Browser.close().catch(() => {});
	await Bun.sleep(500);
}

// Save full CSS selectors list (from static profile, canonical)
const canonical =
	results.find((r) => r.profile === "static" && r.status === "pass") ??
	results.find((r) => r.status === "pass");
if (canonical) {
	await Bun.write(`${SNAPSHOT_DIR}/css-selectors.txt`, canonical.cssSelectors.join("\n"));
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

const lines: string[] = [];
lines.push(`# Recon report — ${TARGET_URL}`);
lines.push("");
lines.push(`Date: ${REPORT_DATE}`);
lines.push("");

// HTTP / CDN section
lines.push("## HTTP response headers");
lines.push("");
lines.push(`- **HTTP status**: ${baseline.status}`);
lines.push(`- **Server**: \`${baselineRecon.server ?? "n/a"}\``);
lines.push(`- **X-Powered-By**: \`${baselineRecon.xPoweredBy ?? "n/a"}\``);
lines.push(`- **CDN fingerprint**: ${baselineRecon.cdnVendor}`);
lines.push(`- **Trace/Ray ID header**: \`${baselineRecon.cdnRay ?? "n/a"}\``);
lines.push(`- **Cache-Control**: \`${baselineRecon.cacheControl ?? "n/a"}\``);
lines.push("");

if (baselineRecon.cspConnects.length > 0) {
	lines.push(`### CSP-allowed hosts (${baselineRecon.cspConnects.length})`);
	lines.push("");
	for (const host of baselineRecon.cspConnects) {
		lines.push(`- \`${host}\``);
	}
	lines.push("");
}

// Frameworks via wappalyzer
const frameworks = results.find((r) => r.frameworks.length > 0)?.frameworks ?? [];
lines.push(`## Detected frameworks (wappalyzergo)`);
lines.push("");
if (frameworks.length === 0) {
	lines.push("_No framework detected — wappalyzergo binary may be unavailable._");
} else {
	lines.push(`| Name | Categories | Version |`);
	lines.push(`|---|---|---|`);
	for (const f of frameworks) {
		lines.push(`| ${f.name} | ${(f.categories ?? []).join(", ")} | ${f.version ?? "n/a"} |`);
	}
}
lines.push("");

// Per-profile result summary
lines.push("## Per-profile recon");
lines.push("");
lines.push("| Profile | Status | HTTP | Bytes | goto ms | Assets | CSS selectors | Screenshot |");
lines.push("|---|---|---|---|---|---|---|---|");
for (const r of results) {
	const screenTag = r.screenshotBytes
		? `${(r.screenshotBytes / 1024).toFixed(0)} KB`
		: r.profile === "fast"
			? "failed"
			: "n/a (no rendering)";
	lines.push(
		`| ${r.profile} | ${r.status} | ${r.httpStatus ?? "?"} | ${((r.bytes ?? 0) / 1024) | 0} KB | ${r.gotoMs?.toFixed(0) ?? "?"} | ${r.assets.length} | ${r.cssSelectors.length} | ${screenTag} |`,
	);
}
lines.push("");

// Asset hosts
const allAssets = canonical?.assets ?? [];
const assetsByType = new Map<string, Asset[]>();
for (const a of allAssets) {
	const arr = assetsByType.get(a.type) ?? [];
	arr.push(a);
	assetsByType.set(a.type, arr);
}

lines.push("## Asset hosts (canonical profile)");
lines.push("");
const hostCount = new Map<string, number>();
for (const a of allAssets) {
	hostCount.set(a.host, (hostCount.get(a.host) ?? 0) + 1);
}
const topHosts = [...hostCount.entries()].sort((a, b) => b[1] - a[1]);
lines.push("| Host | Asset count |");
lines.push("|---|---|");
for (const [h, c] of topHosts) {
	lines.push(`| \`${h}\` | ${c} |`);
}
lines.push("");

// Asset list per type (top 10 each)
for (const type of ["stylesheet", "script", "image", "font", "iframe"] as const) {
	const list = assetsByType.get(type) ?? [];
	if (list.length === 0) continue;
	lines.push(`### ${type} (${list.length})`);
	lines.push("");
	for (const a of list.slice(0, 15)) {
		lines.push(`- ${a.url}`);
	}
	if (list.length > 15) {
		lines.push(`- _... ${list.length - 15} more_`);
	}
	lines.push("");
}

// CSS selectors top 50
const css = canonical?.cssSelectors ?? [];
lines.push(`## CSS selectors (${css.length} total) — sample top 50`);
lines.push("");
lines.push("```css");
for (const s of css.slice(0, 50)) {
	lines.push(s + " {}");
}
if (css.length > 50) lines.push(`/* ... ${css.length - 50} more selectors in css-selectors.txt */`);
lines.push("```");
lines.push("");

// Files written
lines.push("## Artifacts written");
lines.push("");
const artifacts = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: SNAPSHOT_DIR }));
for (const a of artifacts.sort()) {
	lines.push(`- \`test/e2e/snapshots/${HOST_LABEL}/${a}\``);
}

await Bun.write(REPORT_PATH, lines.join("\n"));

console.log(`\nReport: ${REPORT_PATH}`);
console.log(`Snapshots: ${SNAPSHOT_DIR}/`);
console.log(`Total assets discovered: ${allAssets.length}`);
console.log(`Total CSS selectors: ${css.length}`);
