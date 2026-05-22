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
 * @module bxc/google/signatures
 *
 * Curated, high-confidence fingerprints of Google's web stack, distilled from
 * aphrody's own reverse-engineering corpus:
 *
 *   - `crates/gemini-web`, `crates/gemini-runtime` — the live Gemini app wire
 *     (Boq `BardChatUi` RPC endpoints, `generativelanguage` API, model ids).
 *   - `docs/design/` + `crates/m3-tokens` — Material 3 / Gemini design tokens
 *     (`--md-sys-*`, `--bard-color-*`, `--gem-app-*`) and the Google Sans
 *     typeface family.
 *
 * These let `bxc profile` recognise *which* Google product/framework a page is
 * (Gemini app, Material 3, Boq/Wiz, generativelanguage API) with far more
 * precision than generic framework detection.
 */

/** CSS custom-property prefixes that uniquely mark the Gemini web app. */
export const GEMINI_APP_CSS_VARS = ["--bard-color-", "--gem-app-", "--gem-sys-"];

/** Material 3 design-token custom properties (Google Design system). */
export const M3_CSS_VARS = [
	"--md-sys-color-",
	"--md-sys-typescale-",
	"--md-sys-elevation-",
	"--md-sys-shape-",
	"--md-ref-palette-",
];

/** The open-sourced Google Sans family + legacy faces. */
export const GOOGLE_FONTS = [
	"Google Sans Text",
	"Google Sans Code",
	"Google Sans Flex",
	"Google Sans Mono",
	"Google Sans",
	"Product Sans",
	"Roboto",
];

/** Gemini app Boq RPC + generativelanguage API endpoint markers. */
export const GEMINI_ENDPOINTS = [
	"/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate",
	"/_/BardChatUi/data/batchexecute",
	"assistant.lamda.BardFrontendService",
	"generativelanguage.googleapis.com/v1beta",
];

/** Known Gemini model ids (for tagging API traffic / page payloads). */
export const GEMINI_MODELS = [
	"gemini-3-pro-preview",
	"gemini-3-flash-preview",
	"gemini-3-pro-image-preview",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"gemini-2.5-flash-lite",
];

/** Boq / Wiz (Google's first-party SPA framework) DOM + payload markers. */
export const BOQ_WIZ_MARKERS = [
	"BardChatUi",
	"AF_initDataChunkQueue",
	"WIZ_global_data",
	"jscontroller",
	"data-jsdata",
	"wiz_progress",
];

/** Gemini brand sweep (design.google), for theme/identity recognition. */
export const GEMINI_BRAND_COLORS = ["#4285F4", "#9B72CB", "#1BA1E3", "#3186ff"];

export interface StackRecognition {
	/** High-level product/framework tags, e.g. "gemini-app", "material-3". */
	tags: string[];
	/** Specific Gemini model ids found in the payload. */
	models: string[];
	/** Google Sans faces referenced. */
	fonts: string[];
}

function anyIn(haystack: string, needles: readonly string[]): string[] {
	return needles.filter((n) => haystack.includes(n));
}

/**
 * Recognise the Google stack of a captured page from its HTML, network APIs,
 * and live JS globals. Pure + synchronous — safe to run on every profile.
 */
export function recognizeStack(input: {
	html: string;
	apis: readonly string[];
	globals: readonly string[];
}): StackRecognition {
	const html = input.html;
	const apiBlob = input.apis.join("\n");
	const tags = new Set<string>();

	if (anyIn(html, GEMINI_APP_CSS_VARS).length > 0) tags.add("gemini-app");
	if (anyIn(html, M3_CSS_VARS).length > 0) tags.add("material-3");

	if (
		anyIn(apiBlob, GEMINI_ENDPOINTS).length > 0 ||
		anyIn(html, GEMINI_ENDPOINTS).length > 0
	) {
		tags.add("gemini-boq-api");
	}
	if (apiBlob.includes("generativelanguage.googleapis.com")) {
		tags.add("generativelanguage-api");
	}
	if (
		anyIn(html, BOQ_WIZ_MARKERS).length > 0 ||
		input.globals.some((g) => g === "wiz" || g === "WIZ_global_data")
	) {
		tags.add("boq-wiz");
	}
	if (anyIn(html, GOOGLE_FONTS).length > 0) tags.add("google-sans");
	if (anyIn(html, GEMINI_BRAND_COLORS).length > 0) tags.add("gemini-brand");

	const fonts = anyIn(html, GOOGLE_FONTS);
	const models = GEMINI_MODELS.filter(
		(m) => html.includes(m) || apiBlob.includes(m),
	);
	if (models.length > 0) tags.add("gemini-model");

	return { tags: [...tags].toSorted(), models, fonts };
}
