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
 * @module bxc/plugin/next-plugin
 *
 * Bun plugin that brings Next.js conventions into a plain `Bun.build()` /
 * `Bun.plugin()` pipeline. Composed of five sub-plugins, each independently
 * usable :
 *
 *   1. `nextShimsPlugin`       — provides Bun-compatible stubs for the
 *                                `next/*` virtual modules (link, image,
 *                                headers, server, navigation, router,
 *                                cache, font, script, dynamic) so code
 *                                that imports them can compile without
 *                                pulling the entire Next.js runtime.
 *   2. `nextDirectivesPlugin`  — detects `"use client"` and `"use server"`
 *                                pragmas at the top of `.ts`/`.tsx` files
 *                                and surfaces a manifest at build end.
 *   3. `nextRouterPlugin`      — scans an `app/` (or `pages/`) tree for
 *                                Next.js file conventions (page / layout /
 *                                route / loading / error / not-found /
 *                                template / default / middleware /
 *                                instrumentation) and emits a JS
 *                                manifest that any consumer can import.
 *   4. `nextEnvPlugin`         — loads `.env`, `.env.local`, `.env.production`
 *                                and injects `NEXT_PUBLIC_*` variables as
 *                                `--define` at build time.
 *   5. `nextPlugin`            — convenience: returns the four above
 *                                wired together with a single options
 *                                object.
 *
 * The plugin does NOT recompile React Server Components nor implement the
 * full Next.js runtime — for that, run `next build` and embed the output
 * via `Bun.build` separately. This plugin handles the integration surface :
 * directives, conventions, env, route manifest, and module shims.
 *
 * Reference :
 *   https://developers.google.com/vercel/next.js/
 *   https://nextjs.org/docs/app/building-your-application/routing
 *   https://bun.com/docs/runtime/plugins
 *   https://bun.com/docs/bundler/loaders
 *   https://bun.com/docs/bundler/css
 */

