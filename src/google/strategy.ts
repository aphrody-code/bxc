/**
 * @module bunlight/google/strategy
 *
 * Scraping strategies specialized for Google domains.
 */

import type { Profile, Strategy, WaitFor } from "../router/framework-strategy.ts";
import type { GoogleDetection } from "./detector.ts";

/**
 * Suggest a scraping strategy for a Google site.
 */
export function suggestGoogleStrategy(detection: GoogleDetection, url: string): Strategy {
	const rationale: string[] = [];
	const hostname = new URL(url).hostname.toLowerCase();

	let profile: Profile = "fast";
	let waitFor: WaitFor = "domcontentloaded";
	const blockResources: Strategy["blockResources"] = ["image", "media", "font"];

	// Gemini requires high stealth
	if (hostname.includes("gemini.google")) {
		profile = "max";
		waitFor = "networkidle";
		rationale.push("Gemini detected → profile=max + networkidle for full hydration");
	} else if (detection.framework === "wiz" || detection.framework === "angular") {
		profile = "fast";
		waitFor = "wait-hydration";
		rationale.push(`Google SPA framework (${detection.framework}) → profile=fast + wait-hydration`);
	} else if (detection.isMaterialDesign) {
		profile = "fast";
		waitFor = "domcontentloaded";
		rationale.push("Material Design site → profile=fast + domcontentloaded");
	} else if (detection.hasAntiBot) {
		profile = "stealth";
		waitFor = "networkidle";
		rationale.push("Google Anti-Bot detected → profile=stealth + networkidle");
	}

	return {
		profile,
		waitFor,
		blockResources,
		hints: {
			reDetectAfterHydration: profile === "fast",
			isSPA: detection.framework !== "none",
			hasAntiBot: detection.hasAntiBot,
			shape: detection.framework === "none" ? "static-html" : "spa",
		},
		rationale,
	};
}
