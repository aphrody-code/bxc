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
 * `bxc detect <url>` — multi-signal technology detection.
 */

import { detectFrameworks } from "../detect.ts";
import { type DeepDetectionResult, deepDetect } from "../detect-deep.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

interface DetectCliOptions extends CommonOptions {
	url: string;
	wappOnly: boolean;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc detect — multi-signal technology fingerprinting

Usage:
  bxc detect <url> [options]

Options:
  --wapp-only     skip DNS / IP / body / CSP — only run wappalyzergo
  --json          emit structured JSON (default: human-readable Markdown)
  --help, -h      this help

`,
	);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): DetectCliOptions | null {
	const opts: DetectCliOptions = { ...baseOpts, url: "", wappOnly: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--wapp-only":
				opts.wappOnly = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!opts.url && /^https?:\/\//.test(a)) opts.url = a;
				else if (a.startsWith("-")) {
					logger.error(`unknown option ${a}`);
					return null;
				}
		}
	}
	if (!opts.url) {
		logger.error("URL argument required");
		return null;
	}
	return opts;
}

function renderMarkdown(r: DeepDetectionResult): string {
	const lines: string[] = [];
	lines.push(`# Detection report — ${r.url}`);
	lines.push("");
	lines.push(`- HTTP: ${r.httpStatus}`);
	lines.push(`- Hostname: \`${r.hostname}\``);
	if (r.finalUrl !== r.url) lines.push(`- Final URL: ${r.finalUrl}`);
	if (r.resolvedIps.length > 0) lines.push(`- Resolved IPs: ${r.resolvedIps.join(", ")}`);
	if (r.cnameChain.length > 0) lines.push(`- CNAME chain: ${r.cnameChain.join(" → ")}`);
	if (r.nsRecords.length > 0) lines.push(`- NS records: ${r.nsRecords.slice(0, 4).join(", ")}`);
	for (const [ip, ptrs] of Object.entries(r.reversePtr)) {
		if (ptrs.length > 0) lines.push(`- Reverse PTR \`${ip}\`: ${ptrs.join(", ")}`);
	}
	lines.push("");

	const sections: Array<{ title: string; items: typeof r.frontend }> = [
		{ title: "Frontend", items: r.frontend },
		{ title: "Backend", items: r.backend },
		{ title: "CDN", items: r.cdn },
		{ title: "DNS", items: r.dns },
		{ title: "Hosting", items: r.hosting },
		{ title: "Server", items: r.server },
		{ title: "CMS", items: r.cms },
		{ title: "Language", items: r.language },
		{ title: "Analytics", items: r.analytics },
		{ title: "Tag Managers", items: r.tagManagers },
		{ title: "Build framework", items: r.framework },
		{ title: "Libraries", items: r.library },
		{ title: "Other", items: r.other },
	];

	for (const { title, items } of sections) {
		if (items.length === 0) continue;
		lines.push(`## ${title}`);
		lines.push("");
		lines.push(`| Name | Evidence | Source | Conf | Version |`);
		lines.push(`|---|---|---|---|---|`);
		for (const e of items) {
			const ev = e.evidence.replace(/\|/g, "/").slice(0, 80);
			const conf = e.confidence !== undefined ? e.confidence.toFixed(2) : "—";
			lines.push(`| ${e.name} | \`${ev}\` | ${e.source} | ${conf} | ${e.version ?? "—"} |`);
		}
		lines.push("");
	}

	return lines.join("\n");
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(opts === null ? EXIT.MISUSE : EXIT.OK);
	}

	try {
		if (opts.wappOnly) {
			const result = await detectFrameworks(opts.url, { insecure: opts.insecure });
			Bun.stdout.write(JSON.stringify(result, null, 2) + "\n");
			return;
		}

		const result = await deepDetect(opts.url, opts.insecure);
		const rendered = opts.json ? JSON.stringify(result, null, 2) : renderMarkdown(result);
		Bun.stdout.write(rendered + "\n");
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
