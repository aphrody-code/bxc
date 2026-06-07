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
 * Auto-escalation: attempt profile chain static → fast → ghost
 * on detecting escape signals (403, Cloudflare, empty body, etc.).
 *
 * bxc is Lightpanda-only; the escalation never falls into
 * Chromium/Firefox/Edge/Safari. `ghost` = Lightpanda + CDP stealth injects.
 *
 * Usage:
 *   const { profile, page, attempts } = await autoEscalate(
 *     "https://google.com",
 *     { startProfile: "static", maxAttempts: 3 }
 *   );
 */

import type { Page } from "../api/browser.ts";

/**
 * Escalation step in the profile hierarchy.
 */
export type EscalationStep = "static" | "http" | "fast" | "stealth" | "max";

/**
 * Order of escalation: start with the fastest, escalate to slower profiles on failure.
 */
export const ESCALATION_ORDER: readonly EscalationStep[] = [
	"static",
	"http",
	"fast",
	"stealth",
	"max",
];

/**
 * Signals that trigger escalation to the next profile.
 */
export type EscalationReason =
	| "empty_body"
	| "spa_placeholder"
	| "status_403"
	| "cloudflare"
	| "datadome"
	| "turnstile"
	| "captcha"
	| "success";

/**
 * Result of escalation signal detection.
 */
export interface EscalationSignal {
	reason: EscalationReason;
	detectedFromBody?: string;
	detectedFromStatus?: number;
}

/**
 * Detect if a response indicates the need to escalate to a more capable profile.
 */
export function detectEscalationSignal(
	body: string,
	status: number,
): EscalationSignal | null {
	// HTTP 403 Forbidden — likely protection
	if (status === 403) {
		return { reason: "status_403", detectedFromStatus: status };
	}

	// Cloudflare Managed Challenge
	if (/Just a moment/i.test(body)) {
		return { reason: "cloudflare", detectedFromBody: "Just a moment" };
	}
	if (/Checking your browser/i.test(body)) {
		return { reason: "cloudflare", detectedFromBody: "Checking your browser" };
	}
	if (/cf-mitigated/i.test(body)) {
		return { reason: "cloudflare", detectedFromBody: "cf-mitigated" };
	}

	// Cloudflare at HTTP 503
	if (status === 503 && /cloudflare/i.test(body)) {
		return {
			reason: "cloudflare",
			detectedFromBody: "Cloudflare @ 503",
			detectedFromStatus: status,
		};
	}

	// DataDome protection
	if (/Access Denied/i.test(body) && /datadome/i.test(body)) {
		return { reason: "datadome", detectedFromBody: "DataDome Access Denied" };
	}

	// Turnstile CAPTCHA
	if (/turnstile/i.test(body) && /captcha/i.test(body)) {
		return { reason: "turnstile", detectedFromBody: "Turnstile CAPTCHA" };
	}

	// Generic CAPTCHA widget (but not if it's just an error page)
	if (/(recaptcha|hcaptcha)/i.test(body)) {
		return { reason: "captcha", detectedFromBody: "CAPTCHA widget detected" };
	}

	// SPA placeholder: <noscript> in a small HTML with 200 status (NOT error codes)
	// This is a strong signal that the page needs JavaScript to render.
	if (status === 200 && /<noscript>/i.test(body) && body.length < 1000) {
		return {
			reason: "spa_placeholder",
			detectedFromBody: "<noscript> placeholder",
		};
	}

	// Very small response (< 50 bytes) with 200 status AND no content
	// Excludes error pages (they have 4xx/5xx status and actual error HTML)
	if (status === 200 && body.length < 50 && body.trim().length < 30) {
		return {
			reason: "empty_body",
			detectedFromBody: `Body length: ${body.length}`,
		};
	}

	// No signals detected — response looks good
	return null;
}

/**
 * Get the next profile in the escalation chain.
 * Returns null if already at the last profile.
 */
export function nextProfile(current: EscalationStep): EscalationStep | null {
	const idx = ESCALATION_ORDER.indexOf(current);
	if (idx === -1 || idx >= ESCALATION_ORDER.length - 1) return null;
	return ESCALATION_ORDER[idx + 1];
}

/**
 * Auto-escalate: attempt profiles in order until one succeeds.
 *
 * @param url The URL to navigate to
 * @param options Configuration
 * @returns { profile, page, attempts } The successful profile, page instance, and list of attempted profiles
 * @throws If all profiles are exhausted without success
 */
export async function autoEscalate(
	url: string,
	options: {
		startProfile?: EscalationStep;
		maxAttempts?: number;
		log?: (msg: string) => void;
	} = {},
): Promise<{
	profile: EscalationStep;
	page: Page;
	attempts: EscalationStep[];
}> {
	let profile = options.startProfile ?? "static";
	const maxAttempts = options.maxAttempts ?? 5;
	const log = options.log ?? (() => {});
	const attempts: EscalationStep[] = [];

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		attempts.push(profile);
		log(
			`[escalation] Attempt ${attempt + 1}/${maxAttempts}: profile=${profile}`,
		);

		let page: Page;
		try {
			const { Browser } = await import("../api/browser.ts");
			page = (await Browser.newPage({ profile })) as Page;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`[escalation] Profile ${profile} failed to launch: ${msg}`);

			const next = nextProfile(profile);
			if (!next) {
				throw new Error(`All profiles exhausted. Last error: ${msg}`);
			}
			profile = next;
			continue;
		}

		// Navigate and detect signals
		let response: any;
		let body: string = "";

		try {
			response = await page.goto(url);
			body = (await page.content()) || "";
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log(`[escalation] Navigation failed on ${profile}: ${msg}`);
			await page.close().catch(() => {});

			const next = nextProfile(profile);
			if (!next) {
				throw new Error(
					`All profiles exhausted. Last navigation error: ${msg}`,
				);
			}
			profile = next;
			continue;
		}

		// Check for escalation signals
		const signal = detectEscalationSignal(body, response?.status ?? 200);

		if (!signal) {
			// Success! Return this page and profile
			log(`[escalation] Success on ${profile}`);
			return { profile, page, attempts };
		}

		// Escalation needed
		log(`[escalation] Signal detected on ${profile}: ${signal.reason}`);
		await page.close().catch(() => {});

		const next = nextProfile(profile);
		if (!next) {
			throw new Error(
				`All profiles exhausted at ${profile} (last signal: ${signal.reason}). Last body length: ${body.length}`,
			);
		}

		profile = next;
	}

	throw new Error(
		`Auto-escalation max attempts (${maxAttempts}) reached without success`,
	);
}
