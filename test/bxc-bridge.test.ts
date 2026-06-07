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

import { expect, test } from "bun:test";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";

const BXC_DIR = join(import.meta.dir, "..");
const BRIDGE_SCRIPT = join(BXC_DIR, "extensions/bxc-gemini-tts/bxc-bridge.ts");

test(
	"bxc-bridge HTTP server health & endpoints",
	async () => {
		// Spawn the bridge server in a subprocess
		const proc = Bun.spawn(["bun", "run", BRIDGE_SCRIPT], {
			stdout: "pipe",
			stderr: "pipe",
			env: {
				...process.env,
				BXC_DIR: join(homedir(), ".bxc-test-bridge"),
			},
		});

		try {
			// Wait for the server to boot
			await Bun.sleep(1000);

			// Test 1: GET /health
			const healthResp = await fetch("http://127.0.0.1:8765/health");
			expect(healthResp.status).toBe(200);
			const healthBody = await healthResp.json();
			expect(healthBody).toEqual({ ok: true });

			// Test 2: POST /google-cookies with dummy payload
			const dummyCookies = [
				{
					name: "__Secure-1PSID",
					value: "test-secure-1psid-value",
					domain: ".google.com",
					path: "/",
					secure: true,
					httpOnly: true,
				},
				{
					name: "__Secure-1PSIDTS",
					value: "test-secure-1psidts-value",
					domain: ".google.com",
					path: "/",
					secure: true,
					httpOnly: true,
				},
			];

			const cookieResp = await fetch("http://127.0.0.1:8765/google-cookies", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(dummyCookies),
			});
			expect(cookieResp.status).toBe(200);
			const cookieBody = await cookieResp.json();
			expect(cookieBody).toEqual({ ok: true });

			// Validate cookies saved locally under test BXC_DIR
			const testCookieFile = join(
				homedir(),
				".bxc-test-bridge",
				"cookies",
				"google.json",
			);
			expect(existsSync(testCookieFile)).toBe(true);

			// Clean up test cookie file
			try {
				unlinkSync(testCookieFile);
			} catch {
				/* ignore */
			}
		} finally {
			// Clean up process
			proc.kill();
			await proc.exited;
		}
	},
	15000,
);
