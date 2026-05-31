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
 * @module bxc/detect
 *
 * Framework / CMS / library / waf detection backed by the
 * `projectdiscovery/wappalyzergo` Go library.
 */

import { resolve } from "node:path";
import { detectGoogleSpecifics, googleToTech } from "./google/index.ts";
import { bxcFetch } from "./utils/bxc-fetch.ts";
import { hasEmbedded, wappalyzergoAsset } from "./rust/embedded-assets.ts";
import { extractEmbeddedAssetIfNeeded } from "./internal/embedded-loader.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectedTech {
	name: string;
	version?: string;
	categories: string[];
	description?: string;
	website?: string;
	cpe?: string;
	icon?: string;
}

export type AnyHeaders =
	| Headers
	| Map<string, string>
	| Record<string, string | string[]>;

export type DetectInput =
	| string
	| { url?: string; html: string; headers?: AnyHeaders };

export interface DetectOptions {
	binaryPath?: string;
	timeoutMs?: number;
	userAgent?: string;
	processTimeoutMs?: number;
	insecure?: boolean;
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

const HERE = import.meta.dir;

export async function resolveBinary(): Promise<string> {
	const fromEnv = Bun.env.BXC_WAPPALYZERGO_BIN;
	if (fromEnv && (await Bun.file(fromEnv).exists())) return fromEnv;

	if (hasEmbedded && wappalyzergoAsset) {
		try {
			const extracted = extractEmbeddedAssetIfNeeded(wappalyzergoAsset, "wappalyzergo-cli", true);
			if (extracted && (await Bun.file(extracted).exists())) {
				return extracted;
			}
		} catch (err) {
			console.warn(`[bxc] Failed to load/extract embedded wappalyzergo-cli:`, err);
		}
	}

	const candidate = resolve(
		HERE,
		"..",
		"vendor",
		"wappalyzergo",
		"wappalyzergo-cli",
	);
	if (await Bun.file(candidate).exists()) return candidate;

	for (const rel of [
		"vendor/wappalyzergo/wappalyzergo-cli",
		"../vendor/wappalyzergo/wappalyzergo-cli",
	]) {
		const p = resolve(process.cwd(), rel);
		if (await Bun.file(p).exists()) return p;
	}

	throw new Error(`bxc/detect: wappalyzergo-cli binary not found.`);
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
		h.forEach((v, k) => push(k, v));
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
			proc.kill(9);
		} catch {}
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

	return { stdout, stderr, code: code ?? -1 };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function detectFrameworks(
	input: DetectInput,
	opts: DetectOptions = {},
): Promise<DetectedTech[]> {
	const bin = opts.binaryPath ?? (await resolveBinary());
	const processTimeoutMs = opts.processTimeoutMs ?? 30_000;

	let result: RunResult;
	if (typeof input === "string") {
		// Use bxcFetch for the underlying GET
		const r = await bxcFetch(input, {
			insecure: opts.insecure,
			timeoutMs: opts.timeoutMs ?? 15_000,
			userAgent: opts.userAgent,
		});
		const html = await r.text();
		const headers = normalizeHeaders(r.headers);
		const payload = JSON.stringify({ url: input, html, headers });
		result = await runCli(bin, ["--stdin"], payload, processTimeoutMs);
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
			`wappalyzergo-cli exited with code ${result.code}: ${result.stderr.trim()}`,
		);
	}

	const trimmed = result.stdout.trim();
	let parsed: DetectedTech[] = [];

	if (trimmed) {
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			throw new Error(`wappalyzergo-cli returned invalid JSON`);
		}
	}

	// Enrich with Google-specific signals
	const url = typeof input === "string" ? input : (input.url ?? "");
	const html = typeof input === "string" ? "" : input.html;
	const headersObj =
		typeof input === "string" ? {} : normalizeHeaders(input.headers);

	const googleSignals = detectGoogleSpecifics(
		url,
		new Map(Object.entries(headersObj).map(([k, v]) => [k, v.join(", ")])),
		html,
	);
	const googleTechs = googleToTech(googleSignals);
	for (const gt of googleTechs) {
		if (!parsed.find((t) => t.name.toLowerCase() === gt.name.toLowerCase())) {
			parsed.push(gt);
		}
	}

	return Array.isArray(parsed) ? parsed : [];
}

export interface PageLike {
	url(): string;
	content(): Promise<string>;
}

export async function detectFromPage(
	page: PageLike,
	opts: DetectOptions = {},
): Promise<DetectedTech[]> {
	const [url, html] = await Promise.all([
		Promise.resolve(page.url()),
		page.content(),
	]);
	return detectFrameworks({ url, html, headers: {} }, opts);
}

export function hasAnyTech(
	detected: DetectedTech[],
	names: readonly string[],
): boolean {
	const wanted = new Set(names.map((n) => n.toLowerCase()));
	return detected.some((t) => wanted.has(t.name.toLowerCase()));
}

export function hasAnyCategory(
	detected: DetectedTech[],
	categories: readonly string[],
): boolean {
	const wanted = new Set(categories.map((c) => c.toLowerCase()));
	return detected.some((t) =>
		t.categories.some((c) => wanted.has(c.toLowerCase())),
	);
}
