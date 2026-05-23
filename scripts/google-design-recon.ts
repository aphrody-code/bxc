#!/usr/bin/env bun
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
 * google-design-recon.ts — "tout savoir de Google Design".
 *
 * Exploits the best of bxc against Google's design surfaces:
 *   - `profileSite` (real Chrome / static) → HTML + CSS + JS + network/API +
 *     frameworks + JS globals.
 *   - `recognizeStack` (signatures distilled from aphrody's RE corpus) →
 *     high-confidence tags (material-3, gemini-app, google-sans, boq-wiz…).
 *   - the self-reinforcing corpus → cross-run accumulation.
 *
 * Targets (Google design canon): design.google, m3.material.io, fonts.google.com,
 * the Gemini app, Android developer Material, AI Studio.
 *
 * Output: a consolidated dossier (Markdown + JSON) under
 *   var/google-design/ — frameworks, M3 token surface, Google Sans usage,
 *   Gemini/Boq API endpoints, and the merged corpus snapshot.
 *
 * Usage:
 *   bun scripts/google-design-recon.ts                 # all targets, profile=max
 *   bun scripts/google-design-recon.ts --profile static
 *   bun scripts/google-design-recon.ts --targets design,material,fonts
 *   bun scripts/google-design-recon.ts --out var/google-design
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import {
	profileSite,
	type GoogleProfile,
} from "../src/google/profiler.ts";
import { loadCorpus } from "../src/google/corpus.ts";
import {
	M3_CSS_VARS,
	GOOGLE_FONTS,
	GEMINI_APP_CSS_VARS,
} from "../src/google/signatures.ts";

const ROOT = join(import.meta.dir, "..");

const DESIGN_TARGETS = [
	"design", // design.google — Google Design library
	"material", // m3.material.io — Material 3 spec
	"fonts", // fonts.google.com — Google Sans / type
	"gemini", // gemini.google.com — Gemini visual language (live)
	"aistudio", // aistudio.google.com — Gemini/AI surfaces
] as const;

interface Args {
	profile: "static" | "fast" | "http" | "stealth" | "max";
	targets: string[];
	out: string;
	insecure: boolean;
	chromeProfile: string;
}

function parseArgs(argv: readonly string[]): Args {
	const out: Args = {
		profile: "max",
		targets: [...DESIGN_TARGETS],
		out: join(ROOT, "var", "google-design"),
		insecure: false,
		chromeProfile: process.env["BXC_CHROME_PROFILE"] ?? "Profile 5",
	};
	for (let i = 0; i < argv.length; i++) {
		switch (argv[i]) {
			case "--profile":
				out.profile = argv[++i] as Args["profile"];
				break;
			case "--targets":
				out.targets = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
				break;
			case "--out":
				out.out = argv[++i];
				break;
			case "--chrome-profile":
				out.chromeProfile = argv[++i];
				break;
			case "--insecure":
			case "-k":
				out.insecure = true;
				break;
		}
	}
	return out;
}

/** Count how many distinct M3 / Gemini / font signatures a profile carries. */
function designFootprint(p: GoogleProfile): {
	m3Vars: number;
	geminiVars: number;
	fonts: string[];
	apiHosts: string[];
} {
	const html = ""; // html not retained on the profile; use recognized + apis
	void html;
	const apiHosts = [
		...new Set(
			p.apis
				.map((a) => a.split("/")[0])
				.filter((h) => h.includes("google") || h.includes("gstatic")),
		),
	].sort();
	return {
		m3Vars: p.recognized.tags.includes("material-3") ? M3_CSS_VARS.length : 0,
		geminiVars: p.recognized.tags.includes("gemini-app") ? GEMINI_APP_CSS_VARS.length : 0,
		fonts: p.recognized.fonts,
		apiHosts,
	};
}

function dossierMarkdown(profiles: GoogleProfile[]): string {
	const lines: string[] = [
		"<!-- SPDX-License-Identifier: Apache-2.0 -->",
		"# Google Design — dossier bxc",
		"",
		`Généré ${new Date().toISOString()} · ${profiles.length} cibles profilées.`,
		"",
		"## Synthèse par cible",
		"",
		"| Cible | URL finale | recognized | frameworks | css/js/api | fonts |",
		"|---|---|---|---|---|---|",
	];
	for (const p of profiles) {
		const fp = designFootprint(p);
		lines.push(
			`| ${p.target} | ${p.finalUrl} | ${p.recognized.tags.join(" ") || "—"} | ` +
				`${p.frameworks.slice(0, 4).join(" ") || "—"} | ` +
				`${p.css.length}/${p.js.length}/${p.apis.length} | ${fp.fonts.join(" ") || "—"} |`,
		);
	}

	// Aggregate signals across all targets.
	const allTags = new Set<string>();
	const allFonts = new Set<string>();
	const allApiHosts = new Set<string>();
	const allModels = new Set<string>();
	for (const p of profiles) {
		p.recognized.tags.forEach((t) => allTags.add(t));
		p.recognized.fonts.forEach((f) => allFonts.add(f));
		p.recognized.models.forEach((m) => allModels.add(m));
		designFootprint(p).apiHosts.forEach((h) => allApiHosts.add(h));
	}
	lines.push(
		"",
		"## Signaux agrégés (tout Google Design)",
		"",
		`- **Stacks reconnus** : ${[...allTags].sort().join(", ") || "—"}`,
		`- **Familles de fontes** : ${[...allFonts].sort().join(", ") || "—"}`,
		`- **Hôtes d'API** : ${[...allApiHosts].sort().join(", ") || "—"}`,
		`- **Modèles Gemini vus** : ${[...allModels].sort().join(", ") || "—"}`,
		"",
		"## Tokens & typographie de référence (signatures bxc)",
		"",
		`- Material 3 CSS vars surveillées : ${M3_CSS_VARS.map((v) => "`" + v + "`").join(", ")}`,
		`- Gemini app CSS vars : ${GEMINI_APP_CSS_VARS.map((v) => "`" + v + "`").join(", ")}`,
		`- Google Sans family : ${GOOGLE_FONTS.join(", ")}`,
		"",
		"> Le corpus auto-renforçant (`storage/google-profiles/corpus.json`) accumule",
		"> ces signaux à chaque exécution — relancer ce script affine le dossier.",
	);
	return lines.join("\n");
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	await mkdir(args.out, { recursive: true });

	const profiles: GoogleProfile[] = [];
	for (const target of args.targets) {
		console.error(`[recon] profiling ${target} (profile=${args.profile}) …`);
		try {
			const p = await profileSite(target, {
				profile: args.profile,
				insecure: args.insecure,
				// Drive the logged-in profile on the `max` path; profileSite
				// snapshots it so capture works while the user's Chrome is open.
				chromeProfile: args.chromeProfile,
			});
			profiles.push(p);
			console.error(
				`[recon]   ${target}: ${p.recognized.tags.join(" ") || "no-google-tags"} · ` +
					`${p.css.length} css / ${p.js.length} js / ${p.apis.length} api`,
			);
		} catch (err) {
			console.error(`[recon]   ${target} FAILED: ${err instanceof Error ? err.message : String(err)}`);
		}
		// Let Chrome + the snapshot temp dir tear down before the next launch.
		// Sequential real-Chrome launches in one process are resource-heavy; a
		// brief pause keeps long multi-target runs stable.
		await new Promise((r) => setTimeout(r, 750));
	}

	if (profiles.length === 0) {
		console.error("[recon] no target profiled");
		process.exit(1);
	}

	// Persist the dossier. Merge with any prior run by target (current wins) so
	// short, reliable batches accumulate into one complete dossier instead of
	// overwriting it — sequential real-Chrome launches are flaky past ~3 per
	// process, so batching + merge is the robust path.
	const jsonPath = join(args.out, "dossier.json");
	const mdPath = join(args.out, "DOSSIER.md");
	const byTarget = new Map<string, GoogleProfile>();
	const prior = (await Bun.file(jsonPath)
		.json()
		.catch(() => [])) as GoogleProfile[];
	for (const p of Array.isArray(prior) ? prior : []) byTarget.set(p.target, p);
	for (const p of profiles) byTarget.set(p.target, p);
	const order = DESIGN_TARGETS as readonly string[];
	const merged = [...byTarget.values()].sort(
		(a, b) =>
			(order.indexOf(a.target) + 1 || 99) - (order.indexOf(b.target) + 1 || 99),
	);
	await Bun.write(jsonPath, JSON.stringify(merged, null, 2));
	await Bun.write(mdPath, dossierMarkdown(merged));
	await Bun.write(
		join(args.out, "corpus-snapshot.json"),
		JSON.stringify(await loadCorpus(), null, 2),
	);

	console.error(`[recon] dossier → ${mdPath} (${merged.length} targets)`);
	Bun.stdout.write(dossierMarkdown(merged) + "\n");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
