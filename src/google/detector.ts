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
 * @module bunlight/google/detector
 *
 * Specialized fingerprinting for Google-specific frameworks and anti-bot signals.
 */

import type { DetectedTech } from "../detect.ts";
import { isGoogleDomain } from "./dns.ts";

export interface GoogleDetection {
	isGoogleOwned: boolean;
	isMaterialDesign: boolean;
	framework: "angular" | "lit" | "wiz" | "internal" | "none";
	hasAntiBot: boolean;
	/** Specific anti-bot mechanism, when identifiable. */
	antiBotKind:
		| "recaptcha-v2"
		| "recaptcha-v3"
		| "recaptcha-enterprise"
		| "captcha-form"
		| null;
	/** Detected first-party Google products, e.g. ["Gemini", "Firebase", "GTM"]. */
	products: string[];
	/** Hosting signal: appspot, firebase, cloud-run, none. */
	hosting: "appspot" | "firebase" | "cloud-run" | "google-sites" | "none";
	evidence: string[];
}

const GOOGLE_MARKERS_REGEX =
	/(ng-version|ng-app|_nghost-|lit-html|<lit-|jsaction="|jscontroller="|tensorflow|tfjs|flutter|flt-|firebase|google-cloud|gcp|kubernetes|k8s|golang|go\.dev|material-components-web|mdc-|m3-|google\.com\/recaptcha|grecaptcha|recaptcha\/enterprise|recaptcha\/api2|gemini|bard\.google|vertex|aistudio|generativelanguage|workspace|gsuite|appspot\.com|firebase-app|googletagmanager|gtag\.js|analytics\.js|adsense|doubleclick|gtm\.js|youtube\.com\/embed|google-pay|stadia|chrome-extension|polymer)/g;

/**
 * Perform deep detection on Google sites using headers and body.
 */
export function detectGoogleSpecifics(
	url: string,
	headers: Headers | Map<string, string>,
	body: string,
): GoogleDetection {
	const evidence: string[] = [];
	let hostname = "";
	try {
		hostname = new URL(url).hostname;
	} catch {}
	const isGoogleOwned = isGoogleDomain(hostname);

	if (isGoogleOwned) evidence.push("hostname matches google domain list");

	// Framework detection
	let framework: GoogleDetection["framework"] = "none";

	// Single highly optimized V8 regex pass
	const matchesArray = body.match(GOOGLE_MARKERS_REGEX);
	const matches = matchesArray ? new Set(matchesArray) : new Set<string>();

	if (
		matches.has("ng-version") ||
		matches.has("ng-app") ||
		matches.has("_nghost-")
	) {
		framework = "angular";
		evidence.push("angular markers (ng-version/ng-app) found");
	} else if (matches.has("lit-html") || matches.has("<lit-")) {
		framework = "lit";
		evidence.push("lit markers found");
	} else if (matches.has('jsaction="') && matches.has('jscontroller="')) {
		// Wiz is Google's internal framework used in search, gemini, etc.
		framework = "wiz";
		evidence.push("wiz markers (jsaction/jscontroller) found");
	}

	// Library/Project detection
	if (matches.has("tensorflow") || matches.has("tfjs"))
		evidence.push("TensorFlow detected");
	if (matches.has("flutter") || matches.has("flt-"))
		evidence.push("Flutter detected");
	if (matches.has("firebase")) evidence.push("Firebase detected");
	if (matches.has("google-cloud") || matches.has("gcp"))
		evidence.push("GCP signals detected");
	if (matches.has("kubernetes") || matches.has("k8s"))
		evidence.push("Kubernetes signals detected");
	if (matches.has("golang") || matches.has("go.dev"))
		evidence.push("Go signals detected");

	// Material Design detection
	let isMaterialDesign =
		hostname.includes("material.io") || hostname.includes("design.google");

	if (
		!isMaterialDesign &&
		(matches.has("material-components-web") ||
			matches.has("mdc-") ||
			matches.has("m3-"))
	) {
		isMaterialDesign = true;
	}

	if (isMaterialDesign) evidence.push("material design markers found");

	// Anti-bot detection (Google specific)
	let hasAntiBot = false;
	let antiBotKind: GoogleDetection["antiBotKind"] = null;
	if (
		body.includes("recaptcha/enterprise") ||
		body.includes("enterprise.js?render=")
	) {
		hasAntiBot = true;
		antiBotKind = "recaptcha-enterprise";
		evidence.push("reCAPTCHA Enterprise detected");
	} else if (
		matches.has("grecaptcha") &&
		(body.includes("grecaptcha.execute(") || body.includes("data-action="))
	) {
		hasAntiBot = true;
		antiBotKind = "recaptcha-v3";
		evidence.push("reCAPTCHA v3 detected (invisible)");
	} else if (matches.has("google.com/recaptcha") || matches.has("grecaptcha")) {
		hasAntiBot = true;
		antiBotKind = "recaptcha-v2";
		evidence.push("reCAPTCHA v2 detected");
	}
	if (body.includes('id="captcha-form"') || body.includes("CaptchaForm")) {
		hasAntiBot = true;
		if (!antiBotKind) antiBotKind = "captcha-form";
		evidence.push("Google captcha-form detected");
	}

	// Check for udm=14 usage (Classic Web View)
	if (url.includes("udm=14")) {
		evidence.push("Classic Web View (udm=14) enforced");
	}

	// Check for rate limit / bot block headers
	const status =
		headers instanceof Headers ? headers.get("status") : headers.get("status");
	if (headers.has("x-google-gfe-request-trace") && status === "429") {
		hasAntiBot = true;
		evidence.push("google GFE rate limit (429) with trace header");
	}

	// Infra markers
	if (body.includes("gstatic.com") || body.includes("googleapis.com")) {
		evidence.push("Google CDN usage detected");
	}

	// Product detection
	const products: string[] = [];
	if (matches.has("gemini") || hostname.includes("gemini.google"))
		products.push("Gemini");
	if (matches.has("bard.google")) products.push("Bard");
	if (matches.has("vertex") || matches.has("aistudio"))
		products.push("Vertex AI");
	if (matches.has("generativelanguage"))
		products.push("Generative Language API");
	if (matches.has("firebase") || matches.has("firebase-app"))
		products.push("Firebase");
	if (matches.has("googletagmanager") || matches.has("gtm.js"))
		products.push("Google Tag Manager");
	if (matches.has("gtag.js") || matches.has("analytics.js"))
		products.push("Google Analytics");
	if (matches.has("adsense")) products.push("AdSense");
	if (matches.has("doubleclick")) products.push("DoubleClick");
	if (matches.has("youtube.com/embed")) products.push("YouTube Embed");
	if (matches.has("google-pay")) products.push("Google Pay");
	if (matches.has("workspace") || matches.has("gsuite"))
		products.push("Google Workspace");

	// Hosting signals
	let hosting: GoogleDetection["hosting"] = "none";
	if (hostname.endsWith(".appspot.com") || matches.has("appspot.com"))
		hosting = "appspot";
	else if (
		hostname.endsWith(".firebaseapp.com") ||
		hostname.endsWith(".web.app")
	)
		hosting = "firebase";
	else if (hostname.endsWith(".run.app")) hosting = "cloud-run";
	else if (hostname.endsWith(".sites.google.com")) hosting = "google-sites";
	if (hosting !== "none") evidence.push(`hosting: ${hosting}`);

	return {
		isGoogleOwned,
		isMaterialDesign,
		framework,
		hasAntiBot,
		antiBotKind,
		products,
		hosting,
		evidence,
	};
}

