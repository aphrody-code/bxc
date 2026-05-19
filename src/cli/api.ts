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
 * `bxc api` — turn any website into a JSON API.
 */

import { type DeepDetectionResult, deepDetect } from "../detect-deep.ts";
import { type ReconResult, recon } from "./recon.ts";
import { type CommonOptions, parseCommonArgs } from "./shared.ts";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface ApiServerOptions extends CommonOptions {
	port: number;
	hostname: string;
	authToken: string | null;
	corsOrigin: string;
	cacheEnabled: boolean;
	cacheTtlMs: number;
	cacheMax: number;
}

const DEFAULTS: Omit<ApiServerOptions, keyof CommonOptions> = {
	port: 8787,
	hostname: "0.0.0.0",
	authToken: null,
	corsOrigin: "*",
	cacheEnabled: true,
	cacheTtlMs: 60_000,
	cacheMax: 256,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}

function corsHeaders(origin: string): Record<string, string> {
	return {
		"access-control-allow-origin": origin,
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "content-type, authorization",
	};
}

function isAuthorized(req: Request, opts: ApiServerOptions): boolean {
	if (!opts.authToken) return true;
	const h = req.headers.get("authorization") ?? "";
	return h === `Bearer ${opts.authToken}`;
}

async function readUrlParam(
	req: Request,
	_pathParams: Record<string, string>,
): Promise<{ url?: string }> {
	const u = new URL(req.url);
	let urlValue = u.searchParams.get("url") ?? undefined;

	if (req.method === "POST") {
		try {
			const body = (await req.json()) as Record<string, unknown>;
			if (typeof body["url"] === "string") urlValue = body["url"] as string;
		} catch { /* ignore */ }
	}

	return { url: urlValue };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleRecon(url: string, opts: CommonOptions): Promise<ReconResult> {
	return recon({
		...opts,
		url,
		profile: "http",
		screenshot: false,
		json: true,
		quiet: true,
		plain: false,
	});
}

async function handleDetect(url: string, opts: CommonOptions): Promise<DeepDetectionResult> {
	return deepDetect(url, opts.insecure);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export async function startApiServer(options: ApiServerOptions): Promise<{
	port: number;
	stop: () => void;
}> {
	const VERSION = "0.1.0";

	const server = Bun.serve({
		port: options.port,
		hostname: options.hostname,
		fetch: async (req) => {
			const u = new URL(req.url);
			const baseHeaders: Record<string, string> = {
				...corsHeaders(options.corsOrigin),
				"x-bxc-version": VERSION,
			};

			if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
			if (!isAuthorized(req, options)) return jsonResponse(401, { error: "unauthorized" }, baseHeaders);

			try {
				if (u.pathname === "/" || u.pathname === "") {
					return new Response("<h1>bxc API</h1>", { headers: { "content-type": "text/html", ...baseHeaders } });
				}
				if (u.pathname === "/healthz") return jsonResponse(200, { ok: true }, baseHeaders);

				if (u.pathname === "/api/recon") {
					const { url } = await readUrlParam(req, {});
					if (!url) return jsonResponse(400, { error: "missing url" }, baseHeaders);
					const r = await handleRecon(url, options);
					return jsonResponse(200, r, baseHeaders);
				}

				if (u.pathname === "/api/detect") {
					const { url } = await readUrlParam(req, {});
					if (!url) return jsonResponse(400, { error: "missing url" }, baseHeaders);
					const r = await handleDetect(url, options);
					return jsonResponse(200, r, baseHeaders);
				}

				return jsonResponse(404, { error: "not found" }, baseHeaders);
			} catch (err) {
				return jsonResponse(500, { error: String(err) }, baseHeaders);
			}
		},
	});

	return { port: server.port as number, stop: () => server.stop(true) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage(): void {
	Bun.stdout.write(
		`bxc api — turn any website into a JSON API

Usage:
  bxc api [options]

Options:
  --port <N>           listen port (default 8787)
  --host <H>           listen hostname (default 0.0.0.0)
  --auth <TOKEN>       require Authorization: Bearer <TOKEN>
  --no-cache           disable response cache (actually ignored in unified version)
  --help, -h           print this help

`,
	);
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts: ApiServerOptions = { ...baseOpts, ...DEFAULTS };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--port": opts.port = parseInt(argv[++i], 10); break;
			case "--host": opts.hostname = argv[++i]; break;
			case "--auth": opts.authToken = argv[++i]; break;
			case "--help": case "-h": printUsage(); return;
		}
	}
	await startApiServer(opts);
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
