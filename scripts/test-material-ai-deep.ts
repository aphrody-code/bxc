#!/usr/bin/env bun
/**
 * Deep test: bunlight × Material 3 design system documentation.
 *
 * Improvements over test-material-ai.ts:
 *   1. Crawls sitemap.xml (356 URLs available) and samples 50 representative URLs
 *      across foundations / styles / components.
 *   2. Extracts design tokens from each page:
 *        - colors (#RRGGBB hex)
 *        - md.sys.* token names (md.sys.color.primary, md.sys.typescale.*)
 *        - typography (Roboto Flex / Symbols)
 *        - shape corner radius
 *   3. Computes inter-profile divergence (bytes + token count delta).
 *   4. Persists HTML snapshots in test/e2e/snapshots/material-3/<slug>.html
 *      for regression diffing.
 *   5. Enriched Markdown report with per-category stats.
 *
 * Usage:
 *   bun run scripts/test-material-ai-deep.ts
 *   BUNLIGHT_M3_SAMPLE=20 bun run scripts/test-material-ai-deep.ts   # smaller sample
 *   BUNLIGHT_M3_PROFILES=http bun run scripts/test-material-ai-deep.ts  # only http
 */

import { Browser } from "../src/api/browser.ts";
import { resolveLightpandaBin } from "../test/e2e/helpers.ts";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SITEMAP_URL = "https://m3.material.io/sitemap.xml";
const SAMPLE_SIZE = parseInt(process.env.BUNLIGHT_M3_SAMPLE ?? "50", 10);
const PROFILES_ENV = (process.env.BUNLIGHT_M3_PROFILES ?? "static,fast,http")
	.split(",")
	.filter(Boolean) as readonly ProfileName[];
const THROTTLE_MS = 600;
const NAV_TIMEOUT_MS = 25_000;

const SNAPSHOT_DIR = `${import.meta.dir}/../test/e2e/snapshots/material-3`;
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_PATH = `${import.meta.dir}/../test/e2e/results/${REPORT_DATE}-material-ai-deep.md`;

type ProfileName = "static" | "fast" | "http";

interface UrlEntry {
	url: string;
	bucket: string;
	slug: string;
}

interface TokenExtraction {
	hexColors: string[];
	mdSysTokens: string[];
	typography: string[];
	shapeRadius: string[];
}

interface ProbeResult {
	url: string;
	bucket: string;
	slug: string;
	profile: ProfileName;
	status: "pass" | "fail";
	httpStatus?: number;
	bytes?: number;
	gotoMs?: number;
	tokens?: TokenExtraction;
	error?: string;
}

// ---------------------------------------------------------------------------
// Sitemap fetch + sampling
// ---------------------------------------------------------------------------

async function fetchSitemap(): Promise<UrlEntry[]> {
	const r = await fetch(SITEMAP_URL, {
		signal: AbortSignal.timeout(15_000),
		headers: { "User-Agent": "bunlight-deep-test/1.0" },
	});
	if (!r.ok) throw new Error(`sitemap fetch failed: ${r.status}`);
	const xml = await r.text();
	const urls: UrlEntry[] = [];
	for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
		const url = m[1];
		const path = new URL(url).pathname;
		const segments = path.split("/").filter(Boolean);
		const bucket = segments.length >= 2 ? `${segments[0]}/${segments[1]}` : (segments[0] ?? "root");
		const slug = segments.join("-") || "index";
		urls.push({ url, bucket, slug });
	}
	return urls;
}

/**
 * Sample N URLs covering all major buckets.
 * Skips blog (too noisy) and dedups by bucket prefix.
 */
