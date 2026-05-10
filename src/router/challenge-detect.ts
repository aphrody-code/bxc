/**
 * Détection automatique des anti-bot providers.
 *
 * Utilisé par Browser.newPage({ profile: "auto", escalate: true })
 * pour décider d'escalader vers un profil plus stealth.
 *
 * Sources :
 * - https://developers.cloudflare.com/waf/managed-challenge/
 * - https://techdocs.akamai.com/bot-manager/docs
 * - https://docs.datadome.co/docs/bot-detection
 */

export type ChallengeProvider =
	| "cloudflare-block"
	| "cloudflare-challenge"
	| "cloudflare-turnstile"
	| "akamai-bot-manager"
	| "perimeterx"
	| "datadome"
	| "kasada"
	| "incapsula"
	| "rate-limit"
	| "none";

export interface ChallengeDetection {
	provider: ChallengeProvider;
	confidence: "high" | "medium" | "low";
	recommendation: "static" | "fast" | "stealth" | "max" | "wait" | "abort";
	evidence: string[];
}

export interface ChallengeContext {
	url: string;
	status: number;
	headers: Headers;
	body: string;
}

export function detectChallenge(ctx: ChallengeContext): ChallengeDetection {
	const evidence: string[] = [];
	const headerEntries: [string, string][] = [];
	ctx.headers.forEach((v, k) => headerEntries.push([k.toLowerCase(), v]));
	const headers = new Map<string, string>(headerEntries);
	const body = ctx.body.slice(0, 50_000);
	const status = ctx.status;

	// --- Cloudflare ---
	const cfMitigated = headers.get("cf-mitigated");
	const cfRay = headers.get("cf-ray");
	const cfServer = headers.get("server")?.toLowerCase().includes("cloudflare");

	if (cfMitigated === "challenge" || /__cf_chl_opt|cf_chl_jschl|turnstile/i.test(body)) {
		evidence.push("cf-mitigated:challenge OR turnstile script detected");
		return {
			provider: "cloudflare-turnstile",
			confidence: "high",
			recommendation: "max",
			evidence,
		};
	}
	if (cfMitigated === "block" || (cfServer && status === 403)) {
		evidence.push(`cf block (status=${status}, mitigated=${cfMitigated})`);
		return {
			provider: "cloudflare-block",
			confidence: "high",
			recommendation: "stealth",
			evidence,
		};
	}
	if (cfRay && status >= 400 && status < 600) {
		evidence.push(`cf-ray=${cfRay} status=${status}`);
		return {
			provider: "cloudflare-challenge",
			confidence: "medium",
			recommendation: "stealth",
			evidence,
		};
	}

	// --- Akamai Bot Manager ---
	if (
		/<meta\s+name="bm-/i.test(body) ||
		headers.get("x-akamai-transformed") ||
		/_abck=/.test(headers.get("set-cookie") ?? "")
	) {
		evidence.push("akamai bot manager markers");
		return {
			provider: "akamai-bot-manager",
			confidence: "high",
			recommendation: "max",
			evidence,
		};
	}

	// --- DataDome ---
	if (
		/<script[^>]*id=["']datadome["']/i.test(body) ||
		headers.get("x-dd-b") ||
		/_dd[a-z]?=/.test(headers.get("set-cookie") ?? "")
	) {
		evidence.push("datadome script/cookie/header");
		return {
			provider: "datadome",
			confidence: "high",
			recommendation: "max",
			evidence,
		};
	}

	// --- PerimeterX ---
	if (/_pxhd=|_px[0-9]?=/.test(headers.get("set-cookie") ?? "") || /\/_px\//i.test(body)) {
		evidence.push("perimeterx cookie/url");
		return {
			provider: "perimeterx",
			confidence: "high",
			recommendation: "max",
			evidence,
		};
	}

	// --- Kasada ---
	if (/kasada|x-kpsdk-/.test(body) || headers.get("x-kpsdk-ct") || headers.get("x-kpsdk-st")) {
		evidence.push("kasada markers");
		return {
			provider: "kasada",
			confidence: "high",
			recommendation: "max",
			evidence,
		};
	}

	// --- Imperva / Incapsula ---
	if (
		/visid_incap|incap_ses/.test(headers.get("set-cookie") ?? "") ||
		/X-Iinfo|X-CDN: Incapsula/i.test(
			Array.from(headers)
				.map(([k, v]) => `${k}: ${v}`)
				.join("\n"),
		)
	) {
		evidence.push("incapsula cookie/header");
		return {
			provider: "incapsula",
			confidence: "high",
			recommendation: "stealth",
			evidence,
		};
	}

	// --- Rate limit (any provider) ---
	if (status === 429) {
		evidence.push("status=429");
		return {
			provider: "rate-limit",
			confidence: "high",
			recommendation: "wait",
			evidence,
		};
	}

	// --- No challenge detected ---
	return {
		provider: "none",
		confidence: "high",
		recommendation: "fast",
		evidence: ["no challenge markers found"],
	};
}

/** Heuristique pour décider du profil initial sans avoir requête d'abord. */
export function suggestInitialProfile(url: string): "static" | "fast" | "stealth" | "max" {
	const u = new URL(url);
	const host = u.hostname.toLowerCase();

	// Liste curated de domaines connus pour Cloudflare full / Akamai
	const knownHardTargets = [
		"linkedin.com",
		"twitter.com",
		"x.com",
		"facebook.com",
		"instagram.com",
		"tiktok.com",
		"amazon.com",
		"walmart.com",
		"bestbuy.com",
		"target.com",
		"nike.com",
		"adidas.com",
		"ticketmaster.com",
		"stubhub.com",
		"booking.com",
		"airbnb.com",
		"expedia.com",
	];
	if (knownHardTargets.some((d) => host === d || host.endsWith(`.${d}`))) {
		return "max";
	}

	// Domaines connus simples
	const knownSimple = ["example.com", "httpbin.org", "github.com", "wikipedia.org"];
	if (knownSimple.some((d) => host === d || host.endsWith(`.${d}`))) {
		return "fast";
	}

	return "fast"; // par défaut, on tente fast et on escalade si challenge
}
