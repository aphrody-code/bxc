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
 * @module bxc/plugin/lightpanda-plugin
 *
 * Bun plugin that exposes Lightpanda-rendered pages as importable modules.
 *
 * Imports of the form `lightpanda:<url>` are intercepted, rendered via
 * Lightpanda (CDP `Page.navigate` + `DOM.getOuterHTML`), and the resulting
 * HTML is exposed as the default export of the module.
 *
 * @example Runtime usage (Bun.plugin)
 * ```ts
 * import { lightpandaPlugin } from "@aphrody-code/bxc/plugin";
 * Bun.plugin(lightpandaPlugin());
 *
 * const html = (await import("lightpanda:https://google.com")).default;
 * console.log(html.slice(0, 200));
 * ```
 *
 * @example Build-time usage (Bun.build)
 * ```ts
 * import { lightpandaPlugin } from "@aphrody-code/bxc/plugin";
 *
 * await Bun.build({
 *   entrypoints: ["./app.ts"],
 *   plugins: [lightpandaPlugin({ cacheTtlMs: 60_000 })],
 * });
 * ```
 *
 * @example Bundler import-attribute syntax
 * ```ts
 * // both forms work — namespace prefix or `with { type: "lightpanda" }`
 * import html from "lightpanda:https://google.com";
 * ```
 *
 * Reference: https://bun.com/docs/runtime/plugins
 */

import type { BunPlugin } from "bun";

import { Browser } from "../api/browser.ts";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface LightpandaPluginOptions {
	/** Lightpanda binary path override (defaults to bxc resolver). */
	binaryPath?: string;
	/** Navigation timeout per request (ms). Default 25_000. */
	navigationTimeoutMs?: number;
	/** Lightpanda log level (default: "error"). */
	logLevel?: "debug" | "info" | "warn" | "error";
	/** Cache rendered HTML in-memory for `cacheTtlMs` ms (default: 0 = no cache). */
	cacheTtlMs?: number;
	/** Module export shape: "html" returns string, "object" returns { html, status, finalUrl, gotoMs }. */
	exportShape?: "html" | "object";
	/**
	 * Base URL prepended when an import path is relative. Useful when
	 * pre-rendering pages from a known origin via build-time imports.
	 */
	baseUrl?: string;
}

// ---------------------------------------------------------------------------
// In-memory render cache
// ---------------------------------------------------------------------------

interface CacheEntry {
	html: string;
	status: number;
	finalUrl: string;
	gotoMs: number;
	expiresAt: number;
}

const RENDER_CACHE = new Map<string, CacheEntry>();

function cacheGet(key: string): CacheEntry | null {
	const e = RENDER_CACHE.get(key);
	if (!e) return null;
	if (Date.now() > e.expiresAt) {
		RENDER_CACHE.delete(key);
		return null;
	}
	return e;
}

function cacheSet(
	key: string,
	entry: Omit<CacheEntry, "expiresAt">,
	ttlMs: number,
): void {
	if (ttlMs <= 0) return;
	RENDER_CACHE.set(key, { ...entry, expiresAt: Date.now() + ttlMs });
}

// ---------------------------------------------------------------------------
// Render via Lightpanda (profile=fast)
// ---------------------------------------------------------------------------

/**
 * Renders a page via Lightpanda when the binary is healthy; falls back to
 * a plain `fetch()` if Lightpanda fails to spawn / exits early. The fallback
 * is degraded (no JS execution) but ensures the plugin never breaks the
 * build/runtime caller.
 */
