/**
 * @module bunlight/detect
 *
 * Framework / CMS / library / waf detection backed by the
 * `projectdiscovery/wappalyzergo` Go library, vendored as a small CLI binary
 * at `vendor/wappalyzergo/wappalyzergo-cli`.
 *
 * Two ways to call the detector :
 *
 *   1. {@link detectFrameworks} — pass either a URL string (the binary will
 *      fetch it itself with a generic User-Agent) or `{ html, headers }` to
 *      reuse a response already gathered by `Browser.newPage()`.
 *
 *   2. {@link detectFromPage} — convenience wrapper that takes a Bunlight
 *      `Page` (or anything with `.url()` + `.content()`) and runs the
 *      detector on the rendered HTML. This works across every profile
 *      (`static`, `fast`, `stealth`, `max`) because it only relies on the
 *      public `Page` surface.
 *
 * @example
 * ```ts
 * import { detectFrameworks, detectFromPage } from "bunlight/detect";
 * import { Browser } from "bunlight/browser";
 *
 * // Direct URL fetch (no JS rendering — uses Go's net/http).
 * const tech = await detectFrameworks("https://nextjs.org");
 *
 * // From an already-rendered Page (preferred for SPAs).
 * const page = await Browser.newPage({ profile: "fast" });
 * await page.goto("https://nextjs.org");
 * const tech2 = await detectFromPage(page);
 * ```
 */

import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single technology fingerprinted on a target. */
export interface DetectedTech {
	/** Canonical technology name (e.g. "Next.js", "Cloudflare", "WordPress"). */
	name: string;
	/** Detected version, if the fingerprint exposed it. */
	version?: string;
	/** Wappalyzer category names (e.g. ["JavaScript frameworks"]). */
	categories: string[];
	/** Short human description from the fingerprint catalog. */
	description?: string;
	/** Vendor / project website. */
	website?: string;
	/** CPE identifier when available. */
	cpe?: string;
	/** Icon filename (relative to the wappalyzer icons folder). */
	icon?: string;
}

/** Headers may be a plain object, `Headers`, or a `Map`. */
export type AnyHeaders = Headers | Map<string, string> | Record<string, string | string[]>;

/** Input for {@link detectFrameworks}. */
export type DetectInput = string | { url?: string; html: string; headers?: AnyHeaders };