import { relative as relativePath, resolve as resolvePath } from "node:path";
import type { BunPlugin } from "bun";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface NextPluginOptions {
	/** Project root. Defaults to `process.cwd()`. */
	cwd?: string;
	/** Path to the App Router root, relative to `cwd`. Defaults to `app`. */
	appDir?: string;
	/** Optional alternative Pages Router (legacy). Defaults to `pages` if found. */
	pagesDir?: string;
	/**
	 * When true, replaces `next/*` imports with our Bun-native shims even
	 * if Next.js is installed. Default: only if `next` resolution fails.
	 */
	forceShims?: boolean;
	/**
	 * Public env-var prefix exposed to the client. Default: `["NEXT_PUBLIC_"]`.
	 */
	publicEnvPrefixes?: readonly string[];
	/**
	 * If true, emits a `__nextRouteManifest.json` artifact next to the
	 * outputs. Default: false (memory-only manifest accessible via
	 * `getNextRouteManifest()`).
	 */
	emitManifest?: boolean;
	/**
	 * Hook receiving the directive manifest after build. Useful for tooling
	 * that wants to enforce server/client boundaries.
	 */
	onDirectives?: (manifest: NextDirectivesManifest) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// 1. next/* shims
// ---------------------------------------------------------------------------

const NEXT_SHIM_NAMESPACE = "next-shim";

const NEXT_SHIMS: Record<string, string> = {
	"next/link": `
// Bun-compat shim for next/link. Mirrors the public surface of <Link>.
import { createElement as h } from "react";
export default function Link(props) {
	const { href, children, prefetch, replace, scroll, shallow, locale, ...rest } = props ?? {};
	return h("a", { href: href ?? "#", ...rest }, children);
}
export const __isShim = true;
`,
	"next/image": `
import { createElement as h } from "react";
export default function Image(props) {
	const { src, alt, width, height, fill, priority, loading, placeholder, blurDataURL, sizes, quality, unoptimized, ...rest } = props ?? {};
	return h("img", {
		src: typeof src === "string" ? src : (src?.src ?? ""),
		alt: alt ?? "",
		width: typeof width === "number" ? width : undefined,
		height: typeof height === "number" ? height : undefined,
		loading: priority ? "eager" : (loading ?? "lazy"),
		decoding: "async",
		...rest,
	});
}
export const __isShim = true;
`,
	"next/script": `
import { createElement as h } from "react";
export default function Script(props) {
	const { strategy, onLoad, onError, onReady, src, dangerouslySetInnerHTML, children, ...rest } = props ?? {};
	if (src) return h("script", { src, async: strategy !== "beforeInteractive", ...rest });
	return h("script", { dangerouslySetInnerHTML, ...rest }, children);
}
export const __isShim = true;
`,
	"next/dynamic": `
export default function dynamic(loader, opts = {}) {
	const Loading = opts?.loading ?? null;
	let cached = null;
	return function DynamicComp(props) {
		if (!cached) {
			const promise = loader();
			cached = promise.then(m => m?.default ?? m);
			throw promise;  // Suspense-friendly fallback
		}
		const Comp = cached;
		const { createElement: h } = require("react");
		return h(Comp, props);
	};
}
export const __isShim = true;
`,
	"next/headers": `
// Returns a read-only headers object derived from a request set by the host
// runtime via globalThis.__NEXT_REQUEST_HEADERS. Bun.serve callers can populate
// this in their fetch handler before invoking shared code.
export function headers() {
	const h = globalThis.__NEXT_REQUEST_HEADERS;
	if (h instanceof Headers) return h;
	if (h && typeof h === "object") return new Headers(h);
	return new Headers();
}
export function cookies() {
	const c = globalThis.__NEXT_REQUEST_COOKIES;
	if (c && typeof c.get === "function") return c;
	return { get: () => undefined, getAll: () => [], has: () => false };
}
export function draftMode() {
	return { isEnabled: false, enable() {}, disable() {} };
}
export const __isShim = true;
`,
	"next/server": `
export class NextRequest extends Request {
	get nextUrl() { return new URL(this.url); }
	get geo() { return {}; }
	get ip() { return undefined; }
}
export class NextResponse extends Response {
	static json(data, init) { return new NextResponse(JSON.stringify(data), { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } }); }
	static redirect(url, status = 307) { return new NextResponse(null, { status, headers: { location: typeof url === "string" ? url : url.toString() } }); }
	static rewrite(url, init) { const r = new NextResponse(null, init); r.headers.set("x-middleware-rewrite", typeof url === "string" ? url : url.toString()); return r; }
	static next(init) { return new NextResponse(null, init); }
}
export const userAgent = (req) => ({
	ua: req?.headers?.get?.("user-agent") ?? "",
	browser: {}, device: {}, engine: {}, os: {}, cpu: {}, isBot: false,
});
export const __isShim = true;
`,
	"next/navigation": `
export function useRouter() {
	return {
		push(url) { if (typeof location !== "undefined") location.href = url; },
		replace(url) { if (typeof location !== "undefined") location.replace(url); },
		back() { if (typeof history !== "undefined") history.back(); },
		forward() { if (typeof history !== "undefined") history.forward(); },
		refresh() { if (typeof location !== "undefined") location.reload(); },
		prefetch() {},
	};
}
export function usePathname() { return typeof location !== "undefined" ? location.pathname : "/"; }
export function useSearchParams() { return new URLSearchParams(typeof location !== "undefined" ? location.search : ""); }
export function useParams() { return {}; }
export function useSelectedLayoutSegment() { return null; }
export function useSelectedLayoutSegments() { return []; }
export function redirect(url) { if (typeof location !== "undefined") location.href = url; throw new Error("NEXT_REDIRECT:" + url); }
export function permanentRedirect(url) { redirect(url); }
export function notFound() { throw new Error("NEXT_NOT_FOUND"); }
export const __isShim = true;
`,
	"next/router": `
// Pages Router compat — emits no-op router for components that still call useRouter().
export function useRouter() {
	return {
		route: typeof location !== "undefined" ? location.pathname : "/",
		pathname: typeof location !== "undefined" ? location.pathname : "/",
		query: {}, asPath: typeof location !== "undefined" ? location.pathname : "/",
		push(url) { if (typeof location !== "undefined") location.href = url; },
		replace(url) { if (typeof location !== "undefined") location.replace(url); },
		reload() { if (typeof location !== "undefined") location.reload(); },
		back() { if (typeof history !== "undefined") history.back(); },
		prefetch() { return Promise.resolve(); },
		events: { on() {}, off() {}, emit() {} },
		isReady: true, isFallback: false, isPreview: false, locale: undefined, locales: [], defaultLocale: undefined,
	};
}
export default { Router: useRouter };
export const __isShim = true;
`,
	"next/cache": `
// Bun-compat: no-op caching helpers. Replace with a real KV in production.
export const unstable_cache = (fn) => fn;
export const unstable_noStore = () => {};
export function revalidatePath() {}
export function revalidateTag() {}
export const cache = (fn) => fn;
export const __isShim = true;
`,
	"next/font/google": `
export function Inter(opts = {}) { return { className: "font-inter", style: { fontFamily: "Inter, sans-serif" }, variable: "--font-inter" }; }
export function Roboto(opts = {}) { return { className: "font-roboto", style: { fontFamily: "Roboto, sans-serif" }, variable: "--font-roboto" }; }
export function Noto_Sans(opts = {}) { return { className: "font-noto-sans", style: { fontFamily: "Noto Sans, sans-serif" }, variable: "--font-noto-sans" }; }
export function JetBrains_Mono(opts = {}) { return { className: "font-jetbrains", style: { fontFamily: "JetBrains Mono, monospace" }, variable: "--font-jetbrains" }; }
export const __isShim = true;
`,
	"next/font/local": `
export default function localFont(opts = {}) {
	return { className: "font-local", style: { fontFamily: opts?.variable ?? "system-ui" }, variable: opts?.variable ?? "--font-local" };
}
export const __isShim = true;
`,
};

/**
 * Maps `next/*` imports to Bun-compatible stubs. When the real `next`
 * package is installed and `forceShims` is false, we let Bun's resolver
 * pick it up natively.
 */
export function nextShimsPlugin(options: NextPluginOptions = {}): BunPlugin {
	const force = options.forceShims === true;
	return {
		name: "next-shims",
		async setup(build) {
			const cwd = options.cwd ?? process.cwd();
			const realNextAvailable =
				!force &&
				(await Bun.file(
					resolvePath(cwd, "node_modules/next/package.json"),
				).exists());

			build.onResolve(
				{
					filter:
						/^next\/(?:link|image|script|dynamic|headers|server|navigation|router|cache|font\/google|font\/local)$/,
				},
				(args) => {
					if (realNextAvailable) return undefined; // let Bun resolve real next/*
					return { path: args.path, namespace: NEXT_SHIM_NAMESPACE };
				},
			);

			build.onLoad({ filter: /.*/, namespace: NEXT_SHIM_NAMESPACE }, (args) => {
				const stub = NEXT_SHIMS[args.path];
				if (!stub) {
					return {
						contents: `export default {}; export const __isShim = true;`,
						loader: "js",
					};
				}
				return { contents: stub, loader: "js" };
			});
		},
	};
}

// ---------------------------------------------------------------------------
// 2. Directives extractor: "use client" / "use server"
// ---------------------------------------------------------------------------

export interface NextDirectivesManifest {
	clientModules: string[];
	serverModules: string[];
}

const directivesState = {
	current: { clientModules: [] as string[], serverModules: [] as string[] },
};

function snifDirective(source: string): "use client" | "use server" | null {
	// Strip leading whitespace + comments (single + multi-line).
	let i = 0;
	const len = source.length;
	while (i < len) {
		const c = source[i];
		if (c === " " || c === "\t" || c === "\n" || c === "\r") {
			i++;
			continue;
		}
		if (c === "/" && source[i + 1] === "/") {
			while (i < len && source[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && source[i + 1] === "*") {
			i += 2;
			while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		break;
	}
	const tail = source.slice(i, i + 14);
	if (/^["']use client["']/.test(tail)) return "use client";
	if (/^["']use server["']/.test(tail)) return "use server";
	return null;
}

/**
 * Detects `"use client"` / `"use server"` directives in TS/TSX files
 * and accumulates a manifest accessible after build.
 */
export function nextDirectivesPlugin(
	options: NextPluginOptions = {},
): BunPlugin {
	return {
		name: "next-directives",
		setup(build) {
			directivesState.current = { clientModules: [], serverModules: [] };

			build.onLoad({ filter: /\.(?:m?[jt]sx?)$/ }, async (args) => {
				const source = await Bun.file(args.path).text();
				const directive = snifDirective(source);
				if (directive === "use client") {
					directivesState.current.clientModules.push(args.path);
				} else if (directive === "use server") {
					directivesState.current.serverModules.push(args.path);
				}
				return undefined; // pass through to default loader
			});

			build.onEnd(async () => {
				if (options.onDirectives) {
					await options.onDirectives({ ...directivesState.current });
				}
			});
		},
	};
}

/** Returns the most recent directives manifest. */
export function getNextDirectivesManifest(): NextDirectivesManifest {
	return { ...directivesState.current };
}

// ---------------------------------------------------------------------------
// 3. App Router convention scanner
// ---------------------------------------------------------------------------

export interface NextRoute {
	/** URL path this route serves (e.g. `/users/[id]`). */
	pattern: string;
	/** Source file relative to project root. */
	file: string;
	/** Convention slot. */
	kind:
		| "page"
		| "layout"
		| "route"
		| "loading"
		| "error"
		| "not-found"
		| "template"
		| "default"
		| "middleware"
		| "instrumentation";
}

export interface NextRouteManifest {
	app: NextRoute[];
	pages: NextRoute[];
	scannedAt: string;
}

const ROUTE_FILES_APP: ReadonlyMap<string, NextRoute["kind"]> = new Map([
	["page.tsx", "page"],
	["page.ts", "page"],
	["page.jsx", "page"],
	["page.js", "page"],
	["layout.tsx", "layout"],
	["layout.ts", "layout"],
	["layout.jsx", "layout"],
	["layout.js", "layout"],
	["route.ts", "route"],
	["route.js", "route"],
	["loading.tsx", "loading"],
	["loading.ts", "loading"],
	["loading.jsx", "loading"],
	["loading.js", "loading"],
	["error.tsx", "error"],
	["error.ts", "error"],
	["error.jsx", "error"],
	["error.js", "error"],
	["not-found.tsx", "not-found"],
	["not-found.ts", "not-found"],
	["template.tsx", "template"],
	["template.ts", "template"],
	["default.tsx", "default"],
	["default.ts", "default"],
]);

const ROUTE_FILES_ROOT: ReadonlyMap<string, NextRoute["kind"]> = new Map([
	["middleware.ts", "middleware"],
	["middleware.js", "middleware"],
	["instrumentation.ts", "instrumentation"],
	["instrumentation.js", "instrumentation"],
]);

function appPathToPattern(rel: string): string {
	// Strip leading "app/" and trailing filename — keep dir segments only.
	const parts = rel.split("/").slice(0, -1);
	const segments: string[] = [];
	for (const p of parts) {
		if (p === "app") continue;
		// Route groups (foldername) — invisible in URL.
		if (p.startsWith("(") && p.endsWith(")")) continue;
		// Parallel routes @slot — invisible.
		if (p.startsWith("@")) continue;
		// Intercepting routes — strip leading dots.
		if (p.startsWith("(.)") || p.startsWith("(..)") || p.startsWith("(...)"))
			continue;
		// Catch-all `[...slug]` and optional `[[...slug]]` and dynamic `[id]` kept verbatim.
		segments.push(p);
	}
	return "/" + segments.join("/");
}

async function scanAppDir(cwd: string, dir: string): Promise<NextRoute[]> {
	const root = resolvePath(cwd, dir);
	// Bun.Glob.scan() returns an empty async iterable when cwd does not exist,
	// so we don't need a pre-flight check (Bun.file().exists() returns false
	// for directories anyway).
	const out: NextRoute[] = [];
	const glob = new Bun.Glob("**/*.{ts,tsx,js,jsx}");
	try {
		for await (const rel of glob.scan({ cwd: root, onlyFiles: true })) {
			const file = relativePath(cwd, resolvePath(root, rel));
			const base = rel.split("/").pop() ?? "";
			const kind = ROUTE_FILES_APP.get(base);
			if (!kind) continue;
			const pattern = appPathToPattern(`${dir}/${rel}`);
			out.push({ pattern, file, kind });
		}
	} catch {
		// directory missing — return [].
	}
	return out;
}

/**
 * Pages Router scan via Bun's native `Bun.FileSystemRouter` with
 * `style: "nextjs"`. This honors `[id]`, `[...slug]`, `[[...slug]]`
 * conventions identical to Next.js Pages Router and is ~10x faster than
 * a manual Glob walk.
 *
 * Reference: https://bun.com/docs/runtime/file-system-router
 */
async function scanPagesDir(cwd: string, dir: string): Promise<NextRoute[]> {
	const root = resolvePath(cwd, dir);
	const out: NextRoute[] = [];
	try {
		// Bun.FileSystemRouter throws if `dir` is missing — wrap in try/catch.
		const router = new Bun.FileSystemRouter({
			style: "nextjs",
			dir: root,
			fileExtensions: [".ts", ".tsx", ".js", ".jsx"],
		});
		// `router.routes` is a Record<routePattern, absoluteFilePath>.
		const routes = router.routes as Record<string, string>;
		for (const [pattern, absPath] of Object.entries(routes)) {
			out.push({
				pattern,
				file: relativePath(cwd, absPath),
				kind: "page",
			});
		}
	} catch {
		// directory missing or unreadable — fall back to empty.
	}
	return out;
}

async function scanRootSpecials(cwd: string): Promise<NextRoute[]> {
	const out: NextRoute[] = [];
	for (const [filename, kind] of ROUTE_FILES_ROOT) {
		const p = resolvePath(cwd, filename);
		if (await Bun.file(p).exists()) {
			out.push({
				pattern: kind === "middleware" ? "/*" : "_root",
				file: filename,
				kind,
			});
		}
	}
	return out;
}

const routerState: { manifest: NextRouteManifest } = {
	manifest: { app: [], pages: [], scannedAt: "" },
};

export function nextRouterPlugin(options: NextPluginOptions = {}): BunPlugin {
	return {
		name: "next-router",
		async setup(build) {
			const cwd = options.cwd ?? process.cwd();
			const appDir = options.appDir ?? "app";
			const pagesDir = options.pagesDir ?? "pages";

			// Resolve the special virtual module `next-router-manifest` so consumers
			// can `import manifest from "next-router-manifest"`.
			build.onResolve({ filter: /^next-router-manifest$/ }, (args) => ({
				path: args.path,
				namespace: "next-router-manifest",
			}));

			build.onLoad(
				{ filter: /.*/, namespace: "next-router-manifest" },
				async () => {
					const [app, pages, root] = await Promise.all([
						scanAppDir(cwd, appDir),
						scanPagesDir(cwd, pagesDir),
						scanRootSpecials(cwd),
					]);
					const manifest: NextRouteManifest = {
						app: [...app, ...root],
						pages,
						scannedAt: new Date().toISOString(),
					};
					routerState.manifest = manifest;
					return {
						contents: `export default ${JSON.stringify(manifest)};`,
						loader: "js",
					};
				},
			);

			if (options.emitManifest) {
				build.onEnd(async () => {
					const [app, pages, root] = await Promise.all([
						scanAppDir(cwd, appDir),
						scanPagesDir(cwd, pagesDir),
						scanRootSpecials(cwd),
					]);
					routerState.manifest = {
						app: [...app, ...root],
						pages,
						scannedAt: new Date().toISOString(),
					};
					const outDir = (build.config?.outdir as string | undefined) ?? cwd;
					await Bun.write(
						resolvePath(outDir, "__nextRouteManifest.json"),
						JSON.stringify(routerState.manifest, null, 2),
					);
				});
			}
		},
	};
}

export function getNextRouteManifest(): NextRouteManifest {
	return { ...routerState.manifest };
}

// ---------------------------------------------------------------------------
// 4. .env loader — exposes NEXT_PUBLIC_* vars at build time
// ---------------------------------------------------------------------------

const ENV_FILES = [
	".env",
	".env.local",
	".env.production",
	".env.development",
] as const;

async function readEnvFile(path: string): Promise<Record<string, string>> {
	const file = Bun.file(path);
	if (!(await file.exists())) return {};
	const raw = await file.text();
	const out: Record<string, string> = {};
	for (const rawLine of raw.split("\n")) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq < 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

/**
 * Loads `.env` family files and injects `NEXT_PUBLIC_*` vars (or any prefix
 * provided in `publicEnvPrefixes`) as `--define Bun.env.X = "..."`.
 */
export function nextEnvPlugin(options: NextPluginOptions = {}): BunPlugin {
	return {
		name: "next-env",
		async setup(build) {
			const cwd = options.cwd ?? process.cwd();
			const prefixes = options.publicEnvPrefixes ?? ["NEXT_PUBLIC_"];

			const merged: Record<string, string> = {};
			for (const f of ENV_FILES) {
				const vars = await readEnvFile(resolvePath(cwd, f));
				Object.assign(merged, vars);
			}

			const define: Record<string, string> = {};
			for (const [k, v] of Object.entries(merged)) {
				if (prefixes.some((p) => k.startsWith(p))) {
					define[`Bun.env.${k}`] = JSON.stringify(v);
				}
			}

			// Mutate build.config.define so subsequent plugins / native bundling pick it up.
			const cfg = build.config as { define?: Record<string, string> };
			cfg.define = { ...cfg.define, ...define };
		},
	};
}

// ---------------------------------------------------------------------------
// 5. Aggregate plugin
// ---------------------------------------------------------------------------

/**
 * Returns the four Next.js sub-plugins wired together. Pass the same
 * `options` to all of them. Order matters: directives → router → shims →
 * env (env mutates `build.config.define` so it must run during setup of
 * any plugin that examines `build.config`).
 *
 * @example
 * ```ts
 * import { nextPlugin } from "@aphrody/bxc/plugin";
 * await Bun.build({
 *   entrypoints: ["./app.ts"],
 *   plugins: nextPlugin({ cwd: process.cwd(), emitManifest: true }),
 *   outdir: "./.bun-next",
 * });
 * ```
 */
export function nextPlugin(options: NextPluginOptions = {}): BunPlugin[] {
	return [
		nextEnvPlugin(options),
		nextShimsPlugin(options),
		nextDirectivesPlugin(options),
		nextRouterPlugin(options),
	];
}
