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

import { describe, expect, test, afterEach } from "bun:test";
import { KeylessGoogleClient } from "../src/google/keyless.ts";
import { GeminiScraper } from "../src/google/gemini-scraper.ts";
import { GeminiWebClient } from "../src/google/gemini-web.ts";

const originalFetch = global.fetch;

function mockFetch(handler: (request: Request) => Promise<Response> | Response) {
	global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);
		return handler(request);
	}) as any;
}

afterEach(() => {
	global.fetch = originalFetch;
});

describe("google/keyless", () => {
	test("resolveDns resolves domain name via dns.google", async () => {
		mockFetch((req) => {
			expect(req.url).toContain("https://dns.google/resolve");
			expect(req.url).toContain("name=example.com");
			expect(req.url).toContain("type=A");
			return new Response(JSON.stringify({ Answer: [{ data: "93.184.216.34" }] }));
		});

		const client = new KeylessGoogleClient();
		const res = await client.resolveDns("example.com", "A");
		expect(res.Answer[0].data).toBe("93.184.216.34");
	});

	test("searchBooks returns public volume data", async () => {
		mockFetch((req) => {
			expect(req.url).toContain("https://www.googleapis.com/books/v1/volumes");
			expect(req.url).toContain("q=quantum");
			return new Response(JSON.stringify({ items: [{ id: "vol1", volumeInfo: { title: "Quantum Physics" } }] }));
		});

		const client = new KeylessGoogleClient();
		const res = await client.searchBooks("quantum");
		expect(res.items[0].id).toBe("vol1");
		expect(res.items[0].volumeInfo.title).toBe("Quantum Physics");
	});

	test("getBook retrieves specific volume", async () => {
		mockFetch((req) => {
			expect(req.url).toContain("https://www.googleapis.com/books/v1/volumes/vol1");
			return new Response(JSON.stringify({ id: "vol1", volumeInfo: { title: "Quantum Physics" } }));
		});

		const client = new KeylessGoogleClient();
		const res = await client.getBook("vol1");
		expect(res.id).toBe("vol1");
	});

	test("translate translates text using keyless translate API", async () => {
		mockFetch((req) => {
			expect(req.url).toContain("https://translate.googleapis.com/translate_a/single");
			expect(req.url).toContain("q=hello");
			return new Response(JSON.stringify([[["hola", "hello"]] ]));
		});

		const client = new KeylessGoogleClient();
		const res = await client.translate("hello", "es", "en");
		expect(res).toBe("hola");
	});

	test("autocomplete gets query suggestions", async () => {
		mockFetch((req) => {
			expect(req.url).toContain("https://suggestqueries.google.com/complete/search");
			return new Response(JSON.stringify(["hello", ["hello world", "hello kitty"]]));
		});

		const client = new KeylessGoogleClient();
		const res = await client.autocomplete("hello");
		expect(res).toEqual(["hello world", "hello kitty"]);
	});

	test("getPublicCalendarEvents fetches and parses events basic.ics", async () => {
		const icsData = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:123
SUMMARY:Meeting with\\, Team
DESCRIPTION:Project kickoff\\nplanning
END:VEVENT
END:VCALENDAR`;

		mockFetch((req) => {
			expect(req.url).toContain("calendar.google.com");
			return new Response(icsData);
		});

		const client = new KeylessGoogleClient();
		const events = await client.getPublicCalendarEvents("my-cal");
		expect(events).toHaveLength(1);
		expect(events[0].uid).toBe("123");
		expect(events[0].summary).toBe("Meeting with, Team");
		expect(events[0].description).toBe("Project kickoff\nplanning");
	});

	test("downloadPublicDriveFile handles confirm token redirect", async () => {
		let callCount = 0;
		mockFetch((req) => {
			callCount++;
			if (callCount === 1) {
				// First request: return page with warning redirect token
				expect(req.url).toContain("https://docs.google.com/uc");
				expect(req.url).not.toContain("confirm=");
				return new Response(
					'<html><body><a href="https://docs.google.com/uc?id=file1&confirm=TOKEN123">Confirm</a></body></html>',
					{
						headers: {
							"set-cookie": "download_warning_file1=TOKEN123; Path=/;",
						},
					}
				);
			} else {
				// Second request: with token
				expect(req.url).toContain("confirm=TOKEN123");
				return new Response(new Uint8Array([1, 2, 3]));
			}
		});

		const client = new KeylessGoogleClient();
		const res = await client.downloadPublicDriveFile("file1");
		expect(callCount).toBe(2);
		expect(res).toEqual(new Uint8Array([1, 2, 3]));
	});
});

describe("google/gemini-scraper", () => {
	test("parses HTML and JS bundles properly", async () => {
		const html = `
			<html>
				<head>
					<link rel="preload" as="script" href="/bundle1.js">
					<style>
						:root { --gemini-theme-color: #4285f4; }
					</style>
				</head>
				<body>
					<button class="mat-button">Ask Gemini</button>
					<div role="button">Click Me</div>
				</body>
			</html>
		`;

		const js1 = `
			Hx("MaZiqc", ["/BardFrontendService.ListConversations"]);
			Hx("GzXR5e", ["/BardFrontendService.DeleteConversation"]);
			const svc = "assistant.lamda.BardFrontendService";
			const method = "assistant.lamda.BardFrontendService/StreamGenerate";
			const model = "gemini-2.0-flash";
			const flag = "enable_gemini_voice";
		`;

		mockFetch((req) => {
			if (req.url === "https://gemini.google.com/app") {
				return new Response(html);
			}
			if (req.url.endsWith("/bundle1.js")) {
				return new Response(js1);
			}
			return new Response("");
		});

		const scraper = new GeminiScraper();
		const data = await scraper.scrape();

		expect(data.buttons).toHaveLength(2);
		expect(data.buttons[0].text).toBe("Ask Gemini");
		expect(data.css_variables).toContain("--gemini-theme-color");
		expect(data.rpc_mappings).toEqual({
			MaZiqc: "BardFrontendService.ListConversations",
			GzXR5e: "BardFrontendService.DeleteConversation",
		});
		expect(data.models).toContain("gemini-2.0-flash");
		expect(data.feature_flags).toContain("enable_gemini_voice");
	});
});

describe("google/gemini-web", () => {
	test("bootstrap extracts SNlM0e and cfb2h tokens", async () => {
		mockFetch((req) => {
			expect(req.url).toBe("https://gemini.google.com/app");
			return new Response(`
				<html>
					<script>
						var WIZ_global_data = {
							"SNlM0e":"TOKEN_SNLM0E",
							"cfb2h":"BUILD_LABEL"
						};
					</script>
				</html>
			`);
		});

		const client = new GeminiWebClient({
			cookies: [
				{
					name: "__Secure-1PSID",
					value: "my-secure-sid",
					domain: "google.com",
					path: "/",
					expires: -1,
					httpOnly: true,
					secure: true,
					sameSite: "Lax",
				},
			],
		});
		const at = await client.bootstrap();
		expect(at).toBe("TOKEN_SNLM0E");
	});

	test("generate handles query turn and returns text with conversation IDs", async () => {
		let bootstrapCalled = false;
		mockFetch((req) => {
			if (req.url === "https://gemini.google.com/app") {
				bootstrapCalled = true;
				return new Response(`{"SNlM0e":"TOKEN_SNLM0E","cfb2h":"BUILD"}`);
			}
			if (req.url.includes("/StreamGenerate")) {
				// Reply envelope wire format:
				// wrb.fr payload with candidate inside candidate response
				const inner = [
					"c_conv123", // cid
					"r_resp123", // rid
				];
				const responseCandidates = [
					[
						"rc_cand123", // rcid
						["Hello, I am Gemini!"], // reply text list
					],
				];
				const main = [
					null,
					inner,
					null,
					null,
					responseCandidates,
				];
				const wrbFr = [
					"wrb.fr",
					"generic",
					JSON.stringify(main),
				];
				const chunk = [wrbFr];
				return new Response(")]}'\n\n" + JSON.stringify(chunk));
			}
			return new Response("", { status: 404 });
		});

		const client = new GeminiWebClient({
			cookies: [
				{
					name: "__Secure-1PSID",
					value: "my-secure-sid",
					domain: "google.com",
					path: "/",
					expires: -1,
					httpOnly: true,
					secure: true,
					sameSite: "Lax",
				},
			],
		});
		const reply = await client.generate("Hi");
		expect(reply).toBe("Hello, I am Gemini!");
		expect(client.conversation).toEqual(["c_conv123", "r_resp123", "rc_cand123"]);
		expect(bootstrapCalled).toBe(true);
	});
});
