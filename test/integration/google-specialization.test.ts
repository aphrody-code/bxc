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
 * Integration tests for Google-specific specialization.
 * Focuses on domains requested: gemini.google, geminicli.com, design.google, m3.material.io.
 */

import { describe, expect, test } from "bun:test";
import { Browser } from "../../src/api/browser.ts";
import {
	detectGoogleSpecifics,
	googleToTech,
	isGoogleDomain,
} from "../../src/google/index.ts";
import { suggestStrategy } from "../../src/router/framework-strategy.ts";

// ---------------------------------------------------------------------------
// Locate the lightpanda binary
// ---------------------------------------------------------------------------

async function locateLightpanda(): Promise<string | null> {
	const root = new URL("../../", import.meta.url).pathname;
	const envBin = Bun.env.BXC_LIGHTPANDA_BIN;
	if (envBin && (await Bun.file(envBin).exists())) return envBin;

	const candidates = [
		`${Bun.env.HOME}/.local/bin/lightpanda`,
		`${Bun.env.HOME}/lightpanda`,
		`${root}vendor/lightpanda-bin/linux-x64/lightpanda`,
		"/usr/local/bin/lightpanda",
	];
	for (const c of candidates) {
		if (c && (await Bun.file(c).exists())) return c;
	}
	return null;
}

const LIGHTPANDA_BIN = await locateLightpanda();

// ---------------------------------------------------------------------------
// Static Detection Tests
// ---------------------------------------------------------------------------

describe("Google Specialization — DNS & Detection Logic", () => {
	test("isGoogleDomain identifies requested domains", () => {
		expect(isGoogleDomain("gemini.google.com")).toBe(true);
		expect(isGoogleDomain("geminicli.com")).toBe(true);
		expect(isGoogleDomain("antigravity.google")).toBe(true);
		expect(isGoogleDomain("design.google")).toBe(true);
		expect(isGoogleDomain("m3.material.io")).toBe(true);
		expect(isGoogleDomain("gemini.google")).toBe(true);
	});

	test("detectGoogleSpecifics identifies Wiz (Google Internal) framework", () => {
		const html =
			'<html><body jsaction="click:a.b" jscontroller="xyz"></body></html>';
		const detection = detectGoogleSpecifics(
			"https://gemini.google.com",
			new Map(),
			html,
		);
		expect(detection.framework).toBe("wiz");
		expect(detection.isGoogleOwned).toBe(true);
	});

	test("detectGoogleSpecifics identifies Material Design", () => {
		const html = '<html><body class="mdc-typography"></body></html>';
		const detection = detectGoogleSpecifics(
			"https://m3.material.io",
			new Map(),
			html,
		);
		expect(detection.isMaterialDesign).toBe(true);
	});

	test("suggestStrategy for Gemini escalates to max", () => {
		const tech = googleToTech({
			isGoogleOwned: true,
			isMaterialDesign: false,
			framework: "wiz",
			hasAntiBot: true,
			antiBotKind: null,
			products: [],
			hosting: "none",
			evidence: ["manual"],
		});
		const strategy = suggestStrategy(tech, "https://gemini.google.com");
		expect(strategy.profile).toBe("max");
		expect(strategy.waitFor).toBe("networkidle");
	});
});

// ---------------------------------------------------------------------------
// Network Integration Tests
// ---------------------------------------------------------------------------

async function isOnline(): Promise<boolean> {
	try {
		await fetch("https://google.com", {
			signal: AbortSignal.timeout(2000),
			method: "HEAD",
		});
		return true;
	} catch {
		return false;
	}
}

const ONLINE = await isOnline();
const itIfOnline = ONLINE ? test : test.skip;

describe("Zukan Inazuma — Live Site Tests", () => {
	itIfOnline(
		"https://zukan.inazuma.jp — can connect and retrieve character list page",
		async () => {
			const page = await Browser.newPage({
				profile: "fast",
				insecure: true,
				spawnOpts: {
					binaryPath: LIGHTPANDA_BIN ?? undefined,
					readyTimeoutMs: 12000,
				},
			});
			try {
				await page.goto("https://zukan.inazuma.jp/");
				const title = await page.title();
				expect(title).toBeDefined();
				expect(title.length).toBeGreaterThan(0);
				const content = await page.content();
				expect(content.length).toBeGreaterThan(0);
			} finally {
				await page.close();
			}
		},
		30000,
	);
});
