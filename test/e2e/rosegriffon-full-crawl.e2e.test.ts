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
 * E2E full-crawl suite — gemini.google.com
 *
 * Walks every URL discovered for the origin and exercises each of the five
 * Bunlight profiles (static, fast, http, stealth, max) against it. The
 * `fast` profile (Lightpanda) is the primary acceptance target with a
 * required >= 95% pass rate.
 *
 * Strategy:
 *   - Pages are discovered via `discoverPages()` (sitemap.xml > BFS fallback,
 *     robots-aware, sample-down to 30).
 *   - The static, fast and http profiles are exercised through the public
 *     Bunlight API (`Browser.newPage`) — same path used by `bunlight serve`.
 *     We cycle one Page per URL to mimic how a crawl-pool would.
 *   - The stealth and max profiles need Chromium / Camoufox binaries; if those
 *     are not installed every test in the profile is logged as SKIP with the
 *     reason and excluded from the pass-rate computation.
 *   - Per-profile metrics (pass / fail / avg goto / peak RSS) are aggregated
 *     into a Markdown report at `test/e2e/results/<date>-rosegriffon.md`.
 *
 * Run:
 *   bun test test/e2e/rosegriffon-full-crawl.e2e.test.ts
 *
 * The whole suite is wall-clock heavy (~5-10 minutes online); each test
 * carries a 60 s timeout and the discovery step is cached on disk.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { Browser, type Page } from "../../src/api/browser.ts";
import { type DiscoverResult, discoverPages } from "./discover-pages.ts";
import {
	checkProfile,
	type ProfileName,
	type ProfileSummary,
	resolveLightpandaBin,
	type SiteResult,
	writeReport,
} from "./helpers.ts";

const ORIGIN = "https://www.gemini.google.com";
const REPORT_DATE = new Date().toISOString().slice(0, 10);
const REPORT_PATH = `${import.meta.dir}/results/${REPORT_DATE}-rosegriffon.md`;
const PER_TEST_TIMEOUT_MS = 60_000;
const NAV_TIMEOUT_MS = 25_000;

const PROFILES: readonly ProfileName[] = ["static", "fast", "http", "stealth", "max"];

let discovery: DiscoverResult;
let online = true;
let lightpandaBin: string | null = null;

const allResults: SiteResult[] = [];
const summary: Record<ProfileName, ProfileSummary> = {
	static: emptySummary(),
	fast: emptySummary(),
	http: emptySummary(),
	stealth: emptySummary(),
	max: emptySummary(),
};

function emptySummary(): ProfileSummary {
	return { pass: 0, fail: 0, skip: 0, totalGotoMs: 0, peakRssMb: 0, gotoCount: 0 };
}

async function isOnline(): Promise<boolean> {
	try {
		const r = await fetch("https://www.gemini.google.com/sitemap.xml", {
			method: "HEAD",
			signal: AbortSignal.timeout(4000),
		});
		return r.ok;
	} catch {
		return false;
	}
}