function sampleUrls(all: UrlEntry[], n: number): UrlEntry[] {
	const filtered = all.filter((u) => !u.bucket.startsWith("blog/") && !u.url.includes("/blog/"));
	const byBucket = new Map<string, UrlEntry[]>();
	for (const u of filtered) {
		const arr = byBucket.get(u.bucket) ?? [];
		arr.push(u);
		byBucket.set(u.bucket, arr);
	}

	// Sample evenly across buckets
	const buckets = [...byBucket.keys()].sort();
	const perBucket = Math.max(1, Math.floor(n / buckets.length));
	const sample: UrlEntry[] = [];

	for (const b of buckets) {
		const list = byBucket.get(b) ?? [];
		// Pick first N from each bucket (sorted = deterministic)
		const chunk = list.slice(0, perBucket);
		sample.push(...chunk);
		if (sample.length >= n) break;
	}

	return sample.slice(0, n);
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

function extractTokens(body: string): TokenExtraction {
	const hexColors = [...new Set(body.match(/#[0-9A-Fa-f]{6}\b/g) ?? [])];
	const mdSysTokens = [...new Set(body.match(/md\.(?:sys|ref|comp)\.[a-z0-9.\-]+/gi) ?? [])];
	const typography = [
		...new Set(
			(body.match(/Roboto(?:\s+Flex)?|Material\s+Symbols(?:\s+\w+)?/gi) ?? []).map((t) =>
				t.toLowerCase(),
			),
		),
	];
	const shapeRadius = [
		...new Set(body.match(/\b\d+\s*(?:dp|px|rem)\s*(?:radius|corner)?\b/gi) ?? []),
	].slice(0, 20);
	return { hexColors, mdSysTokens, typography, shapeRadius };
}

// ---------------------------------------------------------------------------
// Probe
// ---------------------------------------------------------------------------

let lightpandaBin: string | null = null;

async function probe(
	profile: ProfileName,
	entry: UrlEntry,
	saveSnapshot: boolean,
): Promise<ProbeResult> {
	const r: ProbeResult = {
		url: entry.url,
		bucket: entry.bucket,
		slug: entry.slug,
		profile,
		status: "fail",
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
			page.goto(entry.url, { timeoutMs: NAV_TIMEOUT_MS }),
			new Promise<never>((_, rej) =>
				setTimeout(() => rej(new Error("timeout 25s")), NAV_TIMEOUT_MS),
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
			r.tokens = extractTokens(body);

			// Save snapshot only for the static profile (canonical reference)
			if (saveSnapshot && profile === "static") {
				const snapPath = `${SNAPSHOT_DIR}/${entry.slug}.html`;
				await Bun.write(snapPath, body).catch(() => {});
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

console.log(`[deep] Fetching sitemap from ${SITEMAP_URL}...`);
const all = await fetchSitemap();
console.log(`[deep] ${all.length} URLs in sitemap`);

const sample = sampleUrls(all, SAMPLE_SIZE);
console.log(
	`[deep] Sampled ${sample.length} URLs across ${new Set(sample.map((s) => s.bucket)).size} buckets`,
);
console.log(`[deep] Profiles: ${PROFILES_ENV.join(", ")}`);
console.log(`[deep] Total probes: ${sample.length * PROFILES_ENV.length}`);
console.log("");

await Bun.$`mkdir -p ${SNAPSHOT_DIR}`.quiet();

lightpandaBin = await resolveLightpandaBin();

const results: ProbeResult[] = [];
let probeCount = 0;
const totalProbes = sample.length * PROFILES_ENV.length;

for (const profile of PROFILES_ENV) {
	console.log(`=== profile=${profile} ===`);
	for (const entry of sample) {
		probeCount++;
		const r = await probe(profile, entry, true);
		results.push(r);

		const tag = r.status === "pass" ? "PASS" : "FAIL";
		const tokenCount = r.tokens
			? `colors=${r.tokens.hexColors.length} tokens=${r.tokens.mdSysTokens.length}`
			: "";
		const bytesTag = r.bytes ? ` ${(r.bytes / 1024).toFixed(0)}KB` : "";
		const msTag = r.gotoMs ? ` ${r.gotoMs.toFixed(0)}ms` : "";
		const errTag = r.error ? ` err=${r.error.slice(0, 40)}` : "";
		console.log(
			`  [${probeCount}/${totalProbes}] ${tag} ${entry.bucket.padEnd(22)} ${entry.slug.slice(0, 35).padEnd(35)}${msTag}${bytesTag} ${tokenCount}${errTag}`,
		);

		await Browser.close().catch(() => {});
		await Bun.sleep(THROTTLE_MS);
	}
	console.log("");
}

await Browser.close().catch(() => {});

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

const lines: string[] = [];
lines.push(`# bunlight × Material 3 deep crawl report`);
lines.push("");
lines.push(`Date: ${REPORT_DATE}`);
lines.push(`Sitemap: ${SITEMAP_URL} (${all.length} URLs total)`);
lines.push(
	`Sample: ${sample.length} URLs across ${new Set(sample.map((s) => s.bucket)).size} buckets`,
);
lines.push(`Profiles: ${PROFILES_ENV.join(", ")}`);
lines.push(`Total probes: ${results.length}`);
lines.push("");

// Per-profile summary
lines.push("## Per-profile summary");
lines.push("");
lines.push(
	"| Profile | Pass | Fail | Pass rate | Avg goto | Avg bytes | Avg colors | Avg md.sys.* |",
);
lines.push("|---|---|---|---|---|---|---|---|");
for (const p of PROFILES_ENV) {
	const ofProf = results.filter((r) => r.profile === p);
	const pass = ofProf.filter((r) => r.status === "pass").length;
	const fail = ofProf.length - pass;
	const rate = ofProf.length > 0 ? ((pass / ofProf.length) * 100).toFixed(0) : "n/a";
	const goto = ofProf.filter((r) => r.gotoMs);
	const avgGoto =
		goto.length > 0
			? (goto.reduce((s, r) => s + (r.gotoMs ?? 0), 0) / goto.length).toFixed(0)
			: "—";
	const okOnly = ofProf.filter((r) => r.status === "pass");
	const avgBytes =
		okOnly.length > 0
			? Math.round(okOnly.reduce((s, r) => s + (r.bytes ?? 0), 0) / okOnly.length / 1024)
			: 0;
	const avgColors =
		okOnly.length > 0
			? Math.round(
					okOnly.reduce((s, r) => s + (r.tokens?.hexColors.length ?? 0), 0) / okOnly.length,
				)
			: 0;
	const avgTokens =
		okOnly.length > 0
			? Math.round(
					okOnly.reduce((s, r) => s + (r.tokens?.mdSysTokens.length ?? 0), 0) / okOnly.length,
				)
			: 0;
	lines.push(
		`| ${p} | ${pass} | ${fail} | ${rate}% | ${avgGoto} ms | ${avgBytes} KB | ${avgColors} | ${avgTokens} |`,
	);
}
lines.push("");

// Per-bucket summary
lines.push("## Per-bucket summary (pass rate per profile)");
lines.push("");
const buckets = [...new Set(results.map((r) => r.bucket))].sort();
lines.push(`| Bucket | URLs | ${PROFILES_ENV.join(" | ")} |`);
lines.push(`|---|---|${"---|".repeat(PROFILES_ENV.length)}`);
for (const b of buckets) {
	const inBucket = sample.filter((s) => s.bucket === b).length;
	const cells: string[] = [];
	for (const p of PROFILES_ENV) {
		const r = results.filter((x) => x.bucket === b && x.profile === p);
		const pass = r.filter((x) => x.status === "pass").length;
		const total = r.length;
		cells.push(total > 0 ? `${pass}/${total}` : "—");
	}
	lines.push(`| ${b} | ${inBucket} | ${cells.join(" | ")} |`);
}
lines.push("");

// Inter-profile divergence (rendered bytes diff per URL)
lines.push("## Inter-profile divergence");
lines.push("");
lines.push(
	"Detects pages where `fast` (Lightpanda) returns significantly less HTML than `static`/`http` — a signal that JS-driven content is missing.",
);
lines.push("");
lines.push("| URL | static KB | fast KB | http KB | fast/static ratio |");
lines.push("|---|---|---|---|---|");

for (const entry of sample) {
	const byProf: Record<string, number | undefined> = {};
	for (const p of PROFILES_ENV) {
		const r = results.find((x) => x.url === entry.url && x.profile === p);
		byProf[p] = r?.status === "pass" ? r.bytes : undefined;
	}
	const sKb = byProf["static"] !== undefined ? Math.round(byProf["static"] / 1024) : 0;
	const fKb = byProf["fast"] !== undefined ? Math.round(byProf["fast"] / 1024) : 0;
	const hKb = byProf["http"] !== undefined ? Math.round(byProf["http"] / 1024) : 0;
	if (sKb === 0 && fKb === 0 && hKb === 0) continue;
	const ratio = sKb > 0 && fKb > 0 ? (fKb / sKb).toFixed(2) : "—";
	const flag = sKb > 0 && fKb > 0 && fKb / sKb < 0.5 ? " (DIVERGENT)" : "";
	lines.push(`| ${entry.slug} | ${sKb} | ${fKb} | ${hKb} | ${ratio}${flag} |`);
}
lines.push("");

// Top design tokens (aggregated across all pages)
lines.push("## Top design tokens (aggregated, static profile)");
lines.push("");
const tokenCount = new Map<string, number>();
for (const r of results) {
	if (r.profile !== "static" || r.status !== "pass") continue;
	for (const t of r.tokens?.mdSysTokens ?? []) {
		tokenCount.set(t, (tokenCount.get(t) ?? 0) + 1);
	}
}
const topTokens = [...tokenCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
lines.push("| Token | Pages mentioning |");
lines.push("|---|---|");
for (const [token, count] of topTokens) {
	lines.push(`| \`${token}\` | ${count} |`);
}
lines.push("");

// Top hex colors
lines.push("## Top colors (hex, aggregated)");
lines.push("");
const colorCount = new Map<string, number>();
for (const r of results) {
	if (r.profile !== "static" || r.status !== "pass") continue;
	for (const c of r.tokens?.hexColors ?? []) {
		const norm = c.toLowerCase();
		colorCount.set(norm, (colorCount.get(norm) ?? 0) + 1);
	}
}
const topColors = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
lines.push("| Color | Pages |");
lines.push("|---|---|");
for (const [c, n] of topColors) {
	lines.push(`| \`${c}\` | ${n} |`);
}
lines.push("");

// Failures
const failures = results.filter((r) => r.status === "fail");
if (failures.length > 0) {
	lines.push("## Failures");
	lines.push("");
	lines.push("| Profile | URL | Error |");
	lines.push("|---|---|---|");
	for (const r of failures.slice(0, 50)) {
		lines.push(`| ${r.profile} | ${r.url} | ${(r.error ?? "?").slice(0, 70)} |`);
	}
	lines.push("");
}

// Snapshots saved
const snapshotPaths = await Array.fromAsync(new Bun.Glob("*.html").scan({ cwd: SNAPSHOT_DIR }));
lines.push(`## Snapshots`);
lines.push("");
lines.push(
	`${snapshotPaths.length} HTML snapshots saved to \`test/e2e/snapshots/material-3/\` (static profile, canonical reference for regression diff).`,
);
lines.push("");

await Bun.write(REPORT_PATH, lines.join("\n"));

const totalPass = results.filter((r) => r.status === "pass").length;
const totalFail = results.filter((r) => r.status === "fail").length;
console.log(`Report: ${REPORT_PATH}`);
console.log(`Total: ${totalPass}/${results.length} pass, ${totalFail} fail`);
console.log(`Snapshots: ${snapshotPaths.length} files`);
