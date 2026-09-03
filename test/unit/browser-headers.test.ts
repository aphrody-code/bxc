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

import { describe, expect, it } from "bun:test";
import {
	acceptLanguageFor,
	browserHeaders,
	chromeMajorOf,
	DEFAULT_DESKTOP_UA,
	platformOf,
	stripHeadlessMarker,
} from "../../src/internal/browser-headers.ts";

describe("browser-headers: stripHeadlessMarker", () => {
	it("rewrites the headless token while keeping the version", () => {
		const ua =
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/152.0.0.0 Safari/537.36";
		expect(stripHeadlessMarker(ua)).toBe(
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
		);
	});

	it("leaves a normal UA untouched", () => {
		expect(stripHeadlessMarker(DEFAULT_DESKTOP_UA)).toBe(DEFAULT_DESKTOP_UA);
	});
});

describe("browser-headers: UA parsing", () => {
	it("reads the major version, headless or not", () => {
		expect(chromeMajorOf(DEFAULT_DESKTOP_UA)).toBe(131);
		expect(chromeMajorOf("... HeadlessChrome/152.0.0.0 Safari/537.36")).toBe(
			152,
		);
		expect(chromeMajorOf("curl/8.5.0")).toBeNull();
	});

	it("derives the platform from the UA", () => {
		expect(platformOf(DEFAULT_DESKTOP_UA)).toBe("Windows");
		expect(platformOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(
			"macOS",
		);
		expect(platformOf("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Linux");
	});
});

describe("browser-headers: acceptLanguageFor", () => {
	it("expands a regional locale into a weighted list", () => {
		expect(acceptLanguageFor("zh-CN")).toBe("zh-CN,zh;q=0.9,en;q=0.8");
	});

	it("handles a bare language", () => {
		expect(acceptLanguageFor("fr")).toBe("fr,en;q=0.8");
	});

	it("falls back to a default rather than omitting the header", () => {
		// The measured trigger for a 403 on comic.dragonballcn.com was a request
		// with no Accept-Language at all, so it must never be absent.
		expect(acceptLanguageFor(undefined)).toBe("en-US,en;q=0.9");
	});
});

describe("browser-headers: browserHeaders", () => {
	it("always sends Accept-Language, even with no locale", () => {
		const h = browserHeaders();
		expect(h["Accept-Language"]).toBe("en-US,en;q=0.9");
	});

	it("keeps client hints consistent with the User-Agent", () => {
		const h = browserHeaders({
			userAgent:
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
		});
		expect(h["Sec-CH-UA-Platform"]).toBe('"macOS"');
		expect(h["Sec-CH-UA"]).toContain('v="140"');
		expect(h["Sec-CH-UA-Mobile"]).toBe("?0");
	});

	it("never advertises a headless browser", () => {
		const h = browserHeaders({
			userAgent: "Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/152.0.0.0",
		});
		expect(h["User-Agent"]).not.toContain("Headless");
	});

	it("omits client hints for a non-Chromium UA", () => {
		const h = browserHeaders({ userAgent: "curl/8.5.0" });
		expect(h["Sec-CH-UA"]).toBeUndefined();
		expect(h["Sec-Fetch-Dest"]).toBeUndefined();
		expect(h["Accept-Language"]).toBeDefined();
	});

	it("shapes Accept and Sec-Fetch-* per destination", () => {
		const doc = browserHeaders({ dest: "document" });
		expect(doc.Accept).toContain("text/html");
		expect(doc["Sec-Fetch-Mode"]).toBe("navigate");
		expect(doc["Sec-Fetch-User"]).toBe("?1");
		expect(doc["Upgrade-Insecure-Requests"]).toBe("1");

		const img = browserHeaders({ dest: "image" });
		expect(img.Accept).toContain("image/avif");
		expect(img["Sec-Fetch-Dest"]).toBe("image");
		expect(img["Sec-Fetch-Mode"]).toBe("no-cors");
		// A subresource is not a user-initiated navigation.
		expect(img["Sec-Fetch-User"]).toBeUndefined();
	});

	it("classifies Sec-Fetch-Site from the referer", () => {
		expect(browserHeaders({})["Sec-Fetch-Site"]).toBe("none");
		expect(
			browserHeaders({
				url: "https://a.example.com/x.jpg",
				referer: "https://a.example.com/page",
			})["Sec-Fetch-Site"],
		).toBe("same-origin");
		expect(
			browserHeaders({
				url: "https://cdn.example.com/x.jpg",
				referer: "https://www.example.com/page",
			})["Sec-Fetch-Site"],
		).toBe("same-site");
		expect(
			browserHeaders({
				url: "https://other.org/x.jpg",
				referer: "https://www.example.com/page",
			})["Sec-Fetch-Site"],
		).toBe("cross-site");
	});

	it("lets caller headers win", () => {
		const h = browserHeaders({ extra: { "Accept-Language": "ja-JP" } });
		expect(h["Accept-Language"]).toBe("ja-JP");
	});
});
