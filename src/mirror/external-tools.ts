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
 * @module bxc/mirror/external-tools
 *
 * Optional acceleration of `bxc mirror` via best-in-class external binaries,
 * each used only when present on PATH (graceful degradation to the built-in
 * Bun mirror otherwise):
 *
 *   - `spider`   (spider-rs, MIT) — concurrent multi-page crawl with HTTP/2
 *                connection pooling + anti-bot mitigation. Best for full sites.
 *   - `monolith` (CC0/MIT) — bundle a single page (HTML+CSS+JS+images) into one
 *                self-contained .html.
 *   - `aria2c`   (GPLv2 — invoked as an *external binary only*, never linked)
 *                — multi-segment parallel download of large individual assets.
 *
 * Every successful run feeds the Google {@link module:bxc/google/corpus | corpus}
 * (the "memory"): the host, the count of assets fetched, and which engine won.
 */

import { reinforce } from "../google/corpus.ts";

export type MirrorEngine = "spider" | "monolith" | "aria2" | "native";

export interface ToolAvailability {
	spider: string | null;
	monolith: string | null;
	aria2: string | null;
}

let cached: ToolAvailability | null = null;

/** Detect which external mirror tools are installed (memoised). */
export async function detectTools(): Promise<ToolAvailability> {
	if (cached) return cached;
	cached = {
		spider: Bun.which("spider"),
		monolith: Bun.which("monolith"),
		aria2: Bun.which("aria2c"),
	};
	return cached;
}

/**
 * Pick the best available engine for the job. `fullSite` ⇒ prefer the crawler;
 * otherwise prefer the single-file archiver, then the segmented downloader.
 */
export async function bestEngine(fullSite: boolean): Promise<MirrorEngine> {
	const t = await detectTools();
	if (fullSite && t.spider) return "spider";
	if (!fullSite && t.monolith) return "monolith";
	if (t.aria2) return "aria2";
	if (t.spider) return "spider";
	return "native";
}

export interface ExternalMirrorResult {
	engine: MirrorEngine;
	binary: string;
	exitCode: number;
	assets: number;
	durationMs: number;
}

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/**
 * Run an external mirror engine and reinforce the corpus with the result.
 * Returns `null` if the requested engine's binary is not installed (so the
 * caller falls back to the built-in Bun mirror).
 */
export async function runExternalMirror(
	engine: Exclude<MirrorEngine, "native">,
	url: string,
	outDir: string,
	opts: { depth?: number; concurrency?: number } = {},
): Promise<ExternalMirrorResult | null> {
	const t = await detectTools();
	const binary = engine === "aria2" ? t.aria2 : t[engine];
	if (!binary) return null;

	const argv: string[] = (() => {
		switch (engine) {
			case "spider":
				return [
					binary,
					"--url", url,
					"--limit", String((opts.depth ?? 0) > 0 ? 10_000 : 200),
					"--download", outDir,
				];
			case "monolith":
				return [binary, url, "-o", `${outDir}/index.html`];
			case "aria2":
				return [binary, "-x", String(opts.concurrency ?? 8), "-d", outDir, url];
		}
	})();

	const started = Date.now();
	const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", cwd: outDir });
	const [stdout, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);
	const durationMs = Date.now() - started;

	// Count fetched assets (best-effort, per engine output convention).
	const assets =
		engine === "monolith"
			? 1
			: (stdout.match(/\bhttps?:\/\//g)?.length ?? 0);

	// Feed the corpus — bxc remembers what it mirrored and how it went.
	await reinforce({
		host: hostOf(url),
		frameworks: [],
		apis: [],
		globals: [`mirror:${engine}`],
		headers: {},
		counts: { css: 0, js: 0, api: 0, htmlBytes: 0 },
	}).catch(() => undefined);

	return { engine, binary, exitCode, assets, durationMs };
}
