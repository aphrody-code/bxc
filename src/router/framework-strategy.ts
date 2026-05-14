/**
 * @module bunlight/router/framework-strategy
 *
 * Maps the output of {@link detectFrameworks} onto a Bunlight scraping
 * strategy (which profile to use, how long to wait for hydration, what kinds
 * of resources to block, plus optional extra hints).
 *
 * The mapping is intentionally conservative : we only escalate the profile
 * when we have signal that a less-aggressive one is likely to fail.
 *
 * @example
 * ```ts
 * import { detectFrameworks } from "bunlight/detect";
 * import { suggestStrategy } from "bunlight/router/framework-strategy";
 * import { Browser } from "bunlight/browser";
 *
 * const tech = await detectFrameworks("https://shop.example.com");
 * const plan = suggestStrategy(tech);
 * const page = await Browser.newPage({ profile: plan.profile });
 * ```
 */

import type { DetectedTech } from "../detect.ts";
import {
	detectGoogleSpecifics,
	googleToTech,
	isGoogleDomain,
	suggestGoogleStrategy,
} from "../google/index.ts";

// ---------------------------------------------------------------------------
// Strategy types
// ---------------------------------------------------------------------------

export type Profile = "static" | "fast" | "stealth" | "max" | "http";

export type WaitFor =
	| "none"
	| "domcontentloaded"
	| "load"
	| "networkidle"
	| "wait-hydration"
	| "abort";

export type ResourceKind =
	| "image"
	| "media"
	| "font"
	| "stylesheet"
	| "script"
	| "xhr"
	| "websocket"
	| "other";

/** Strategy returned by {@link suggestStrategy}. */
export interface Strategy {
	/** Recommended Bunlight profile to use. */
	profile: Profile;
	/** How long / what to wait for after `goto()`. */
	waitFor: WaitFor;
	/** Resource kinds that can be blocked safely. */
	blockResources: ResourceKind[];
	/** Optional hints for callers and downstream tooling. */
	hints: {
		/** True when we recommend re-running detection after JS hydration. */
		reDetectAfterHydration: boolean;
		/** Whether the site is a SPA (React / Vue / Angular without an SSR shell). */
		isSPA: boolean;
		/** Whether a known WAF / anti-bot vendor was detected. */
		hasAntiBot: boolean;
		/** Recognized "shape" : how to extract data efficiently. */
		shape:
			| "static-html"
			| "ssr-react"
			| "ssr-vue"
			| "ssr-svelte"
			| "spa"
			| "wordpress"
			| "shopify"
			| "drupal"
			| "ghost"
			| "strapi"
			| "unknown";
	};
	/**
	 * Human-readable summary of why this strategy was picked.
	 * Useful for logs/debugging.
	 */
	rationale: string[];
}

// ---------------------------------------------------------------------------
// Catalogues
// ---------------------------------------------------------------------------

/** Vendors that virtually always require a real browser + stealth. */
const ANTI_BOT_VENDORS = new Set(
	[
		"Cloudflare",
		"Cloudflare Bot Management",
		"Cloudflare Turnstile",
		"Akamai",
		"Akamai Bot Manager",
		"DataDome",
		"PerimeterX",
		"HUMAN",
		"Kasada",
		"Imperva",
		"Incapsula",
		"F5 BIG-IP",
		"Reblaze",
		"Shape Security",
	].map((s) => s.toLowerCase()),
);

/** Vendors / categories that *force* JS rendering (SSR shell may exist but full content needs hydration). */
const SPA_FRAMEWORKS = new Set(
	["React", "Vue.js", "Vue", "Angular", "Svelte", "Preact", "Ember.js", "Backbone.js"].map((s) =>
		s.toLowerCase(),
	),
);

/** Frameworks that already serve a good static SSR shell. */
const SSR_FRAMEWORKS = new Set(
	[
		"Next.js",
		"Nuxt.js",
		"Nuxt",
		"SvelteKit",
		"Remix",
		"Astro",
		"Gatsby",
		"Eleventy",
		"Hugo",
		"Jekyll",
	].map((s) => s.toLowerCase()),
);

/** CMS / e-commerce platforms with a well-behaved rendered HTML output. */
const STATIC_FRIENDLY_CMS = new Set(
	[
		"WordPress",
		"Drupal",
		"Joomla",
		"Ghost",
		"Strapi",
		"Magento",
		"Shopify",
		"Wix",
		"Squarespace",
	].map((s) => s.toLowerCase()),
);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const lower = (s: string) => s.toLowerCase();

function namesLower(detected: DetectedTech[]): Set<string> {
	return new Set(detected.map((d) => lower(d.name)));
}

function categoriesLower(detected: DetectedTech[]): Set<string> {
	const out = new Set<string>();
	for (const d of detected) for (const c of d.categories) out.add(lower(c));
	return out;
}

