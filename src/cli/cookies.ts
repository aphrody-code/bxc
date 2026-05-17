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
 * `bxc cookies <action>` — cookie jar tools.
 *
 * Actions:
 *   load <jar.json>    parse + summarize a cookie jar
 *
 * Stdout: JSON summary { total, fresh, masked[] }
 */

import { filterExpired, loadCookieJar, maskCookiesForLog } from "../cookies/cookie-loader.ts";

function printUsage(): void {
	Bun.stdout.write(
		`bxc cookies — cookie jar tools

Usage:
  bxc cookies load <jar.json>

Output (stdout): JSON { total, fresh, masked[] }

Supports formats: Playwright, CDP, Netscape, EditThisCookie.

Exit codes: 0 OK, 2 misuse, 65 data error, 70 software
`,
	);
}

export async function main(argv: readonly string[]): Promise<void> {
	const action = argv[0];
	if (!action || action === "--help" || action === "-h") {
		printUsage();
		process.exit(action ? 0 : 2);
	}

	switch (action) {
		case "load": {
			const file = argv[1];
			if (!file) {
				Bun.stderr.write("bxc cookies load <jar.json> — file argument missing\n");
				process.exit(2);
			}
			try {
				const cookies = await loadCookieJar(file);
				const fresh = filterExpired(cookies);
				const masked = maskCookiesForLog(fresh).split("\n").slice(0, 20);
				Bun.stdout.write(
					JSON.stringify({ total: cookies.length, fresh: fresh.length, masked }, null, 2) + "\n",
				);
			} catch (err) {
				Bun.stderr.write(
					`bxc cookies: ${err instanceof Error ? err.message : String(err)}\n`,
				);
				process.exit(65);
			}
			break;
		}
		default:
			Bun.stderr.write(`bxc cookies: unknown action '${action}'\n`);
			printUsage();
			process.exit(2);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
