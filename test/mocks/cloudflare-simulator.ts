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
 * @module test/mocks/cloudflare-simulator
 *
 * A local mock server that simulates Cloudflare's security layers
 * to test Bxc's bypass logic without violating the Google-only mandate.
 */

import { serve } from "bun";

export function startCloudflareMock(port: number = 29523) {
	return serve({
		port,
		async fetch(req) {
			const url = new URL(req.url);
			const ua = req.headers.get("user-agent") ?? "";

			// 1. Bot detection simulation
			if (!ua.includes("Mozilla/5.0") || ua.includes("Bun/")) {
				return new Response("Forbidden: Bot detected (Fingerprint Mismatch)", {
					status: 403,
					headers: { Server: "cloudflare", "cf-ray": "8845-MOCK-PAR" },
				});
			}

			// 2. Success (Authenticated)
			if (req.headers.get("cookie")?.includes("cf_clearance=mock_token")) {
				return new Response(
					JSON.stringify({ ok: true, data: "Cloudflare Mock Passed" }),
					{
						headers: {
							"Content-Type": "application/json",
							Server: "cloudflare",
						},
					},
				);
			}

			// 3. Challenge simulation
			if (url.searchParams.has("challenge")) {
				return new Response(
					`
					<html>
						<head><title>Just a moment...</title></head>
						<body>
							<div id="cf-challenge">Solving Turnstile Mock...</div>
							<script>
								setTimeout(() => {
									document.cookie = "cf_clearance=mock_token; Path=/; Max-Age=3600";
									window.location.reload();
								}, 100);
							</script>
						</body>
					</html>
				`,
					{
						status: 403,
						headers: { "Content-Type": "text/html", Server: "cloudflare" },
					},
				);
			}

			// Default: Redirect to challenge (302) but subsequent page is 403
			return new Response("", {
				status: 302,
				headers: { Location: url.pathname + "?challenge=1" },
			});
		},
	});
}

if (import.meta.main) {
	console.log("🚀 Cloudflare Simulator running on http://localhost:29523");
	startCloudflareMock(29523);
}