function pickShape(detected: DetectedTech[]): Strategy["hints"]["shape"] {
	const names = namesLower(detected);
	if (names.has("wordpress")) return "wordpress";
	if (names.has("shopify")) return "shopify";
	if (names.has("drupal")) return "drupal";
	if (names.has("ghost")) return "ghost";
	if (names.has("strapi")) return "strapi";
	if (names.has("next.js") || (names.has("react") && names.has("node.js"))) return "ssr-react";
	if (names.has("nuxt.js") || names.has("nuxt")) return "ssr-vue";
	if (names.has("sveltekit")) return "ssr-svelte";
	for (const f of SPA_FRAMEWORKS) {
		if (names.has(f)) return "spa";
	}
	const cats = categoriesLower(detected);
	if (cats.has("static site generator")) return "static-html";
	return "unknown";
}

/**
 * Decide on a scraping strategy for a list of detected technologies.
 *
 * Algorithm :
 *
 *  1. If a Google domain is detected → delegate to Google-specific strategy.
 *  2. If a known anti-bot WAF is detected → escalate to `stealth` (and `max`
 *     for the most aggressive vendors like Datadome / Akamai / Kasada).
 *  3. Else if an SPA framework is detected without a known SSR companion →
 *     `fast` profile + wait for hydration.
 *  4. Else if an SSR framework is detected → `fast` with `domcontentloaded`.
 *  5. Else if a static-friendly CMS is detected → `static` profile.
 *  6. Else → default to `static` (cheapest), but suggest a re-detect.
 */
export function suggestStrategy(detected: DetectedTech[], url?: string): Strategy {
	const rationale: string[] = [];
	const names = namesLower(detected);

	// 0) Google Specialization
	if (url && isGoogleDomain(new URL(url).hostname)) {
		// Use Google-specific detection if we don't have it yet
		// Note: in a real flow, we'd have body/headers here too.
		// For now, we use what we have in 'detected'.
		const googleHit = detected.find((t) => t.name === "Google" || t.name === "Material Design");
		if (googleHit || isGoogleDomain(new URL(url).hostname)) {
			// We synthesize a GoogleDetection from DetectedTech for the strategy suggester
			const googleDetection = {
				isGoogleOwned: isGoogleDomain(new URL(url).hostname),
				isMaterialDesign: names.has("material design"),
				framework: (names.has("angular")
					? "angular"
					: names.has("lit")
						? "lit"
						: names.has("wiz (google internal)")
							? "wiz"
							: "none") as any,
				hasAntiBot: names.has("google anti-bot"),
				evidence: ["suggestStrategy: domain match"],
			};
			return suggestGoogleStrategy(googleDetection, url);
		}
	}

	// 1) Anti-bot detection.
	const antiBotHit = [...names].find((n) => ANTI_BOT_VENDORS.has(n));
	const hasAntiBot = !!antiBotHit;

	// "Hard" vendors → max profile.
	const HARD_VENDORS = ["datadome", "akamai bot manager", "perimeterx", "kasada", "human"];
	const hardHit = [...names].find((n) => HARD_VENDORS.includes(n));

	const shape = pickShape(detected);
	const isSPA = shape === "spa";

	let profile: Profile;
	let waitFor: WaitFor;
	let blockResources: ResourceKind[];

	if (hardHit) {
		profile = "max";
		waitFor = "wait-hydration";
		blockResources = ["image", "media", "font"];
		rationale.push(`hard anti-bot vendor detected: ${hardHit} → profile=max`);
	} else if (hasAntiBot) {
		profile = "stealth";
		waitFor = "domcontentloaded";
		blockResources = ["image", "media", "font"];
		rationale.push(`anti-bot WAF detected: ${antiBotHit} → profile=stealth`);
	} else if (isSPA) {
		profile = "fast";
		waitFor = "wait-hydration";
		blockResources = ["image", "media", "font"];
		rationale.push("SPA framework detected → profile=fast + wait-hydration");
	} else if (
		shape === "ssr-react" ||
		shape === "ssr-vue" ||
		shape === "ssr-svelte" ||
		[...names].some((n) => SSR_FRAMEWORKS.has(n))
	) {
		profile = "fast";
		waitFor = "domcontentloaded";
		blockResources = ["image", "media", "font"];
		rationale.push("SSR framework detected → profile=fast + domcontentloaded");
	} else if (
		shape === "wordpress" ||
		shape === "drupal" ||
		shape === "ghost" ||
		shape === "strapi" ||
		[...names].some((n) => STATIC_FRIENDLY_CMS.has(n))
	) {
		profile = "static";
		waitFor = "load";
		blockResources = ["image", "media", "font", "stylesheet"];
		rationale.push(`static-friendly CMS (${shape}) → profile=static`);
	} else {
		profile = "static";
		waitFor = "load";
		blockResources = ["image", "media", "font"];
		rationale.push("no strong signal → defaulting to profile=static");
	}

	if (detected.length === 0) {
		rationale.push("empty detection → consider re-running after hydration");
	}

	return {
		profile,
		waitFor,
		blockResources,
		hints: {
			reDetectAfterHydration: isSPA || detected.length === 0,
			isSPA,
			hasAntiBot,
			shape,
		},
		rationale,
	};
}

/**
 * Convenience : suggest both initial profile *and* explain whether a
 * follow-up detection pass is recommended after hydration.
 */
export function shouldReDetectAfter(detected: DetectedTech[]): boolean {
	return suggestStrategy(detected).hints.reDetectAfterHydration;
}