/**
 * Map Google-specific detection to DetectedTech format for compatibility with generic router.
 */
export function googleToTech(detection: GoogleDetection): DetectedTech[] {
	const techs: DetectedTech[] = [];

	if (detection.isGoogleOwned) {
		techs.push({ name: "Google", categories: ["Cloud PaaS"] });
	}

	if (detection.isMaterialDesign) {
		techs.push({ name: "Material Design", categories: ["UI frameworks"] });
	}

	// Project mapping
	const projectMap: Record<string, string> = {
		TensorFlow: "TensorFlow",
		Flutter: "Flutter",
		Firebase: "Firebase",
		GCP: "Google Cloud Platform",
		Kubernetes: "Kubernetes",
		Go: "Go",
	};

	for (const evidence of detection.evidence) {
		for (const [key, name] of Object.entries(projectMap)) {
			if (evidence.includes(key)) {
				techs.push({ name, categories: ["Libraries", "Development"] });
			}
		}
	}

	if (detection.framework !== "none") {
		const names = {
			angular: "Angular",
			lit: "Lit",
			wiz: "Wiz (Google Internal)",
			internal: "Google Internal",
		};
		techs.push({
			name: names[detection.framework as keyof typeof names],
			categories: ["JavaScript frameworks"],
		});
	}

	if (detection.hasAntiBot) {
		const antiBotName = detection.antiBotKind
			? `Google Anti-Bot (${detection.antiBotKind})`
			: "Google Anti-Bot";
		techs.push({ name: antiBotName, categories: ["Security"] });
	}

	for (const product of detection.products) {
		techs.push({ name: product, categories: ["Google Products"] });
	}

	if (detection.hosting !== "none") {
		const hostingMap = {
			appspot: "Google App Engine",
			firebase: "Firebase Hosting",
			"cloud-run": "Google Cloud Run",
			"google-sites": "Google Sites",
		} as const;
		techs.push({
			name: hostingMap[detection.hosting],
			categories: ["PaaS", "Hosting"],
		});
	}

	return techs;
}
