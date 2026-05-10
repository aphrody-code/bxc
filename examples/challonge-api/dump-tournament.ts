#!/usr/bin/env bun
/**
 * dump-tournament.ts — full HTML/JSON harvest of a Challonge tournament.
 *
 * For a given slug, downloads every page surface that the web UI exposes,
 * persists raw HTML + JSON to disk, then analyses each file and emits a
 * single `analysis.md` summarising :
 *
 *   - HTTP status / size / latency per URL
 *   - All `<link rel="stylesheet">` + `<script src>` URLs (hosts deduped)
 *   - Top CSS selectors (inline `<style>` + linked stylesheets, fetched too)
 *   - Top `data-*` attributes and class-name patterns
 *   - Inline JS globals (window.__INITIAL_STATE__, _initialStoreState, …)
 *
 * Usage :
 *   bun run examples/challonge-api/dump-tournament.ts <slug> [outDir]
 *
 *   bun run examples/challonge-api/dump-tournament.ts B_TS5 ./out/B_TS5
 *
 * The cookie jar at `cookies/private/challonge.json` is honored when present
 * (required for /log, /module, /stations, /participants — Cloudflare gates
 * everything but the JSON reverse routes are also gated).
 *
 * Bun-native only.
 */

import { Browser, type HttpPage } from "../../src/api/browser.ts";
import { resolve as resolvePath } from "node:path";

const CHALLONGE_ORIGIN = "https://challonge.com";
const COOKIE_JAR =
	process.env.CHALLONGE_COOKIES ?? `${import.meta.dir}/cookies/private/challonge.json`;

interface TargetUrl {
	id: string;
	url: string;
	expectJson: boolean;
}

function tournamentTargets(slug: string): TargetUrl[] {
	const base = `${CHALLONGE_ORIGIN}/fr/${slug}`;
	return [
		{ id: "01-index", url: base, expectJson: false },
		{ id: "02-module", url: `${base}/module`, expectJson: false },
		{ id: "03-log", url: `${base}/log`, expectJson: false },
		{ id: "04-standings", url: `${base}/standings`, expectJson: false },
		{ id: "05-participants", url: `${base}/participants`, expectJson: false },
		{ id: "06-stations", url: `${base}/stations`, expectJson: false },
		{ id: "07-tournament", url: `${CHALLONGE_ORIGIN}/${slug}.json`, expectJson: true },
		{ id: "08-log-json", url: `${CHALLONGE_ORIGIN}/${slug}/log.json`, expectJson: true },
		{
			id: "09-standings-json",
			url: `${CHALLONGE_ORIGIN}/${slug}/standings.json`,
			expectJson: true,
		},
		{
			id: "10-participants-json",
			url: `${CHALLONGE_ORIGIN}/${slug}/participants.json`,
			expectJson: true,
		},
		{ id: "11-stations-json", url: `${CHALLONGE_ORIGIN}/${slug}/stations.json`, expectJson: true },
		{ id: "12-matches-json", url: `${CHALLONGE_ORIGIN}/${slug}/matches.json`, expectJson: true },
	];
}

interface DownloadResult {
	id: string;
	url: string;
	status: number;
	bytes: number;
	durationMs: number;
	contentType: string;
	expectJson: boolean;
	jsonValid?: boolean;
	error?: string;
}

async function cookieJarPresent(): Promise<boolean> {
	return Bun.file(COOKIE_JAR).exists();
}

