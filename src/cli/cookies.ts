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
 * `bxc cookies` — cookie jar tools.
 */

import {
	filterExpired,
	loadCookieJar,
	saveCookieJar,
	maskCookiesForLog,
} from "../cookies/cookie-loader.ts";
import { getCookiesDir, resolveCookiePath } from "../utils/paths.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";
import { readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";

function printUsage(): void {
	Bun.stdout.write(
		`bxc cookies — cookie jar tools

Usage:
  bxc cookies load <jar.json|shortcut>              Load and validate cookies
  bxc cookies save <shortcut> <path_to_jar.json>    Save cookies to ~/.bxc/cookies/<shortcut>.json
  bxc cookies list                                  List all saved cookie jars in ~/.bxc/cookies
  bxc cookies show <shortcut>                       Show cookie metadata for a saved shortcut

Output (stdout): JSON format

Supports formats: Playwright, CDP, Netscape, EditThisCookie.

`,
	);
}

export async function main(
	argv: readonly string[],
	_opts: CommonOptions,
): Promise<void> {
	const action = argv[0];
	if (!action || action === "--help" || action === "-h") {
		printUsage();
		process.exit(action ? 0 : EXIT.MISUSE);
	}

	switch (action) {
		case "load": {
			const file = argv[1];
			if (!file) {
				logger.error(
					"load <jar.json|shortcut> — cookie jar target argument missing",
				);
				process.exit(EXIT.MISUSE);
			}
			try {
				const cookies = await loadCookieJar(file);
				const fresh = filterExpired(cookies);
				const masked = maskCookiesForLog(fresh).split("\n").slice(0, 20);
				Bun.stdout.write(
					JSON.stringify(
						{ total: cookies.length, fresh: fresh.length, masked },
						null,
						2,
					) + "\n",
				);
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				process.exit(EXIT.DATA_ERR);
			}
			break;
		}

		case "save": {
			const shortcut = argv[1];
			const sourceFile = argv[2];
			if (!shortcut || !sourceFile) {
				logger.error("save <shortcut> <path_to_jar.json> — missing arguments");
				process.exit(EXIT.MISUSE);
			}
			try {
				if (!existsSync(sourceFile)) {
					throw new Error(`Source file does not exist: ${sourceFile}`);
				}
				const cookies = await loadCookieJar(sourceFile);
				await saveCookieJar(shortcut, cookies);
				Bun.stdout.write(
					JSON.stringify(
						{
							ok: true,
							message: `Successfully saved ${cookies.length} cookies to shortcut '${shortcut}'`,
							path: resolveCookiePath(shortcut),
						},
						null,
						2,
					) + "\n",
				);
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				process.exit(EXIT.DATA_ERR);
			}
			break;
		}

		case "list": {
			try {
				const dir = getCookiesDir();
				const files = readdirSync(dir).filter(
					(f) => f.endsWith(".json") || f.endsWith(".txt"),
				);
				const list = [];
				for (const f of files) {
					try {
						const name = basename(f, f.endsWith(".json") ? ".json" : ".txt");
						const cookies = await loadCookieJar(join(dir, f));
						const fresh = filterExpired(cookies);
						list.push({
							shortcut: name,
							filename: f,
							total: cookies.length,
							fresh: fresh.length,
						});
					} catch {
						list.push({
							shortcut: f,
							filename: f,
							error: "Unrecognized cookie format or corrupted",
						});
					}
				}
				Bun.stdout.write(JSON.stringify(list, null, 2) + "\n");
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				process.exit(EXIT.SOFTWARE);
			}
			break;
		}

		case "show": {
			const shortcut = argv[1];
			if (!shortcut) {
				logger.error("show <shortcut> — shortcut argument missing");
				process.exit(EXIT.MISUSE);
			}
			try {
				const cookies = await loadCookieJar(shortcut);
				const fresh = filterExpired(cookies);
				const domains = [...new Set(cookies.map((c) => c.domain))];
				Bun.stdout.write(
					JSON.stringify(
						{
							shortcut,
							resolvedPath: resolveCookiePath(shortcut),
							total: cookies.length,
							fresh: fresh.length,
							domains,
						},
						null,
						2,
					) + "\n",
				);
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				process.exit(EXIT.DATA_ERR);
			}
			break;
		}

		default:
			logger.error(`unknown action '${action}'`);
			printUsage();
			process.exit(EXIT.MISUSE);
	}
}

if (import.meta.main) {
	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	main(remaining, opts).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
