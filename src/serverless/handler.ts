/**
 * @module bunlight/serverless
 *
 * Serverless-friendly Bunlight handler. Designed for Bun runtime (Vercel
 * Functions with `runtime = "bun"`, AWS Lambda Bun layer, Cloudflare
 * Containers, fly.io machines, or `bun build --compile` standalone).
 *
 * Default profile is `http` (curl-impersonate FFI) — no sub-process spawn,
 * sub-second cold-start, ideal for short-lived invocations.
 *
 * Usage (Vercel `app/api/scrape/route.ts`):
 *
 *     export { handler as GET, handler as POST } from "@bunmium/bunlight/serverless";
 *
 * Usage (standalone `bun build --compile`):
 *
 *     import { handler } from "./src/serverless/handler.ts";
 *     Bun.serve({ port: 3000, fetch: handler });
 */

import type { Browser as BrowserNS, HttpPage } from "../api/browser.ts";

let _browserModule: typeof import("../api/browser.ts") | null = null;
let _googleModule: typeof import("../google/index.ts") | null = null;
let _detectModule: typeof import("../detect.ts") | null = null;

async function getBrowser(): Promise<typeof BrowserNS> {
	if (!_browserModule) _browserModule = await import("../api/browser.ts");
	return _browserModule.Browser;
}

async function getGoogle(): Promise<typeof import("../google/index.ts")> {
	if (!_googleModule) _googleModule = await import("../google/index.ts");
	return _googleModule;
}

async function getDetect(): Promise<typeof import("../detect.ts")> {
	if (!_detectModule) _detectModule = await import("../detect.ts");
	return _detectModule;
}

interface ScrapeBody {
	url?: string;
	profile?: "http" | "static";
	extract?: "html" | "text" | "structured" | "all";
	httpProfile?: string;
}

const ALLOWED_PROFILES = new Set(["http", "static"]);

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status: init.status ?? 200,
		headers: {
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			...(init.headers ?? {}),
		},
	});
}

function badRequest(message: string): Response {
	return jsonResponse({ ok: false, error: message }, { status: 400 });
}

async function readBody(req: Request): Promise<ScrapeBody> {
	if (req.method === "GET") {
		const u = new URL(req.url);
		return {
			url: u.searchParams.get("url") ?? undefined,
			profile:
				(u.searchParams.get("profile") as ScrapeBody["profile"]) ?? undefined,
			extract:
				(u.searchParams.get("extract") as ScrapeBody["extract"]) ?? undefined,
			httpProfile: u.searchParams.get("httpProfile") ?? undefined,
		};
	}
	const ct = req.headers.get("content-type") ?? "";
	if (ct.includes("application/json")) {
		try {
			return (await req.json()) as ScrapeBody;
		} catch {
			return {};
		}
	}
	return {};
}

/**
 * Main fetch handler. Routes:
 *   GET  /                  → health check
 *   GET  /scrape?url=…      → scrape (single URL)
 *   POST /scrape            → scrape (JSON body)
 *   GET  /detect?url=…      → wappalyzer + google detection
 *   GET  /search?q=…        → google rich search (cached 5min)
 *   GET  /autocomplete?q=…  → google suggest
 */
export async function handler(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const route = url.pathname.replace(/\/+$/, "") || "/";

	try {
		switch (route) {
			case "/":
			case "/health":
				return jsonResponse({
					ok: true,
					runtime: typeof Bun !== "undefined" ? "bun" : "unknown",
				});

			case "/scrape":
				return await handleScrape(req);

			case "/detect":
				return await handleDetect(req);

			case "/search":
				return await handleSearch(req);

			case "/autocomplete":
				return await handleAutocomplete(req);

			case "/extract":
				return await handleExtract(req);
			default:
				return jsonResponse({ ok: false, error: "Not found" }, { status: 404 });
		}
	} catch (err) {
		return jsonResponse(
			{ ok: false, error: err instanceof Error ? err.message : String(err) },
			{ status: 500 },
		);
	}
}

async function handleScrape(req: Request): Promise<Response> {
	const body = await readBody(req);
	if (!body.url) return badRequest("missing 'url'");
	if (body.profile && !ALLOWED_PROFILES.has(body.profile)) {
		return badRequest(
			`profile must be one of: ${[...ALLOWED_PROFILES].join(", ")}`,
		);
	}
	const profile = body.profile ?? "http";
	const extract = body.extract ?? "all";

	const Browser = await getBrowser();
	let page: HttpPage | null = null;
	try {
		page = (await Browser.newPage({
			profile,
			httpOpts: { profile: (body.httpProfile as never) ?? "chrome131" },
		})) as HttpPage;

		const t0 = performance.now();
		await page.goto(body.url);
		const html = (await page.content()) ?? "";
		const tookMs = Math.round(performance.now() - t0);

		const out: Record<string, unknown> = {
			ok: true,
			url: body.url,
			profile,
			tookMs,
		};
		if (extract === "html" || extract === "all") out.html = html;
		if (extract === "text" || extract === "all") {
			out.text = html
				.replace(/<script[\s\S]*?<\/script>/gi, "")
				.replace(/<style[\s\S]*?<\/style>/gi, "")
				.replace(/<[^>]+>/g, " ")
				.replace(/\s+/g, " ")
				.trim();
		}
		if (extract === "structured" || extract === "all") {
			const { extractStructuredData } = await import("../google/fetch.ts");
			out.structured = extractStructuredData(html);
		}
		return jsonResponse(out);
	} finally {
		if (page) await page.close().catch(() => {});
	}
}

async function handleDetect(req: Request): Promise<Response> {
	const target = new URL(req.url).searchParams.get("url");
	if (!target) return badRequest("missing 'url'");

	const [Browser, google, detect] = await Promise.all([
		getBrowser(),
		getGoogle(),
		getDetect(),
	]);

	let page: HttpPage | null = null;
	try {
		page = (await Browser.newPage({
			profile: "http",
			httpOpts: { profile: "chrome131" },
		})) as HttpPage;
		await page.goto(target);
		const html = (await page.content()) ?? "";

		const headers = new Headers();
		const techs = await detect
			.detectFrameworks({ url: target, html, headers })
			.catch(() => []);
		const googleDet = google.detectGoogleSpecifics(target, headers, html);

		return jsonResponse({
			ok: true,
			url: target,
			techs,
			google: googleDet,
		});
	} finally {
		if (page) await page.close().catch(() => {});
	}
}

async function handleSearch(req: Request): Promise<Response> {
	const u = new URL(req.url);
	const q = u.searchParams.get("q");
	if (!q) return badRequest("missing 'q'");
	const hl = u.searchParams.get("hl") ?? "en";
	const gl = u.searchParams.get("gl") ?? "US";
	const ttl = Number(u.searchParams.get("cacheTtlMs") ?? 5 * 60 * 1000);

	const google = await getGoogle();
	const result = await google.googleSearchRich(q, { hl, gl, cacheTtlMs: ttl });
	return jsonResponse({ ok: true, ...result });
}

async function handleAutocomplete(req: Request): Promise<Response> {
	const u = new URL(req.url);
	const q = u.searchParams.get("q");
	if (!q) return badRequest("missing 'q'");
	const google = await getGoogle();
	const suggestions = await google.googleAutocomplete(q, {
		hl: u.searchParams.get("hl") ?? undefined,
		gl: u.searchParams.get("gl") ?? undefined,
	});
	return jsonResponse({ ok: true, q, suggestions });
}

async function handleExtract(_req: Request): Response {
	return jsonResponse({ ok: false, error: "extract endpoint disabled (gemini features removed from main)" }, { status: 501 });
}



export default { fetch: handler };
