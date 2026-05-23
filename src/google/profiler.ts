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
 * @module bxc/google/profiler
 *
 * Precision profiler of the Google web stack. For a target property it captures
 * the *real* rendered HTML, the CSS/JS/font asset graph, the network/API
 * surface (XHR/fetch, *.googleapis.com, batchexecute / Boq RPC), the detected
 * frameworks, and the live JS globals — then feeds it all into the
 * self-reinforcing {@link module:bxc/google/corpus | corpus} so the next scrape
 * starts smarter.
 *
 * Profiles run on whichever bxc profile the caller picks; for Google's JS-heavy
 * SPAs (Cloud console, Gemini, Antigravity, Design) the `max` profile (real
 * Chrome) yields the full network graph, while `http`/`static` still give HTML
 * + linked-asset detection without a browser.
 */

import { Browser } from "../api/browser.ts";
import { detectFrameworks } from "../detect.ts";
import { corpusHints, reinforce, type HostKnowledge } from "./corpus.ts";
import { recognizeStack, type StackRecognition } from "./signatures.ts";

/** Canonical Google properties bxc knows how to profile by alias. */
export const GOOGLE_TARGETS: Record<string, string> = {
	"google.com": "https://www.google.com/",
	search: "https://www.google.com/search?q=material+design",
	cloud: "https://cloud.google.com/",
	console: "https://console.cloud.google.com/",
	design: "https://design.google/",
	material: "https://m3.material.io/",
	antigravity: "https://antigravity.google/",
	gemini: "https://gemini.google.com/app",
	aistudio: "https://aistudio.google.com/",
	fonts: "https://fonts.google.com/",
};

export type ResourceKind = "css" | "js" | "font" | "img" | "api" | "doc" | "other";

export interface CapturedResource {
	url: string;
	kind: ResourceKind;
	initiator: string;
}

export interface GoogleProfile {
	target: string;
	url: string;
	finalUrl: string;
	capturedAt: string;
	profile: string;
	status: number;
	htmlBytes: number;
	title: string;
	frameworks: string[];
	/** Live `window` globals that identify the stack. */
	globals: string[];
	css: string[];
	js: string[];
	fonts: string[];
	/** Network/API endpoints (deduped, query-stripped patterns). */
	apis: string[];
	headers: Record<string, string>;
	/** High-confidence Google-stack recognition (Gemini app, M3, Boq, models…). */
	recognized: StackRecognition;
	/** What bxc already knew about this host before this run. */
	priorHints: { apis: string[]; frameworks: string[]; globals: string[] };
	/** The host knowledge after reinforcing with this run. */
	knowledge: HostKnowledge;
}

type ScrapeProfile = "static" | "fast" | "http" | "stealth" | "max";

interface ProfileOptions {
	profile?: ScrapeProfile;
	timeoutMs?: number;
	insecure?: boolean;
	/** Reuse a logged-in Chrome profile for the `max` path (e.g. "Profile 5"). */
	chromeProfile?: string;
	/**
	 * Snapshot the logged-in profile into a throwaway user-data-dir for the `max`
	 * path so capture works even while the user's Chrome is open. Defaults to
	 * `true` whenever a `chromeProfile` is given. Set `false` to attach to the
	 * real dir (requires the user's Chrome to be closed).
	 */
	copyProfile?: boolean;
	/**
	 * Milliseconds to let the resource graph settle after navigation on
	 * browser-backed profiles before probing (default 3000). Larger values
	 * capture more lazily-loaded CSS/JS/XHR.
	 */
	settleMs?: number;
}

/** In-page probe: serialized to a string and run via `page.evaluate`. */
function pageProbe(): {
	resources: { name: string; type: string }[];
	globals: string[];
	title: string;
	wiz: boolean;
} {
	// eslint-disable-next-line no-undef -- runs in the page, not in Bun
	const w = globalThis as unknown as Record<string, unknown> & {
		performance?: { getEntriesByType(t: string): { name: string; initiatorType: string }[] };
		document?: { title: string; querySelector(s: string): unknown };
	};
	const resources =
		w.performance
			?.getEntriesByType("resource")
			.map((r) => ({ name: r.name, type: r.initiatorType })) ?? [];
	const probe = [
		"gapi", "google", "__NEXT_DATA__", "ng", "angular", "React", "ReactDOM",
		"Polymer", "LitElement", "customElements", "wiz", "trustedTypes", "gbar",
		"botguard", "grecaptcha", "AF_initDataChunkQueue", "WIZ_global_data",
	];
	const globals: string[] = [];
	for (const g of probe) {
		try {
			if (w[g] !== undefined && w[g] !== null) globals.push(g);
		} catch {
			/* cross-origin / restricted accessor */
		}
	}
	// Boq/Wiz (Google's first-party framework) leaves these attributes in the DOM.
	let wiz = false;
	try {
		wiz = !!w.document?.querySelector("[jscontroller],[jsmodel],[data-p]");
	} catch {
		wiz = false;
	}
	return { resources, globals, title: w.document?.title ?? "", wiz };
}

const API_RE =
	/(batchexecute|\/_\/[^/]+\/data|googleapis\.com|clients\d+\.google|gstatic\.com\/_\/|\/v1\/|\/rpc\/|jsonp)/i;