beforeAll(async () => {
	online = await isOnline();
	if (!online) {
		console.log("[rosegriffon] SKIP: gemini.google.com unreachable, running cache-only mode");
	}
	lightpandaBin = await resolveLightpandaBin();
	discovery = await discoverPages(ORIGIN, {
		maxPages: 30,
		cacheOnly: !online,
	}).catch((err: unknown) => {
		online = false;
		console.log(
			`[rosegriffon] discovery failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		return {
			origin: ORIGIN,
			urls: [],
			source: "cache",
			robotsAllowed: 0,
			robotsDisallowed: 0,
			cacheFile: "",
		};
	});
	console.log(
		`[rosegriffon] ${discovery.urls.length} pages discovered (source=${discovery.source})`,
	);
});

afterAll(async () => {
	try {
		await Browser.close();
	} catch {
		// best effort
	}
	if (allResults.length > 0) {
		await writeReport(REPORT_PATH, {
			origin: ORIGIN,
			date: REPORT_DATE,
			discoveredCount: discovery?.urls.length ?? 0,
			discoverySource: discovery?.source ?? "unknown",
			results: allResults,
			summary,
			profiles: PROFILES,
		});
		console.log(`[rosegriffon] report written: ${REPORT_PATH}`);
	}
});

// ---------------------------------------------------------------------------
// Per-page run helpers
// ---------------------------------------------------------------------------

async function runOne(profile: ProfileName, url: string): Promise<SiteResult> {
	const result: SiteResult = { profile, url, status: "fail" };
	const t0 = Bun.nanoseconds();
	let page: Page | undefined;
	try {
		page = (await Browser.newPage({
			profile,
			spawnOpts: {
				logLevel: "error",
				readyTimeoutMs: 10_000,
				binaryPath: lightpandaBin ?? undefined,
				stderrLogger: (s) => {
					if (Bun.env.BUNLIGHT_E2E_VERBOSE) Bun.stderr.write(`[lp] ${s}`);
				},
			},
		})) as Page;

		await Promise.race([
			page.goto(url),
			new Promise<never>((_, reject) =>
				setTimeout(
					() => reject(new Error(`goto timed out after ${NAV_TIMEOUT_MS}ms`)),
					NAV_TIMEOUT_MS,
				),
			),
		]);

		result.gotoMs = (Bun.nanoseconds() - t0) / 1e6;

		try {
			const html = await page.content();
			result.contentBytes = html.length;
			// Reject obvious anti-bot interstitials.
			if (/Just a moment|Checking your browser|Cloudflare/i.test(html)) {
				throw new Error("anti-bot interstitial detected");
			}
		} catch (err) {
			result.error = `content: ${err instanceof Error ? err.message : String(err)}`;
		}

		const mu = process.memoryUsage();
		result.rssMb = mu.rss / 1024 / 1024;

		if (!result.error && (result.contentBytes ?? 0) > 50) {
			result.status = "pass";
		} else if (!result.error) {
			result.error = `content too small (${result.contentBytes ?? 0} bytes)`;
		}
	} catch (err) {
		result.error = err instanceof Error ? err.message : String(err);
	} finally {
		try {
			await page?.close();
		} catch {
			// best-effort
		}
	}
	return result;
}

function recordResult(profile: ProfileName, r: SiteResult): void {
	allResults.push(r);
	const s = summary[profile];
	if (r.status === "pass") s.pass++;
	else if (r.status === "skip") s.skip++;
	else s.fail++;
	if (typeof r.gotoMs === "number") {
		s.totalGotoMs += r.gotoMs;
		s.gotoCount++;
	}
	if (typeof r.rssMb === "number" && r.rssMb > s.peakRssMb) s.peakRssMb = r.rssMb;
}

// ---------------------------------------------------------------------------
// Per-profile describe blocks
// ---------------------------------------------------------------------------

for (const profile of PROFILES) {
	describe(`gemini.google.com — profile=${profile}`, () => {
		test(
			`crawl all pages with profile=${profile}`,
			async () => {
				if (!online) {
					console.log(`[rosegriffon ${profile}] SKIP: offline and no cache`);
					return;
				}
				if (discovery.urls.length === 0) {
					console.log(`[rosegriffon ${profile}] SKIP: no pages discovered`);
					return;
				}

				const probe = await checkProfile(profile);
				if (!probe.available) {
					for (const url of discovery.urls) {
						const r: SiteResult = {
							profile,
							url,
							status: "skip",
							error: probe.reason,
						};
						recordResult(profile, r);
						console.log(`[${profile}] SKIP ${url}: ${probe.reason}`);
					}
					return;
				}

				for (const url of discovery.urls) {
					const r = await runOne(profile, url);
					recordResult(profile, r);
					const tag = r.status === "pass" ? "PASS" : r.status === "skip" ? "SKIP" : "FAIL";
					const ms = r.gotoMs ? `${r.gotoMs.toFixed(0)}ms` : "-";
					const kb = r.contentBytes ? `${(r.contentBytes / 1024).toFixed(1)}KB` : "-";
					console.log(
						`[${profile}] ${tag} ${url} goto=${ms} content=${kb}${r.error ? " err=" + r.error : ""}`,
					);
				}

				// Force teardown between profiles to avoid pool leakage.
				await Browser.close().catch(() => {});

				// At least one URL must have produced a result.
				const total = summary[profile].pass + summary[profile].fail + summary[profile].skip;
				expect(total).toBeGreaterThan(0);

				// For the primary fast profile the suite enforces the 95% pass rate
				// in the dedicated assertion test below; here we only assert that
				// the pass rate is reasonable (>0%) when the profile is supported,
				// otherwise the report will surface the regression.
				if (profile === "fast") {
					const ratio = summary[profile].pass / total;
					expect(ratio).toBeGreaterThan(0);
				}
			},
			{
				timeout: discovery?.urls.length
					? Math.max(PER_TEST_TIMEOUT_MS, discovery.urls.length * NAV_TIMEOUT_MS + 30_000)
					: PER_TEST_TIMEOUT_MS,
			},
		);
	});
}

// ---------------------------------------------------------------------------
// Final acceptance gate
// ---------------------------------------------------------------------------

describe("gemini.google.com — acceptance", () => {
	test("profile=fast has >= 95% pass rate (Lightpanda primary target)", () => {
		if (!online) {
			console.log("[rosegriffon acceptance] SKIP: offline");
			return;
		}
		const s = summary.fast;
		const total = s.pass + s.fail; // skip excluded
		if (total === 0) {
			console.log("[rosegriffon acceptance] SKIP: profile=fast not exercised");
			return;
		}
		const ratio = s.pass / total;
		console.log(
			`[rosegriffon acceptance] fast pass=${s.pass} fail=${s.fail} ratio=${(ratio * 100).toFixed(1)}%`,
		);
		expect(ratio).toBeGreaterThanOrEqual(0.95);
	});
});