async function downloadOne(
	target: TargetUrl,
	outDir: string,
	cookies: string | undefined,
): Promise<DownloadResult> {
	const t0 = Bun.nanoseconds();
	let page: HttpPage | undefined;
	try {
		page = (await Browser.newPage({
			profile: "http",
			cookies,
			httpOpts: { profile: "chrome131" },
		})) as HttpPage;
		const nav = await page.goto(target.url, { timeoutMs: 25_000 });
		const body = await page.content().catch(() => "");
		const ext = target.expectJson ? "json" : "html";
		const outPath = resolvePath(outDir, "pages", `${target.id}.${ext}`);
		await Bun.write(outPath, body);
		let jsonValid: boolean | undefined;
		if (target.expectJson) {
			try {
				JSON.parse(body);
				jsonValid = true;
			} catch {
				jsonValid = false;
			}
		}
		return {
			id: target.id,
			url: target.url,
			status: nav.status,
			bytes: body.length,
			durationMs: (Bun.nanoseconds() - t0) / 1e6,
			contentType: target.expectJson ? "application/json" : "text/html",
			expectJson: target.expectJson,
			jsonValid,
		};
	} catch (err) {
		return {
			id: target.id,
			url: target.url,
			status: 0,
			bytes: 0,
			durationMs: (Bun.nanoseconds() - t0) / 1e6,
			contentType: "error",
			expectJson: target.expectJson,
			error: err instanceof Error ? err.message : String(err),
		};
	} finally {
		try {
			await page?.close();
		} catch {
			// ignore
		}
		await Browser.close().catch(() => undefined);
	}
}

interface ExtractedAssets {
	stylesheets: string[];
	scripts: string[];
	hosts: Map<string, number>;
	dataAttrs: Map<string, number>;
	classNames: Map<string, number>;
	inlineGlobals: string[];
}

