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
 * `bxc google <action> <arg>` — Google Ecosystem client & auditor
 */

import { GoogleClient } from "../google/client.ts";
import { EXIT, type CommonOptions, logger } from "./shared.ts";

interface CliOptions extends CommonOptions {
	action: "search" | "open" | "audit";
	params: string[];
	profile: "static" | "stealth" | "max";
}

function printUsage(): void {
	Bun.stdout.write(
		`bxc google — Google Ecosystem client & auditor (mandate compliant)

Usage:
  bxc google search <query>          Perform a search on Google Web
  bxc google open <url>              Visit a Google domain with mandate guard & audit
  bxc google audit <urls...>         Perform a massive concurrent audit on Google pages

Options:
  --profile <name>     stealth (default) | static | max
  --help, -h           this help

`,
	);
}

function parseArgs(
	argv: readonly string[],
	baseOpts: CommonOptions,
): CliOptions | null {
	const opts: CliOptions = {
		...baseOpts,
		action: "search",
		params: [],
		profile: "stealth",
	};

	const actionStr = argv[0];
	if (actionStr === "search") opts.action = "search";
	else if (actionStr === "open") opts.action = "open";
	else if (actionStr === "audit") opts.action = "audit";
	else {
		logger.error(`Unknown action: ${actionStr}`);
		return null;
	}

	const positional: string[] = [];
	for (let i = 1; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--profile": {
				const v = argv[++i] as any;
				if (v !== "static" && v !== "stealth" && v !== "max") {
					logger.error(`Invalid profile for Google client: ${v}`);
					return null;
				}
				opts.profile = v;
				break;
			}
			case "--help":
			case "-h":
				return null;
			default:
				if (!a.startsWith("-")) positional.push(a);
		}
	}

	if (positional.length < 1) {
		logger.error("requires at least one query/URL argument");
		return null;
	}
	opts.params = positional;
	return opts;
}

export async function main(
	argv: readonly string[],
	baseOpts: CommonOptions,
): Promise<void> {
	const opts = parseArgs(argv, baseOpts);
	if (!opts) {
		printUsage();
		process.exit(EXIT.MISUSE);
	}

	const client = new GoogleClient({
		profile: opts.profile,
		proxy: opts.proxy,
	});

	try {
		if (opts.action === "search") {
			const query = opts.params.join(" ");
			const results = await client.search(query);
			Bun.stdout.write(JSON.stringify(results, null, 2) + "\n");
		} else if (opts.action === "open") {
			const targetUrl = opts.params[0];
			const { page, audit } = await client.open(targetUrl);
			try {
				const title = await page.title();
				const content = await page.content();
				Bun.stdout.write(
					JSON.stringify(
						{
							url: targetUrl,
							title,
							htmlLength: content.length,
							audit,
						},
						null,
						2,
					) + "\n",
				);
			} finally {
				await page.close().catch(() => {});
			}
		} else {
			const results = await client.auditMassive(opts.params);
			Bun.stdout.write(JSON.stringify(results, null, 2) + "\n");
		}
	} catch (err) {
		logger.error(err instanceof Error ? err.message : String(err));
		process.exit(EXIT.DATA_ERR);
	}
}
