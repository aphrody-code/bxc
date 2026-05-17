#!/usr/bin/env bun
/**
 * apply-bxc-rebrand.ts — perform the bunlight → bxc rebrand.
 *
 * Reads reports/scan-v2-bun.json then, for every file with risk ∈ {safe,
 * manual_review}, applies the 7-axis substitutions in dependency order
 * (most-specific first, kebab last). Files with risk=keep are left alone.
 *
 * After text substitutions, performs `git mv` for each entry in
 * scan_metadata.rename_targets (directories first, then files, so a
 * directory rename takes its children with it before file-level mv).
 *
 * Idempotent: re-running produces no diff once converged.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { $ } from "bun";

interface AxisRule {
	id: string;
	pattern: RegExp;
	replacement: string;
}

const AXES: AxisRule[] = [
	// Order matters — most-specific first so that "@aphrody-code/bunlight" is
	// rewritten before the bare "bunlight" kebab pass would munge the scope.
	{
		id: "npm_scope",
		pattern: /@aphrody-code\/bunlight\b/g,
		replacement: "@aphrody-code/bxc",
	},
	{
		id: "ffi",
		pattern: /\blibbunlight(_rust_bridge)?\b/g,
		replacement: "libbxc$1",
	},
	{ id: "path", pattern: /\.bunlight\//g, replacement: ".bxc/" },
	// All remaining axes use NO word boundaries. The token "bunlight" is a
	// project-specific identifier — it never appears as a substring of an
	// unrelated word in our codebase. Dropping \b lets us match composites:
	//   __BUNLIGHT_VERSION__, BunlightAction, buildBunlightExe, __bunlightGhost.
	{ id: "SCREAMING", pattern: /BUNLIGHT/g, replacement: "BXC" },
	{ id: "Pascal", pattern: /Bunlight/g, replacement: "Bxc" },
	{ id: "snake", pattern: /bunlight_/g, replacement: "bxc_" },
	{ id: "kebab", pattern: /bunlight/g, replacement: "bxc" },
];

interface ScanV2 {
	scan_metadata: { repo_root: string };
	rename_targets: Array<{
		from: string;
		to: string;
		kind: "file" | "directory";
	}>;
	files: Array<{
		path: string;
		risk: "safe" | "manual_review" | "keep";
	}>;
}

async function main() {
	const dryRun = process.argv.includes("--dry-run");
	const v2 = JSON.parse(
		await Bun.file("reports/scan-v2-bun.json").text(),
	) as ScanV2;
	const repoRoot = v2.scan_metadata.repo_root;

	const stats: Record<string, number> = {
		files_patched: 0,
		files_unchanged: 0,
		files_skipped_keep: 0,
		files_missing: 0,
		by_axis: 0,
	};
	const axisHits: Record<string, number> = {};

	console.log(
		`apply-bxc-rebrand: ${dryRun ? "[DRY-RUN]" : "[LIVE]"} ${v2.files.length} files in scope`,
	);

	// --- Phase 1: text substitutions -------------------------------------
	for (const file of v2.files) {
		if (file.risk === "keep") {
			stats.files_skipped_keep++;
			continue;
		}
		const abs = resolve(repoRoot, file.path);
		let content: string;
		try {
			content = await Bun.file(abs).text();
		} catch {
			stats.files_missing++;
			console.warn(`  MISS  ${file.path}`);
			continue;
		}
		const original = content;
		for (const axis of AXES) {
			const before = content.length;
			const next = content.replace(axis.pattern, axis.replacement);
			if (next !== content) {
				// crude hit-count via re-scan since replace doesn't report it.
				const hits = (content.match(axis.pattern) ?? []).length;
				axisHits[axis.id] = (axisHits[axis.id] ?? 0) + hits;
				content = next;
			}
			// length delta is just for an extra sanity reassurance
			if (content.length === before && next !== original) {
				// no-op
			}
		}
		if (content !== original) {
			if (!dryRun) await Bun.write(abs, content);
			stats.files_patched++;
		} else {
			stats.files_unchanged++;
		}
	}

	console.log(
		`  text: patched=${stats.files_patched}  unchanged=${stats.files_unchanged}  ` +
			`keep=${stats.files_skipped_keep}  missing=${stats.files_missing}`,
	);
	console.log(
		`  hits per axis: ${Object.entries(axisHits)
			.map(([k, v]) => `${k}:${v}`)
			.join(" ")}`,
	);

	// --- Phase 2: file/dir renames via git mv ----------------------------
	// Sort: directories first (depth descending so deepest dirs first
	// — git mv recurses but moving parent first is fine), then files.
	const renames = [...v2.rename_targets].sort((a, b) => {
		if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
		// Same kind: longest path first (safer for nested renames).
		return b.from.length - a.from.length;
	});

	let mvDone = 0;
	let mvSkip = 0;
	let mvFail = 0;
	for (const tgt of renames) {
		const fromAbs = resolve(repoRoot, tgt.from);
		const toAbs = resolve(repoRoot, tgt.to);
		if (!existsSync(fromAbs)) {
			console.warn(`  MV-SKIP (missing source): ${tgt.from}`);
			mvSkip++;
			continue;
		}
		if (existsSync(toAbs)) {
			console.warn(`  MV-SKIP (target exists): ${tgt.to}`);
			mvSkip++;
			continue;
		}
		if (dryRun) {
			console.log(`  [dry] mv ${tgt.from} → ${tgt.to}`);
			mvDone++;
			continue;
		}
		mkdirSync(dirname(toAbs), { recursive: true });
		try {
			await $`git -C ${repoRoot} mv ${tgt.from} ${tgt.to}`.quiet();
			console.log(`  mv  ${tgt.from} → ${tgt.to}`);
			mvDone++;
		} catch (e) {
			console.warn(`  MV-FAIL ${tgt.from} → ${tgt.to}: ${e}`);
			mvFail++;
		}
	}
	console.log(`  mv: done=${mvDone}  skipped=${mvSkip}  failed=${mvFail}`);

	console.log(
		`\n${dryRun ? "DRY-RUN COMPLETE — no writes" : "REBRAND APPLIED"}.`,
	);
}

main().catch((err) => {
	console.error("apply-bxc-rebrand failed:", err);
	process.exit(1);
});