/** Optional knobs for {@link detectFrameworks}. */
export interface DetectOptions {
	/** Override the path to the `wappalyzergo-cli` binary. */
	binaryPath?: string;
	/** HTTP timeout for URL mode (default 15s). */
	timeoutMs?: number;
	/** User-Agent for URL mode. */
	userAgent?: string;
	/** Hard cap on the time we wait for the CLI subprocess (default 30s). */
	processTimeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

const HERE = import.meta.dir;

/**
 * Resolve the path to the `wappalyzergo-cli` binary. Looks at, in order:
 *   1. The `BUNLIGHT_WAPPALYZERGO_BIN` env var.
 *   2. `<repo>/vendor/wappalyzergo/wappalyzergo-cli`.
 */
export async function resolveBinary(): Promise<string> {
	const fromEnv = process.env.BUNLIGHT_WAPPALYZERGO_BIN;
	if (fromEnv && (await Bun.file(fromEnv).exists())) return fromEnv;

	// `src/detect.ts` lives one level under repo root.
	const candidate = resolve(HERE, "..", "vendor", "wappalyzergo", "wappalyzergo-cli");
	if (await Bun.file(candidate).exists()) return candidate;

	// Fallback : search a few likely locations relative to cwd.
	for (const rel of [
		"vendor/wappalyzergo/wappalyzergo-cli",
		"../vendor/wappalyzergo/wappalyzergo-cli",
	]) {
		const p = resolve(process.cwd(), rel);
		if (await Bun.file(p).exists()) return p;
	}

	throw new Error(
		`bunlight/detect: wappalyzergo-cli binary not found. ` +
			`Build it with \`(cd vendor/wappalyzergo/cli && go build -o ../wappalyzergo-cli)\` ` +
			`or set BUNLIGHT_WAPPALYZERGO_BIN.`,
	);
}

// ---------------------------------------------------------------------------
// Header normalization
// ---------------------------------------------------------------------------

function normalizeHeaders(h: AnyHeaders | undefined): Record<string, string[]> {
	if (!h) return {};
	const out: Record<string, string[]> = {};
	const push = (k: string, v: string) => {
		const key = k.toLowerCase();
		let bucket = out[key];
		if (!bucket) {
			bucket = [];
			out[key] = bucket;
		}
		bucket.push(v);
	};
	if (h instanceof Headers) {
		h.forEach((v, k) => {
			push(k, v);
		});
	} else if (h instanceof Map) {
		for (const [k, v] of h) push(k, v);
	} else {
		for (const [k, v] of Object.entries(h)) {
			if (Array.isArray(v)) for (const x of v) push(k, x);
			else if (v != null) push(k, String(v));
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Subprocess driver
// ---------------------------------------------------------------------------

interface RunResult {
	stdout: string;
	stderr: string;
	code: number;
}

async function runCli(
	bin: string,
	args: string[],
	stdin: string | null,
	timeoutMs: number,
): Promise<RunResult> {
	const proc = Bun.spawn([bin, ...args], {
		stdin: stdin != null ? new TextEncoder().encode(stdin) : "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});

	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const killOnTimeout = () => {
		try {
			proc.kill(9); // SIGKILL
		} catch {
			/* already exited */
		}
	};
	timeoutSignal.addEventListener("abort", killOnTimeout, { once: true });

	let stdout: string;
	let stderr: string;
	let code: number;

	try {
		[stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
	} catch {
		throw new Error(`wappalyzergo-cli timed out after ${timeoutMs}ms`);
	} finally {
		timeoutSignal.removeEventListener("abort", killOnTimeout);
	}

	if (timeoutSignal.aborted) {
		throw new Error(`wappalyzergo-cli timed out after ${timeoutMs}ms`);
	}

	return { stdout, stderr, code: code ?? -1 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fingerprint a remote URL or an already-fetched HTML+headers pair.
 *
 * URL mode performs an HTTP GET inside the Go process. For SPAs that need JS
 * to render their root markup, prefer {@link detectFromPage}.
 *
 * Returns an empty array when no technologies match.
 */
export async function detectFrameworks(
	input: DetectInput,
	opts: DetectOptions = {},
): Promise<DetectedTech[]> {
	const bin = opts.binaryPath ?? (await resolveBinary());
	const processTimeoutMs = opts.processTimeoutMs ?? 30_000;

	let result: RunResult;
	if (typeof input === "string") {
		const args = ["--url", input];
		if (opts.timeoutMs)
			args.push("--timeout", String(Math.max(1, Math.floor(opts.timeoutMs / 1000))));
		if (opts.userAgent) args.push("--user-agent", opts.userAgent);
		result = await runCli(bin, args, null, processTimeoutMs);
	} else {
		const payload = JSON.stringify({
			url: input.url ?? "",
			html: input.html,
			headers: normalizeHeaders(input.headers),
		});
		result = await runCli(bin, ["--stdin"], payload, processTimeoutMs);
	}

	if (result.code !== 0) {
		throw new Error(
			`wappalyzergo-cli exited with code ${result.code}: ${result.stderr.trim() || "<no stderr>"}`,
		);
	}

	const trimmed = result.stdout.trim();
	if (!trimmed) return [];
	try {
		const parsed = JSON.parse(trimmed) as DetectedTech[];
		if (!Array.isArray(parsed)) return [];
		return parsed;
	} catch (err) {
		throw new Error(`wappalyzergo-cli returned invalid JSON: ${(err as Error).message}`);
	}
}

/**
 * Minimal duck-type for what {@link detectFromPage} needs from a Page.
 * Compatible with `bunlight/browser` Pages across every profile.
 */
export interface PageLike {
	url(): string;
	content(): Promise<string>;
}

/**
 * Run framework detection against the rendered HTML of a Bunlight `Page`.
 *
 * Headers from the original navigation are not currently exposed by `Page`,
 * so this call relies purely on the rendered body. For header-only
 * fingerprints (e.g. some CDNs / WAFs), call {@link detectFrameworks} with
 * the URL form, or pass `{ html, headers }` explicitly.
 */
export async function detectFromPage(
	page: PageLike,
	opts: DetectOptions = {},
): Promise<DetectedTech[]> {
	const [url, html] = await Promise.all([Promise.resolve(page.url()), page.content()]);
	return detectFrameworks({ url, html, headers: {} }, opts);
}

// ---------------------------------------------------------------------------
// Helpers — predicates over a list of detected techs
// ---------------------------------------------------------------------------

/** True if any of the provided technology names is present (case insensitive). */
export function hasAnyTech(detected: DetectedTech[], names: readonly string[]): boolean {
	const wanted = new Set(names.map((n) => n.toLowerCase()));
	return detected.some((t) => wanted.has(t.name.toLowerCase()));
}

/** True if any detected tech belongs to one of the provided categories. */
export function hasAnyCategory(detected: DetectedTech[], categories: readonly string[]): boolean {
	const wanted = new Set(categories.map((c) => c.toLowerCase()));
	return detected.some((t) => t.categories.some((c) => wanted.has(c.toLowerCase())));
}
