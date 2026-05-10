#!/usr/bin/env bun
/**
 * Test bunlight against all documentary URLs in ~/material-ai repo.
 *
 * Probes static / fast / http profiles against material.io, stitch,
 * designtokens, and the 2 GitHub references. Outputs a Markdown table.
 */

import { Browser } from "../src/api/browser.ts";
import { resolveLightpandaBin } from "../test/e2e/helpers.ts";

const URLS = [
	{ category: "m3-overview", url: "https://m3.material.io" },
	{ category: "m3-blog", url: "https://m3.material.io/blog/start-building-with-material-you" },
	{ category: "m3-tokens", url: "https://m3.material.io/foundations/design-tokens/overview" },
	{
		category: "m3-states",
		url: "https://m3.material.io/foundations/interaction/states/state-layers",
	},
	{
		category: "m3-color",
		url: "https://m3.material.io/styles/color/the-color-system/key-colors-tones",
	},
	{ category: "m3-elevation", url: "https://m3.material.io/styles/elevation/applying-elevation" },
	{ category: "m3-motion", url: "https://m3.material.io/styles/motion/easing-and-duration" },
	{ category: "m3-shape", url: "https://m3.material.io/styles/shape/shape-scale-tokens" },
	{ category: "m3-typo", url: "https://m3.material.io/styles/typography/type-scale-tokens" },
	{ category: "stitch-spec", url: "https://stitch.withgoogle.com/docs/design-md/overview/" },
	{ category: "tokens-w3c", url: "https://www.designtokens.org/tr/drafts/format/" },
	{ category: "gh-awesome", url: "https://github.com/voltagent/awesome-design-md" },
	{ category: "gh-open-design", url: "https://github.com/nexu-io/open-design" },
];

const PROFILES = ["static", "fast", "http"] as const;
type ProfileName = (typeof PROFILES)[number];

interface Result {
	url: string;
	category: string;
	profile: ProfileName;
	status: "pass" | "fail";
	httpStatus?: number;
	bytes?: number;
	gotoMs?: number;
	error?: string;
}

const results: Result[] = [];
const lightpandaBin = await resolveLightpandaBin();

async function probe(
	profile: ProfileName,
	entry: { url: string; category: string },
): Promise<Result> {
	const r: Result = {
		url: entry.url,
		category: entry.category,
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
			page.goto(entry.url, { timeoutMs: 25_000 }),
			new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout 25s")), 25_000)),
		]);

		r.gotoMs = (Bun.nanoseconds() - t0) / 1e6;

		if (nav && typeof nav === "object" && "status" in nav) {
			r.httpStatus = (nav as { status: number }).status;
		}

		const body = await page.content().catch(() => "");
		r.bytes = body.length;

		if (r.bytes > 500 && (r.httpStatus === undefined || r.httpStatus < 400)) {
			r.status = "pass";
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

console.log(
	`Testing ${URLS.length} URLs × ${PROFILES.length} profiles = ${URLS.length * PROFILES.length} probes`,
);
console.log("");

for (const profile of PROFILES) {
	console.log(`=== profile=${profile} ===`);
	for (const entry of URLS) {
		const r = await probe(profile, entry);
		results.push(r);
		const tag = r.status === "pass" ? "PASS" : "FAIL";
		const httpTag = r.httpStatus ? `[${r.httpStatus}]` : "";
		const bytesTag = r.bytes ? ` ${(r.bytes / 1024).toFixed(0)}KB` : "";
		const msTag = r.gotoMs ? ` ${r.gotoMs.toFixed(0)}ms` : "";
		const errTag = r.error ? ` err=${r.error.slice(0, 50)}` : "";
		console.log(
			`  ${tag} ${httpTag} ${entry.category.padEnd(16)} ${entry.url.slice(0, 60).padEnd(60)}${msTag}${bytesTag}${errTag}`,
		);
		await Browser.close().catch(() => {});
		await Bun.sleep(500);
	}
	console.log("");
}

await Browser.close().catch(() => {});

// Final report
const reportPath = `${import.meta.dir}/../test/e2e/results/${new Date().toISOString().slice(0, 10)}-material-ai.md`;
const lines: string[] = [];
lines.push(`# bunlight test against material-ai documentary URLs`);
lines.push("");
lines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);
lines.push(`Total probes: ${results.length}`);
lines.push("");

// Per-profile summary
lines.push("## Per-profile summary");
lines.push("");
lines.push("| Profile | Pass | Fail | Pass rate | Avg goto ms |");
lines.push("|---|---|---|---|---|");
for (const p of PROFILES) {
	const ofProf = results.filter((r) => r.profile === p);
	const pass = ofProf.filter((r) => r.status === "pass").length;
	const fail = ofProf.length - pass;
	const rate = ((pass / ofProf.length) * 100).toFixed(0);
	const avg =
		ofProf.filter((r) => r.gotoMs).reduce((s, r) => s + (r.gotoMs ?? 0), 0) /
		ofProf.filter((r) => r.gotoMs).length;
	lines.push(`| ${p} | ${pass} | ${fail} | ${rate}% | ${avg.toFixed(0)} ms |`);
}
lines.push("");

// Pattern × profile matrix
lines.push("## URL × profile matrix");
lines.push("");
lines.push(`| URL | static | fast | http |`);
lines.push(`|---|---|---|---|`);
for (const entry of URLS) {
	const cells: string[] = [];
	for (const p of PROFILES) {
		const r = results.find((x) => x.url === entry.url && x.profile === p);
		if (!r) cells.push("—");
		else if (r.status === "pass")
			cells.push(`pass [${r.httpStatus}] ${(r.bytes! / 1024).toFixed(0)}KB`);
		else cells.push(`fail: ${r.error?.slice(0, 30) ?? "?"}`);
	}
	lines.push(`| ${entry.url.replace(/\|/g, "/")} | ${cells.join(" | ")} |`);
}
lines.push("");

// Failures
const failures = results.filter((r) => r.status === "fail");
if (failures.length > 0) {
	lines.push("## Failures");
	lines.push("");
	lines.push("| Profile | URL | Error |");
	lines.push("|---|---|---|");
	for (const r of failures) {
		lines.push(`| ${r.profile} | ${r.url} | ${(r.error ?? "?").slice(0, 80)} |`);
	}
}

await Bun.write(reportPath, lines.join("\n"));
console.log(`\nReport written: ${reportPath}`);

const totalPass = results.filter((r) => r.status === "pass").length;
const totalFail = results.filter((r) => r.status === "fail").length;
console.log(`\nTotal: ${totalPass}/${results.length} pass, ${totalFail} fail`);
