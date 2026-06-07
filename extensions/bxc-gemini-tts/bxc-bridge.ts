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
 * bxc-bridge — Local HTTP bridge for the bxc Gemini TTS Chrome Extension.
 *
 * Exposes a lightweight server on 127.0.0.1:8765 to bridge the sandboxed
 * extension environment with the local filesystem, bxc CLI, and VPS.
 *
 * Run with:
 *   bun extensions/bxc-gemini-tts/bxc-bridge.ts
 */

import { GeminiSessionPool } from "../../src/google/gemini-session.ts";
import { saveCookieJar } from "../../src/cookies/cookie-loader.ts";
import { resolveCookiePath } from "../../src/utils/paths.ts";
import { googleWebSearch } from "../../src/google/search.ts";
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync } from "node:fs";

const PORT = 8765;
const HOST = "127.0.0.1";

// Share session pool for conversation continuity
const sessionPool = new GeminiSessionPool({ model: "flash" });

console.log(`[bxc-bridge] starting on http://${HOST}:${PORT}`);

const server = Bun.serve({
	port: PORT,
	hostname: HOST,
	async fetch(req) {
		const url = new URL(req.url);

		// CORS Headers
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		};

		if (req.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: corsHeaders,
			});
		}

		try {
			if (url.pathname === "/health") {
				return Response.json({ ok: true }, { headers: corsHeaders });
			}

			if (url.pathname === "/google-cookies" && req.method === "POST") {
				const cookies = await req.json();
				if (!Array.isArray(cookies)) {
					return Response.json(
						{ ok: false, error: "Cookies must be an array" },
						{ status: 400, headers: corsHeaders },
					);
				}

				// 1. Save locally to bxc cookies (~/.bxc/cookies/google.json)
				await saveCookieJar("google", cookies);

				// 2. Save locally to ~/.aphrody/google-cookies.json (compatibility)
				const aphrodyDir = join(homedir(), ".aphrody");
				if (!existsSync(aphrodyDir)) {
					mkdirSync(aphrodyDir, { recursive: true });
				}
				await Bun.write(
					join(aphrodyDir, "google-cookies.json"),
					JSON.stringify(cookies, null, 2),
				);

				console.log(
					`[bxc-bridge] Google cookies saved successfully (${cookies.length} cookies)`,
				);

				// 3. Optional VPS sync if configured
				const vps = Bun.env.BXC_VPS ?? Bun.env.BXC_VPS_HOST;
				if (vps) {
					console.log(`[bxc-bridge] Syncing cookies to VPS: ${vps}...`);
					const localPath = resolveCookiePath("google");

					try {
						// scp to VPS
						const scpProc = Bun.spawn([
							"scp",
							"-p",
							localPath,
							`${vps}:~/.bxc/cookies/google.json`,
						]);
						await scpProc.exited;

						// ssh to load/verify cookies
						const sshProc = Bun.spawn([
							"ssh",
							vps,
							"bxc cookies load google",
						]);
						await sshProc.exited;

						console.log(`[bxc-bridge] Syncing cookies to VPS done.`);
					} catch (syncErr: any) {
						console.error(
							`[bxc-bridge] VPS Sync failed (check SSH config/keys):`,
							syncErr,
						);
					}
				}

				return Response.json({ ok: true }, { headers: corsHeaders });
			}

			if (url.pathname === "/ai/ask" && req.method === "POST") {
				const { prompt, cid } = await req.json();
				if (!prompt) {
					return Response.json(
						{ ok: false, error: "Prompt is required" },
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(
					`[bxc-bridge] Asking Gemini: "${prompt.slice(0, 50)}..."`,
				);
				try {
					const key = cid || "default";
					const text = await sessionPool.generate(key, prompt);
					return Response.json({ ok: true, text }, { headers: corsHeaders });
				} catch (err: any) {
					console.error(`[bxc-bridge] Gemini error:`, err);
					return Response.json(
						{ ok: false, error: err.message || String(err) },
						{ headers: corsHeaders },
					);
				}
			}

			if (url.pathname === "/google/search" && req.method === "POST") {
				const { q } = await req.json();
				if (!q) {
					return Response.json(
						{ ok: false, error: "Query (q) is required" },
						{ status: 400, headers: corsHeaders },
					);
				}

				console.log(`[bxc-bridge] Searching Google: "${q}"`);
				try {
					const results = await googleWebSearch(q);
					return Response.json({ ok: true, results }, { headers: corsHeaders });
				} catch (err: any) {
					console.error(`[bxc-bridge] Google Search error:`, err);
					return Response.json(
						{ ok: false, error: err.message || String(err) },
						{ headers: corsHeaders },
					);
				}
			}

			return Response.json(
				{ error: "Not Found" },
				{ status: 404, headers: corsHeaders },
			);
		} catch (err: any) {
			console.error(`[bxc-bridge] Server error:`, err);
			return Response.json(
				{ ok: false, error: err.message || String(err) },
				{ status: 500, headers: corsHeaders },
			);
		}
	},
});
