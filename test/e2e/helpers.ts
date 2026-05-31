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
 * @module test/e2e/helpers
 *
 * Shared helpers for the rosegriffon and azalee full-crawl E2E suites.
 *
 * - Profile availability probing (skip stealth/max cleanly when binaries
 *   are missing).
 * - Per-page result/summary types.
 * - Markdown report writer (matching the layout in the spec 05a-e2e-prod-sites).
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProfileName = "static" | "fast" | "http" | "stealth" | "max";

export interface SiteResult {
	profile: ProfileName;
	url: string;
	status: "pass" | "fail" | "skip";
	gotoMs?: number;
	contentBytes?: number;
	rssMb?: number;
	error?: string;
}

export interface ProfileSummary {
	pass: number;
	fail: number;
	skip: number;
	totalGotoMs: number;
	gotoCount: number;
	peakRssMb: number;
}

export interface ReportInput {
	origin: string;
	date: string;
	discoveredCount: number;
	discoverySource: string;
	results: SiteResult[];
	summary: Record<ProfileName, ProfileSummary>;
	profiles: readonly ProfileName[];
}

// ---------------------------------------------------------------------------
// Binary discovery — mirrors the logic in src/profiles/{stealth,max}/index.ts
// without importing the modules (keep helpers cheap, avoid double init).
// ---------------------------------------------------------------------------

const HOME = Bun.env.HOME ?? "";

async function fileExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

async function anyExists(
	candidates: readonly string[],
): Promise<string | null> {
	for (const c of candidates) {
		if (!c) continue;
		if (await fileExists(c)) return c;
	}
	return null;
}

/**
 * Resolve the absolute path to a lightpanda binary if any is available, else null.
 * Side effect: when found, exposes the path via `BXC_LIGHTPANDA_BIN` so the
 * SocketPairTransport default lookup picks it up (it falls back to `"lightpanda"`
 * on $PATH otherwise, which is unreliable in CI).
 */
export async function resolveLightpandaBin(): Promise<string | null> {
	const candidates = [
		Bun.env.BXC_LIGHTPANDA_BIN,
		Bun.env.BXC_LIGHTPANDA_PATH,
		"${process.env.HOME || '/home/ubuntu'}/vps/packages/bxc/vendor/lightpanda-bin/linux-x64/lightpanda",
		`${HOME}/.cache/lightpanda-node/lightpanda`,
		`${HOME}/.local/bin/lightpanda`,
		`${HOME}/lightpanda`,
		"/usr/local/bin/lightpanda",
	].filter(Boolean) as string[];
	const found = await anyExists(candidates);
	if (found && !Bun.env.BXC_LIGHTPANDA_BIN) {
		Bun.env.BXC_LIGHTPANDA_BIN = found;
		Bun.env.BXC_LIGHTPANDA_PATH = found;
	}
	return found;
}