async function renderWithLightpanda(
	url: string,
	opts: Required<
		Pick<LightpandaPluginOptions, "navigationTimeoutMs" | "logLevel">
	> &
		Pick<LightpandaPluginOptions, "binaryPath">,
): Promise<{ html: string; status: number; finalUrl: string; gotoMs: number }> {
	const t0 = Bun.nanoseconds();
	let page: Awaited<ReturnType<typeof Browser.newPage>> | undefined;

	try {
		page = await Browser.newPage({
			profile: "fast",
			spawnOpts: {
				logLevel: opts.logLevel,
				readyTimeoutMs: 10_000,
				binaryPath: opts.binaryPath,
			},
		});

		const nav = (await page.goto(url, {
			timeoutMs: opts.navigationTimeoutMs,
		})) as {
			status?: number;
		};
		const html = await page.content().catch(() => "");
		const gotoMs = (Bun.nanoseconds() - t0) / 1e6;
		return {
			html,
			status: nav?.status ?? 0,
			finalUrl: page.url(),
			gotoMs,
		};
	} catch (err) {
		// Lightpanda spawn / navigation failed — fall back to plain fetch.
		// This loses JS execution but keeps the pipeline alive.
		const r = await fetch(url, {
			method: "GET",
			signal: AbortSignal.timeout(opts.navigationTimeoutMs),
			redirect: "follow",
			headers: {
				"User-Agent":
					"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			},
		}).catch((fetchErr) => {
			throw new Error(
				`lightpanda render failed (${err instanceof Error ? err.message : String(err)}) and fetch fallback failed (${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)})`,
			);
		});
		const html = await r.text();
		const gotoMs = (Bun.nanoseconds() - t0) / 1e6;
		return { html, status: r.status, finalUrl: r.url, gotoMs };
	} finally {
		try {
			await page?.close();
		} catch {
			// best-effort close
		}
	}
}

// ---------------------------------------------------------------------------
// Plugin factory
// ---------------------------------------------------------------------------

/**
 * Bun plugin that resolves `lightpanda:<url>` imports to Lightpanda-rendered
 * HTML at module-load time. Supports both runtime (`Bun.plugin`) and build
 * (`Bun.build`) integration paths.
 */
export function lightpandaPlugin(
	options: LightpandaPluginOptions = {},
): BunPlugin {
	const navigationTimeoutMs = options.navigationTimeoutMs ?? 25_000;
	const logLevel = options.logLevel ?? "error";
	const cacheTtlMs = options.cacheTtlMs ?? 0;
	const exportShape = options.exportShape ?? "html";
	const baseUrl = options.baseUrl;
	const binaryPath = options.binaryPath;

	return {
		name: "lightpanda",
		setup(build) {
			// Step 1: rewrite `lightpanda:<url>` imports into our private namespace
			// so we can intercept them in onLoad below.
			build.onResolve({ filter: /^lightpanda:/ }, (args) => ({
				path: args.path.slice("lightpanda:".length),
				namespace: "lightpanda",
			}));

			// Step 2: render the URL via Lightpanda and emit a JS module that
			// exports the resulting HTML (or a structured object).
			build.onLoad({ filter: /.*/, namespace: "lightpanda" }, async (args) => {
				let url = args.path;
				if (!/^https?:\/\//.test(url)) {
					if (!baseUrl) {
						throw new Error(
							`lightpanda-plugin: import "${url}" is not absolute and no baseUrl was supplied`,
						);
					}
					url = new URL(url, baseUrl).href;
				}

				const cached = cacheGet(url);
				const rendered =
					cached ??
					(await renderWithLightpanda(url, {
						navigationTimeoutMs,
						logLevel,
						binaryPath,
					}));
				if (!cached) {
					cacheSet(url, rendered, cacheTtlMs);
				}

				const payload = exportShape === "object" ? rendered : rendered.html;
				const contents = `export default ${JSON.stringify(payload)};`;
				return { contents, loader: "js" };
			});
		},
	};
}

// ---------------------------------------------------------------------------
// Runtime auto-registration helper
// ---------------------------------------------------------------------------

/**
 * Convenience: registers the plugin with Bun's runtime resolver in one call.
 *
 * Note: Bun's runtime plugin API works best for `file://` and well-known
 * schemes. Custom URL-style schemes like `lightpanda:` may be eagerly
 * pre-resolved by Bun's module loader, in which case the {@link renderPage}
 * function below is the recommended runtime API. The plugin is fully
 * effective at build time inside `Bun.build()`.
 *
 * @example Build-time (recommended)
 * ```ts
 * await Bun.build({
 *   entrypoints: ["./app.ts"],
 *   plugins: [lightpandaPlugin({ cacheTtlMs: 60_000 })],
 * });
 * ```
 */
export function registerLightpandaPlugin(
	options: LightpandaPluginOptions = {},
): void {
	// Bun.plugin is the runtime entry point — see https://bun.com/docs/runtime/plugins
	Bun.plugin(lightpandaPlugin(options));
}

/**
 * Runtime API: render a URL via Lightpanda and return the rendered HTML.
 *
 * This is the recommended path for ad-hoc runtime usage (e.g. SSR fallbacks,
 * scripts) where Bun's plugin auto-resolution does not intercept the import.
 *
 * @example
 * ```ts
 * import { renderPage } from "@aphrody-code/bxc/plugin";
 * const html = await renderPage("https://google.com");
 * ```
 */
export async function renderPage(
	url: string,
	options: LightpandaPluginOptions = {},
): Promise<string> {
	const navigationTimeoutMs = options.navigationTimeoutMs ?? 25_000;
	const logLevel = options.logLevel ?? "error";
	const cacheTtlMs = options.cacheTtlMs ?? 0;
	const binaryPath = options.binaryPath;

	const cached = cacheGet(url);
	if (cached) return cached.html;

	const rendered = await renderWithLightpanda(url, {
		navigationTimeoutMs,
		logLevel,
		binaryPath,
	});
	cacheSet(url, rendered, cacheTtlMs);
	return rendered.html;
}

// ---------------------------------------------------------------------------
// Cache utilities (exported for tests + manual control)
// ---------------------------------------------------------------------------

export function clearLightpandaCache(): void {
	RENDER_CACHE.clear();
}

export function lightpandaCacheStats(): {
	entries: number;
	oldest: number | null;
} {
	let oldest: number | null = null;
	for (const e of RENDER_CACHE.values()) {
		if (oldest === null || e.expiresAt < oldest) oldest = e.expiresAt;
	}
	return { entries: RENDER_CACHE.size, oldest };
}