function extractFromHtml(html: string, baseUrl: string): ExtractedAssets {
	const out: ExtractedAssets = {
		stylesheets: [],
		scripts: [],
		hosts: new Map(),
		dataAttrs: new Map(),
		classNames: new Map(),
		inlineGlobals: [],
	};
	const base = new URL(baseUrl);

	type El = { getAttribute: (n: string) => string | null };
	type RewriterCtor = new () => {
		on(
			sel: string,
			h: {
				element: (el: El) => void;
				text?: (t: { text: string; lastInTextNode: boolean }) => void;
			},
		): unknown;
		transform(html: string): string;
	};
	const Rewriter = (globalThis as unknown as { HTMLRewriter?: RewriterCtor }).HTMLRewriter;
	if (!Rewriter) {
		// Fallback regex parsing for non-Bun runtimes.
		for (const m of html.matchAll(
			/<link[^>]+rel=["']?stylesheet["']?[^>]+href=["']([^"']+)["']/gi,
		)) {
			out.stylesheets.push(new URL(m[1], base).href);
		}
		for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
			out.scripts.push(new URL(m[1], base).href);
		}
		for (const m of html.matchAll(/(data-[a-z][a-z0-9-]*)=/gi)) {
			out.dataAttrs.set(m[1], (out.dataAttrs.get(m[1]) ?? 0) + 1);
		}
		return out;
	}

	const rw = new Rewriter();
	rw.on('link[rel="stylesheet"]', {
		element(el) {
			const href = el.getAttribute("href");
			if (href) out.stylesheets.push(new URL(href, base).href);
		},
	});
	rw.on("script[src]", {
		element(el) {
			const src = el.getAttribute("src");
			if (src) out.scripts.push(new URL(src, base).href);
		},
	});
	rw.on("[class]", {
		element(el) {
			const cls = el.getAttribute("class");
			if (!cls) return;
			for (const c of cls.split(/\s+/)) {
				if (c) out.classNames.set(c, (out.classNames.get(c) ?? 0) + 1);
			}
		},
	});
	// data-* attribute discovery — HTMLRewriter does not expose attribute
	// iteration, so we cover the common ones explicitly. Fallback regex
	// catches the rest.
	rw.transform(html);
	for (const m of html.matchAll(/(data-[a-z][a-z0-9-]+)=/gi)) {
		out.dataAttrs.set(m[1], (out.dataAttrs.get(m[1]) ?? 0) + 1);
	}

	// Hosts dedupe.
	for (const url of [...out.stylesheets, ...out.scripts]) {
		try {
			const host = new URL(url).hostname;
			out.hosts.set(host, (out.hosts.get(host) ?? 0) + 1);
		} catch {
			// ignore invalid URL
		}
	}

	// Inline globals worth flagging.
	const globals = [
		"_initialStoreState",
		"__NEXT_DATA__",
		"__NUXT__",
		"__INITIAL_STATE__",
		"__APOLLO_STATE__",
		"window.gtag",
		"window.dataLayer",
		"GTM-",
		"UA-",
		"G-",
	];
	for (const g of globals) {
		if (html.includes(g)) out.inlineGlobals.push(g);
	}

	return out;
}

async function fetchStylesheet(url: string): Promise<string | null> {
	try {
		const r = await fetch(url, {
			signal: AbortSignal.timeout(15_000),
			headers: {
				"User-Agent":
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			},
		});
		if (!r.ok) return null;
		return r.text();
	} catch {
		return null;
	}
}

function extractCssSelectors(css: string, max = 200): string[] {
	const out = new Set<string>();
	for (const m of css.matchAll(/([^{}@]+)\{[^{}]*\}/g)) {
		const sel = m[1].trim().replace(/\s+/g, " ");
		if (!sel || sel.startsWith("@") || sel.startsWith("/*") || sel.length > 200) continue;
		if (/^\d/.test(sel)) continue;
		for (const s of sel.split(",")) {
			const t = s.trim();
			if (t && t.length < 200) out.add(t);
			if (out.size >= max) return [...out];
		}
	}
	return [...out];
}

async function analyse(results: DownloadResult[], outDir: string, slug: string): Promise<string> {
	const lines: string[] = [];
	lines.push(`# Challonge tournament dump — ${slug}`);
	lines.push("");
	lines.push(`Date : ${new Date().toISOString().slice(0, 19)}Z`);
	lines.push(`Cookie jar : ${(await cookieJarPresent()) ? COOKIE_JAR : "absent"}`);
	lines.push("");

	// Per-URL summary
	lines.push("## URLs scraped");
	lines.push("");
	lines.push("| ID | URL | HTTP | Bytes | Duration | Notes |");
	lines.push("|---|---|---|---|---|---|");
	for (const r of results) {
		const note = r.error
			? r.error.slice(0, 60)
			: r.expectJson
				? r.jsonValid
					? "valid JSON"
					: "JSON parse failed"
				: "html";
		lines.push(
			`| ${r.id} | \`${r.url}\` | ${r.status || "—"} | ${r.bytes} | ${r.durationMs.toFixed(0)} ms | ${note} |`,
		);
	}
	lines.push("");

	// Aggregate analysis across HTML pages
	const allHosts = new Map<string, number>();
	const allClassNames = new Map<string, number>();
	const allDataAttrs = new Map<string, number>();
	const allScripts = new Set<string>();
	const allStylesheets = new Set<string>();
	const allInlineGlobals = new Set<string>();

	for (const r of results) {
		if (r.expectJson || r.error || r.bytes === 0) continue;
		const path = resolvePath(outDir, "pages", `${r.id}.html`);
		const html = await Bun.file(path).text();
		const x = extractFromHtml(html, r.url);
		for (const [k, v] of x.hosts) allHosts.set(k, (allHosts.get(k) ?? 0) + v);
		for (const [k, v] of x.classNames) allClassNames.set(k, (allClassNames.get(k) ?? 0) + v);
		for (const [k, v] of x.dataAttrs) allDataAttrs.set(k, (allDataAttrs.get(k) ?? 0) + v);
		for (const s of x.scripts) allScripts.add(s);
		for (const s of x.stylesheets) allStylesheets.add(s);
		for (const g of x.inlineGlobals) allInlineGlobals.add(g);
	}

	lines.push("## Asset hosts");
	lines.push("");
	lines.push("| Host | Asset count |");
	lines.push("|---|---|");
	for (const [host, count] of [...allHosts.entries()].sort((a, b) => b[1] - a[1])) {
		lines.push(`| \`${host}\` | ${count} |`);
	}
	lines.push("");

	lines.push(`## Stylesheets (${allStylesheets.size})`);
	lines.push("");
	for (const s of [...allStylesheets].sort()) lines.push(`- ${s}`);
	lines.push("");

	lines.push(`## Scripts (${allScripts.size})`);
	lines.push("");
	for (const s of [...allScripts].sort()) lines.push(`- ${s}`);
	lines.push("");

	if (allInlineGlobals.size > 0) {
		lines.push("## Inline JS globals detected");
		lines.push("");
		for (const g of allInlineGlobals) lines.push(`- \`${g}\``);
		lines.push("");
	}

	// Top class names + data-attrs
	const topClasses = [...allClassNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60);
	lines.push(`## Top CSS class names (top 60 of ${allClassNames.size})`);
	lines.push("");
	lines.push("| Class | Occurrences |");
	lines.push("|---|---|");
	for (const [c, n] of topClasses) lines.push(`| \`${c}\` | ${n} |`);
	lines.push("");

	const topData = [...allDataAttrs.entries()].sort((a, b) => b[1] - a[1]);
	lines.push(`## data-* attributes (${topData.length})`);
	lines.push("");
	lines.push("| Attribute | Occurrences |");
	lines.push("|---|---|");
	for (const [a, n] of topData) lines.push(`| \`${a}\` | ${n} |`);
	lines.push("");

	// CSS selectors from up to 5 stylesheets
	lines.push("## CSS selectors (sample, up to 200 per stylesheet, max 5 stylesheets)");
	lines.push("");
	let fetched = 0;
	for (const sheet of allStylesheets) {
		if (fetched >= 5) {
			lines.push(`_… ${allStylesheets.size - 5} more stylesheets not analysed_`);
			break;
		}
		const css = await fetchStylesheet(sheet);
		if (!css) {
			lines.push(`### ${sheet}`);
			lines.push("");
			lines.push("_(unreachable)_");
			lines.push("");
			fetched++;
			continue;
		}
		const sels = extractCssSelectors(css);
		const cssOut = resolvePath(
			outDir,
			"stylesheets",
			`${fetched + 1}-${new URL(sheet).pathname.split("/").pop() ?? "sheet.css"}`,
		);
		await Bun.write(cssOut, css);
		lines.push(`### ${sheet} (${css.length} bytes, ${sels.length} selectors)`);
		lines.push("");
		lines.push("```css");
		for (const s of sels.slice(0, 30)) lines.push(`${s} {}`);
		if (sels.length > 30) lines.push(`/* … ${sels.length - 30} more */`);
		lines.push("```");
		lines.push("");
		fetched++;
	}

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const slug = process.argv[2];
	const outDir = resolvePath(process.argv[3] ?? `./out/${slug}`);
	if (!slug) {
		process.stderr.write("Usage: bun dump-tournament.ts <slug> [outDir]\n");
		process.exit(2);
	}

	await Bun.$`mkdir -p ${outDir}/pages ${outDir}/stylesheets`.quiet();

	const cookies = (await cookieJarPresent()) ? COOKIE_JAR : undefined;
	if (!cookies) {
		process.stderr.write(
			`Warning: cookie jar ${COOKIE_JAR} missing. Cloudflare will return 403 on most pages.\n`,
		);
	}

	const targets = tournamentTargets(slug);
	process.stderr.write(`dump-tournament: ${targets.length} URLs for slug=${slug}\n`);

	const results: DownloadResult[] = [];
	for (const t of targets) {
		const r = await downloadOne(t, outDir, cookies);
		results.push(r);
		process.stderr.write(
			`  ${r.id}  ${r.status || "ERR"}  ${r.bytes}b  ${r.durationMs.toFixed(0)}ms  ${t.url}\n`,
		);
	}

	await Bun.write(
		resolvePath(outDir, "manifest.json"),
		JSON.stringify({ slug, fetchedAt: new Date().toISOString(), results }, null, 2),
	);

	const md = await analyse(results, outDir, slug);
	await Bun.write(resolvePath(outDir, "analysis.md"), md);

	process.stderr.write(
		`\ndump-tournament: done\n  output : ${outDir}\n  manifest : ${outDir}/manifest.json\n  analysis : ${outDir}/analysis.md\n`,
	);
}

if (import.meta.main) {
	await main();
}
