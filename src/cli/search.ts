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
 * `bxc search <query>` — Google Web Search → clean results (text / JSON / Markdown).
 *
 * Uses the authenticated cookie jar at `~/.bxc/cookies/google.json` when present
 * (falls back to an anonymous request). Default transport is a native fetch,
 * with Lightpanda / curl-impersonate fallbacks.
 */

import {
	DEFAULT_GOOGLE_COOKIE_JAR,
	googleSearchRich,
	type RichSearchResult,
	type SearchOptions,
	type SearchTransport,
} from "../google/search.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

interface SearchCliOptions extends CommonOptions {
	query: string;
	hl: string;
	gl: string;
	num?: number;
	start?: number;
	domain?: string;
	safe: boolean;
	rich: boolean;
	markdown: boolean;
	transport: SearchTransport;
	cookies?: string | false;
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc search — Google Web Search → clean results

Usage:
  bxc search <query...> [options]

Options:
  --num <N>          results to request (default: Google's 10)
  --page <N>         result page (1-based; sets start = (N-1)*num)
  --start <N>        result offset (overrides --page)
  --hl <lang>        interface language (default: en)
  --gl <region>      region bias (default: US)
  --domain <host>    Google domain (default: google.com)
  --safe             enable SafeSearch
  --rich             include featured snippet / knowledge panel / PAA / related
  --markdown         render results as Markdown
  --json             emit the full structured result as JSON
  --transport <t>    auto (default) | fetch | ghost | http
  --cookies <path>   cookie jar to authenticate with
  --no-auth          force an anonymous request (ignore the cookie jar)
  --help, -h         this help

Auth: uses ${DEFAULT_GOOGLE_COOKIE_JAR} when present.

Examples:
  bxc search "bun runtime" --num 5
  bxc search rust async --json
  bxc search "actualité ia" --hl fr --gl FR --markdown
`,
	);
}

function parseArgs(argv: readonly string[], baseOpts: CommonOptions): SearchCliOptions | null {
	const opts: SearchCliOptions = {
		...baseOpts,
		query: "",
		hl: "en",
		gl: "US",
		safe: false,
		rich: false,
		markdown: false,
		transport: "auto",
	};
	const positional: string[] = [];
	let page: number | undefined;

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--num":
				opts.num = parseInt(argv[++i] ?? "", 10);
				break;
			case "--page":
				page = parseInt(argv[++i] ?? "", 10);
				break;
			case "--start":
				opts.start = parseInt(argv[++i] ?? "", 10);
				break;
			case "--hl":
				opts.hl = argv[++i] ?? opts.hl;
				break;
			case "--gl":
				opts.gl = argv[++i] ?? opts.gl;
				break;
			case "--domain":
				opts.domain = argv[++i];
				break;
			case "--safe":
				opts.safe = true;
				break;
			case "--rich":
				opts.rich = true;
				break;
			case "--markdown":
				opts.markdown = true;
				break;
			case "--transport": {
				const t = argv[++i] as SearchTransport;
				if (t !== "auto" && t !== "fetch" && t !== "ghost" && t !== "http") {
					logger.error(`Invalid transport: ${t}`);
					return null;
				}
				opts.transport = t;
				break;
			}
			case "--cookies":
				opts.cookies = argv[++i];
				break;
			case "--no-auth":
				opts.cookies = false;
				break;
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}

	if (positional.length === 0) {
		logger.error("requires a <query>");
		return null;
	}
	opts.query = positional.join(" ");

	if (opts.start === undefined && page !== undefined && Number.isFinite(page)) {
		opts.start = Math.max(0, (page - 1) * (opts.num ?? 10));
	}
	return opts;
}

function toSearchOptions(opts: SearchCliOptions): SearchOptions {
	return {
		hl: opts.hl,
		gl: opts.gl,
		num: opts.num,
		start: opts.start,
		domain: opts.domain,
		safe: opts.safe ? "active" : undefined,
		classic: !opts.rich,
		transport: opts.transport,
		cookies: opts.cookies,
	};
}

function renderMarkdown(r: RichSearchResult, query: string): string {
	const lines: string[] = [`# Search: ${query}`, ""];
	if (r.correctedQuery) lines.push(`> Showing results for **${r.correctedQuery}**`, "");
	if (r.featuredSnippet) {
		lines.push(`## Featured snippet`, "", `**${r.featuredSnippet.title}**`, "");
		if (r.featuredSnippet.content) lines.push(r.featuredSnippet.content, "");
		if (r.featuredSnippet.url) lines.push(`Source: ${r.featuredSnippet.url}`, "");
	}
	if (r.knowledgePanel?.title) {
		lines.push(`## ${r.knowledgePanel.title}`, "");
		if (r.knowledgePanel.description) lines.push(r.knowledgePanel.description, "");
		for (const [k, v] of Object.entries(r.knowledgePanel.metadata)) lines.push(`- **${k}**: ${v}`);
		lines.push("");
	}
	lines.push(`## Results (${r.organic.length})`, "");
	for (const o of r.organic) {
		lines.push(`${o.position}. [${o.title}](${o.url})`);
		if (o.snippet) lines.push(`   ${o.snippet}`);
	}
	if (r.peopleAlsoAsk.length) {
		lines.push("", `## People also ask`, "");
		for (const q of r.peopleAlsoAsk) lines.push(`- ${q}`);
	}
	if (r.relatedSearches.length) {
		lines.push("", `## Related searches`, "");
		for (const q of r.relatedSearches) lines.push(`- ${q}`);
	}
	return lines.join("\n") + "\n";
}

function renderText(r: RichSearchResult): string {
	const lines: string[] = [];
	if (r.correctedQuery) lines.push(`(showing results for "${r.correctedQuery}")`, "");
	if (r.featuredSnippet?.content) {
		lines.push(`★ ${r.featuredSnippet.title}`, `  ${r.featuredSnippet.content}`, "");
	}
	for (const o of r.organic) {
		lines.push(`${o.position}. ${o.title}`);
		lines.push(`   ${o.url}`);
		if (o.snippet) lines.push(`   ${o.snippet}`);
		lines.push("");
	}
	const meta = r.totalResults ? `~${r.totalResults.toLocaleString()} results` : "";
	lines.push(`[${r.organic.length} parsed${meta ? ` · ${meta}` : ""} · ${r.profileUsed}${r.authenticated ? " · auth" : ""}]`);
	return lines.join("\n") + "\n";
}

export async function main(argv: readonly string[], baseOpts: CommonOptions): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	try {
		const rich = await googleSearchRich(opts.query, toSearchOptions(opts));

		if (opts.json) {
			const { jsonLd: _jsonLd, ...rest } = rich;
			Bun.stdout.write(JSON.stringify(rest, null, 2) + "\n");
		} else if (opts.markdown) {
			Bun.stdout.write(renderMarkdown(rich, opts.query));
		} else {
			Bun.stdout.write(renderText(rich));
		}

		if (rich.organic.length === 0) process.exit(EXIT.DATA_ERR);
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
