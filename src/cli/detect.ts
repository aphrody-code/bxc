#!/usr/bin/env bun

/**
 * `bunlight detect <url>` — multi-signal technology detection.
 *
 * Combines:
 *   - HTTP response headers (Server, X-Powered-By, CF-Ray, X-Vercel-*, ...)
 *   - DNS records (NS, A, CNAME, reverse PTR)
 *   - IP-to-CDN range matching (Cloudflare, Fastly, CloudFront, Akamai, ...)
 *   - HTML body signatures (Next.js, Nuxt, Astro, WordPress, ...)
 *   - CSP-allowed hosts (often expose backend CMS)
 *   - Wappalyzergo (JS libraries, tag managers, ...)
 *
 * Output buckets: frontend / backend / cdn / dns / hosting / server /
 * language / cms / analytics / tagManagers / framework / library / other.
 *
 * Exit codes: 0 success, 2 misuse, 65 fetch error
 */

import { detectFrameworks } from "../detect.ts";
import { type DeepDetectionResult, deepDetect } from "../detect-deep.ts";

interface DetectCliOptions {
	url: string;
	emitJson: boolean;
	wappOnly: boolean;
}

function printUsage(): void {
	process.stdout.write(
		`bunlight detect — multi-signal technology fingerprinting

Usage:
  bunlight detect <url> [options]

Options:
  --json          emit structured JSON (default: human-readable Markdown)
  --wapp-only     skip DNS / IP / body / CSP — only run wappalyzergo
  --help, -h      this help

Output buckets (in JSON / Markdown):
  - frontend       React, Next.js, Vue, Astro, ...
  - backend        Django, Rails, Wagtail, Express, ...
  - cdn            Cloudflare, Fastly, CloudFront, Akamai, ...
  - dns            Cloudflare DNS, AWS Route 53, Google Cloud DNS, ...
  - hosting        Vercel, Netlify, GAE, Cloud Run, S3, ...
  - server         nginx, Apache, Caddy, IIS, ...
  - language       PHP, JS, ...
  - cms            WordPress, Drupal, Wagtail, Strapi, Sanity, ...
  - analytics      Google Analytics, Plausible, Matomo, PostHog, ...
  - tagManagers    GTM, ...
  - framework      Webpack, Vite, Turbopack, Parcel
  - library        Tailwind, jQuery, D3, Three.js, HTMX, Alpine.js, ...

Sources of evidence:
  - header   — HTTP response header (highest confidence)
  - dns      — NS / CNAME / reverse PTR records
  - ip       — A record matched against published CDN ranges
  - body     — pattern in rendered HTML / generator meta
  - csp      — host listed in Content-Security-Policy
  - wappalyzer — wappalyzergo binary

Examples:
  bunlight detect https://design.google
  bunlight detect https://nextjs.org --json
  bunlight detect https://example.com --wapp-only

Exit codes: 0 OK, 2 misuse, 65 data error
`,
	);
}

function parseArgs(argv: readonly string[]): DetectCliOptions | null {
	const opts: DetectCliOptions = { url: "", emitJson: false, wappOnly: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--json":
				opts.emitJson = true;
				break;
			case "--wapp-only":
				opts.wappOnly = true;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!opts.url && /^https?:\/\//.test(a)) opts.url = a;
				else if (a.startsWith("-")) {
					process.stderr.write(`bunlight detect: unknown option ${a}\n`);
					return null;
				}
		}
	}
	if (!opts.url) {
		process.stderr.write("bunlight detect: URL argument required\n");
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

export async function main(argv: readonly string[]): Promise<void> {
	const opts = parseArgs(argv);
	if (!opts) {
		printUsage();
		process.exit(opts === null ? 2 : 0);
	}

	try {
		if (opts.wappOnly) {
			const result = await detectFrameworks(opts.url);
			process.stdout.write(JSON.stringify(result, null, 2) + "\n");
			return;
		}

		const result = await deepDetect(opts.url);
		const rendered = opts.emitJson ? JSON.stringify(result, null, 2) : renderMarkdown(result);
		process.stdout.write(rendered + "\n");
	} catch (err) {
		process.stderr.write(`bunlight detect: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(65);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