function classify(url: string, initiator: string): ResourceKind {
	const u = url.toLowerCase().split("?")[0];
	if (initiator === "xmlhttprequest" || initiator === "fetch") return "api";
	if (API_RE.test(url)) return "api";
	if (u.endsWith(".css") || initiator === "link") return "css";
	if (u.endsWith(".js") || u.endsWith(".mjs") || initiator === "script") return "js";
	if (/\.(woff2?|ttf|otf|eot)$/.test(u)) return "font";
	if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(u)) return "img";
	if (initiator === "navigation" || initiator === "other") return "doc";
	return "other";
}

/** Normalise an endpoint to a stable, query-stripped pattern for the corpus. */
function apiPattern(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname.replace(/\/\d+(?=\/|$)/g, "/{n}");
		return `${u.host}${path}`;
	} catch {
		return url.split("?")[0];
	}
}

function uniq(xs: string[]): string[] {
	return [...new Set(xs)].toSorted();
}

/**
 * Profile a single Google property end-to-end and reinforce the corpus.
 */
export async function profileSite(
	target: string,
	opts: ProfileOptions = {},
): Promise<GoogleProfile> {
	const url = GOOGLE_TARGETS[target] ?? target;
	const host = (() => {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	})();

	// Prime with what bxc already learned about this host.
	const priorHints = await corpusHints(host);

	const profile = opts.profile ?? "max";
	const page = await Browser.newPage({
		profile,
		profileDirectory: profile === "max" ? opts.chromeProfile : undefined,
		// For the real-Chrome path, snapshot the logged-in profile by default so
		// capture works even while the user's Chrome holds the user-data-dir lock.
		copyProfile:
			profile === "max" && opts.chromeProfile
				? (opts.copyProfile ?? true)
				: undefined,
		insecure: opts.insecure,
	});

	let html = "";
	let status = 0;
	let finalUrl = url;
	const headers: Record<string, string> = {};
	let probe: ReturnType<typeof pageProbe> = {
		resources: [],
		globals: [],
		title: "",
		wiz: false,
	};

	try {
		const resp = (await page.goto(url, { timeoutMs: opts.timeoutMs })) as {
			status?: number;
			url?: string;
			headers?: Record<string, string>;
		};
		status = resp?.status ?? 0;
		finalUrl = resp?.url ?? url;
		if (resp?.headers) {
			for (const [k, v] of Object.entries(resp.headers)) headers[k.toLowerCase()] = v;
		}
		// Browser-backed profiles commit `Page.navigate` before the SPA fetches
		// its CSS/JS bundles and Boq/XHR endpoints. Let the resource graph settle
		// so `performance.getEntriesByType("resource")` is populated; static/http
		// have no JS runtime, so the wait is pointless there.
		if (profile === "max" || profile === "fast" || profile === "stealth") {
			const settleMs = opts.settleMs ?? 3_000;
			await new Promise((r) => setTimeout(r, settleMs));
		}
		html = await page.content();
		try {
			const r = await page.evaluate(pageProbe);
			// static/http transports have no JS runtime and return undefined —
			// keep the empty default probe in that case.
			if (r && typeof r === "object" && Array.isArray(r.globals)) probe = r;
		} catch {
			/* no JS runtime — keep the empty probe */
		}
	} finally {
		await page.close().catch(() => undefined);
		await Browser.close().catch(() => undefined);
	}

	// Framework detection from the rendered HTML + headers. Best-effort: the
	// wappalyzergo helper binary may be absent — degrade to the in-page globals
	// (and Wiz/Boq DOM heuristic) rather than failing the whole profile.
	let detected: Awaited<ReturnType<typeof detectFrameworks>> = [];
	try {
		detected = await detectFrameworks(
			{ url: finalUrl, html, headers },
			{ insecure: opts.insecure },
		);
	} catch {
		detected = [];
	}
	const frameworks = uniq(detected.map((d) => d.name));
	const globals = uniq(probe.globals);
	if (probe.wiz && !frameworks.includes("Wiz/Boq")) frameworks.push("Wiz/Boq");

	// Classify the captured resource graph.
	const css: string[] = [];
	const js: string[] = [];
	const fonts: string[] = [];
	const apis: string[] = [];
	for (const r of probe.resources) {
		switch (classify(r.name, r.type)) {
			case "css":
				css.push(r.name);
				break;
			case "js":
				js.push(r.name);
				break;
			case "font":
				fonts.push(r.name);
				break;
			case "api":
				apis.push(apiPattern(r.name));
				break;
			default:
				break;
		}
	}

	// High-confidence Google-stack recognition from aphrody's RE corpus
	// (Gemini app CSS vars, M3 tokens, Boq endpoints, model ids, Google Sans).
	const recognized = recognizeStack({ html, apis, globals });

	const counts = {
		css: css.length,
		js: js.length,
		api: new Set(apis).size,
		htmlBytes: html.length,
	};

	// Reinforce with both detected frameworks and the recognised stack tags, so
	// the corpus learns e.g. "gemini-app" / "material-3" / "gemini-model:<id>".
	const learnedFrameworks = uniq([
		...frameworks,
		...recognized.tags,
		...recognized.models.map((m) => `gemini-model:${m}`),
	]);
	const knowledge = await reinforce({
		host,
		frameworks: learnedFrameworks,
		apis: uniq(apis),
		globals,
		headers,
		counts,
	});

	return {
		target,
		url,
		finalUrl,
		capturedAt: new Date().toISOString(),
		profile,
		status,
		htmlBytes: html.length,
		title: probe.title,
		frameworks,
		globals,
		css: uniq(css),
		js: uniq(js),
		fonts: uniq(fonts),
		apis: uniq(apis),
		headers,
		recognized,
		priorHints,
		knowledge,
	};
}