async function lightpandaAvailable(): Promise<boolean> {
	if (await resolveLightpandaBin()) return true;
	try {
		const r = Bun.spawnSync(["lightpanda", "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		return r.exitCode === 0;
	} catch {
		return false;
	}
}

async function chromiumAvailable(): Promise<boolean> {
	// Patchright requires the playwright-installed `chrome-headless-shell` bundle.
	// A bare `/usr/local/bin/chromium` is not enough — patchright drives only
	// the playwright-managed binary. So we ONLY look in the ms-playwright cache.
	const playwrightCacheDir = `${HOME}/.cache/ms-playwright`;
	const cacheCandidates: string[] = [
		Bun.env.PLAYWRIGHT_CHROMIUM_PATH ?? "",
	].filter(Boolean);

	// Glob-scan the cache for any installed chromium bundle.
	try {
		const glob = new Bun.Glob("chromium*/chrome-linux/chrome");
		for await (const rel of glob.scan({
			cwd: playwrightCacheDir,
			onlyFiles: true,
		})) {
			cacheCandidates.push(`${playwrightCacheDir}/${rel}`);
		}
		const headless = new Bun.Glob(
			"chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell",
		);
		for await (const rel of headless.scan({
			cwd: playwrightCacheDir,
			onlyFiles: true,
		})) {
			cacheCandidates.push(`${playwrightCacheDir}/${rel}`);
		}
	} catch {
		// directory doesn't exist
	}

	return (await anyExists(cacheCandidates)) !== null;
}

async function camoufoxAvailable(): Promise<boolean> {
	// Strategy: the max profile uses Camoufox first then falls back to patchright
	// Firefox. The Camoufox launcher in vendor/ has empirically been observed to
	// fail to bring up its CDP endpoint in CI environments without a display
	// server, so we require the playwright-installed Firefox bundle as the
	// authoritative "max is workable" signal. When that bundle is missing we
	// skip cleanly rather than burning 30+ seconds per page hitting fallbacks.
	const playwrightCacheDir = `${HOME}/.cache/ms-playwright`;
	try {
		const glob = new Bun.Glob("firefox-*/firefox/firefox");
		for await (const rel of glob.scan({
			cwd: playwrightCacheDir,
			onlyFiles: true,
		})) {
			if (await fileExists(`${playwrightCacheDir}/${rel}`)) return true;
		}
	} catch {
		// no cache
	}
	return false;
}

// curl-impersonate ships a `.so` library, no external binary required: the FFI
// loader probes vendor/curl-impersonate at module-init time. We assume `http`
// is always available when the FFI lib is present (which it is in this repo);
// otherwise the API will throw on first newPage call and we surface it as fail.
async function curlImpersonateAvailable(): Promise<boolean> {
	if (
		Bun.env.BXC_CURL_IMPERSONATE_LIB &&
		(await fileExists(Bun.env.BXC_CURL_IMPERSONATE_LIB))
	)
		return true;
	const root = new URL("../../", import.meta.url).pathname;
	const candidates = [
		`${root}vendor/curl-impersonate/libcurl-impersonate.so.4.8.0`,
		`${root}vendor/curl-impersonate/libcurl-impersonate.so.4`,
		`${root}vendor/curl-impersonate/libcurl-impersonate.so`,
		`${root}vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0`,
		`${root}vendor/curl-impersonate/libcurl-impersonate-chrome.so`,
	];
	return (await anyExists(candidates)) !== null;
}

async function zigqueryAvailable(): Promise<boolean> {
	const root = new URL("../../", import.meta.url).pathname;
	const candidates = [
		Bun.env.BXC_ZIGQUERY_LIB,
		`${root}vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so`,
	].filter(Boolean) as string[];
	return (await anyExists(candidates)) !== null;
}

// ---------------------------------------------------------------------------
// Public profile probe
// ---------------------------------------------------------------------------

export interface ProfileProbe {
	profile: ProfileName;
	available: boolean;
	reason: string;
}

export async function checkProfile(
	profile: ProfileName,
): Promise<ProfileProbe> {
	switch (profile) {
		case "static":
			return (await zigqueryAvailable())
				? { profile, available: true, reason: "" }
				: {
						profile,
						available: false,
						reason: "zigquery cdylib not built (vendor/zigquery-wrapper)",
					};
		case "fast":
			return (await lightpandaAvailable())
				? { profile, available: true, reason: "" }
				: {
						profile,
						available: false,
						reason: "lightpanda binary not found on PATH or vendor/",
					};
		case "http":
			return (await curlImpersonateAvailable())
				? { profile, available: true, reason: "" }
				: {
						profile,
						available: false,
						reason: "curl-impersonate shared library not found in vendor/",
					};
		case "stealth":
			return (await chromiumAvailable())
				? { profile, available: true, reason: "" }
				: {
						profile,
						available: false,
						reason:
							"Chromium binary not found (run `bunx patchright install chromium`)",
					};
		case "max":
			return (await camoufoxAvailable())
				? { profile, available: true, reason: "" }
				: {
						profile,
						available: false,
						reason:
							"Camoufox/Firefox bundle not present (run `python -m camoufox fetch`)",
					};
	}
}

// ---------------------------------------------------------------------------
// Markdown report writer
// ---------------------------------------------------------------------------

function pct(numerator: number, denominator: number): string {
	if (denominator === 0) return "n/a";
	return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function fmtMs(value: number | undefined): string {
	if (value === undefined || Number.isNaN(value)) return "—";
	return `${value.toFixed(0)} ms`;
}

function fmtBytes(value: number | undefined): string {
	if (value === undefined || Number.isNaN(value)) return "—";
	if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
	return `${value} B`;
}

function fmtMb(value: number | undefined): string {
	if (value === undefined || Number.isNaN(value)) return "—";
	return `${value.toFixed(1)} MB`;
}

export async function writeReport(
	target: string,
	input: ReportInput,
): Promise<void> {
	const {
		origin,
		date,
		discoveredCount,
		discoverySource,
		results,
		summary,
		profiles,
	} = input;

	const lines: string[] = [];
	lines.push(`# E2E full-crawl report — ${origin}`);
	lines.push("");
	lines.push(`Date: ${date}`);
	lines.push(
		`Pages discovered: ${discoveredCount}  (source: ${discoverySource})`,
	);
	lines.push(`Total samples: ${results.length}`);
	lines.push("");

	// Per-profile summary table
	lines.push("## Per-profile summary");
	lines.push("");
	lines.push(
		"| Profile | Pass | Fail | Skip | Pass rate | Avg goto | Peak RSS |",
	);
	lines.push("|---|---|---|---|---|---|---|");
	for (const p of profiles) {
		const s = summary[p];
		const total = s.pass + s.fail;
		const avgGoto = s.gotoCount > 0 ? s.totalGotoMs / s.gotoCount : undefined;
		lines.push(
			`| ${p} | ${s.pass} | ${s.fail} | ${s.skip} | ${pct(s.pass, total)} | ${fmtMs(avgGoto)} | ${fmtMb(s.peakRssMb)} |`,
		);
	}
	lines.push("");

	// Failures list
	const failures = results.filter((r) => r.status === "fail");
	lines.push("## Failures");
	lines.push("");
	if (failures.length === 0) {
		lines.push("(none)");
	} else {
		lines.push("| Page | Profile | Error | Snapshot length |");
		lines.push("|---|---|---|---|");
		for (const r of failures) {
			const err = (r.error ?? "").replace(/\|/g, "/").replace(/\n/g, " ");
			lines.push(
				`| ${r.url} | ${r.profile} | ${err} | ${fmtBytes(r.contentBytes)} |`,
			);
		}
	}
	lines.push("");

	// Skipped list
	const skipped = results.filter((r) => r.status === "skip");
	if (skipped.length > 0) {
		const reasons = new Map<string, { profile: ProfileName; count: number }>();
		for (const r of skipped) {
			const key = `${r.profile}::${r.error ?? "no reason"}`;
			const cur = reasons.get(key);
			if (cur) cur.count++;
			else reasons.set(key, { profile: r.profile, count: 1 });
		}
		lines.push("## Skipped");
		lines.push("");
		lines.push("| Profile | Reason | Count |");
		lines.push("|---|---|---|");
		for (const [key, value] of reasons) {
			const reason = key.split("::")[1];
			lines.push(`| ${value.profile} | ${reason} | ${value.count} |`);
		}
		lines.push("");
	}

	// Discovered URL list
	lines.push("## Pages crawled");
	lines.push("");
	const uniqUrls = Array.from(new Set(results.map((r) => r.url))).sort();
	for (const u of uniqUrls) lines.push(`- ${u}`);
	lines.push("");

	await Bun.write(target, lines.join("\n"));
}
