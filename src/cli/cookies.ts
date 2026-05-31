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
 * `bxc cookies <action>` — cookie jar tools.
 */

import {
	filterExpired,
	loadCookieJar,
	maskCookiesForLog,
} from "../cookies/cookie-loader.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

function printUsage(): void {
	Bun.stdout.write(
		`bxc cookies — cookie jar tools

Usage:
  bxc cookies load <jar.json>

Output (stdout): JSON { total, fresh, masked[] }

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
				logger.error("load <jar.json> — file argument missing");
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
