#!/usr/bin/env bun
/**
 * `bunlight cookies <action>` — cookie jar tools.
 *
 * Actions:
 *   load <jar.json>    parse + summarize a cookie jar
 *
 * Stdout: JSON summary { total, fresh, masked[] }
 */

import { filterExpired, loadCookieJar, maskCookiesForLog } from "../cookies/cookie-loader.ts";

function printUsage(): void {
	process.stdout.write(
		`bunlight cookies — cookie jar tools

Usage:
  bunlight cookies load <jar.json>

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
				process.stderr.write("bunlight cookies load <jar.json> — file argument missing\n");
				process.exit(2);
			}
			try {
				const cookies = await loadCookieJar(file);
				const fresh = filterExpired(cookies);
				const masked = maskCookiesForLog(fresh).split("\n").slice(0, 20);
				process.stdout.write(
					JSON.stringify({ total: cookies.length, fresh: fresh.length, masked }, null, 2) + "\n",
				);
			} catch (err) {
				process.stderr.write(
					`bunlight cookies: ${err instanceof Error ? err.message : String(err)}\n`,
				);
				process.exit(65);
			}
			break;
		}
		default:
			process.stderr.write(`bunlight cookies: unknown action '${action}'\n`);
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
