#!/usr/bin/env bun
/**
 * `bunlight har <action>` — HAR (HTTP Archive) recorder/replayer.
 *
 * Actions:
 *   record <url> <out.har>    record HTTP traffic during a navigation (fast profile)
 *   replay <file.har>         load a HAR file and emit a summary to stdout
 */

import { Browser, Page } from "../api/browser.ts";
import { HarRecorder } from "../recorder/HarRecorder.ts";
import { HarReplayer } from "../recorder/HarReplayer.ts";

function printUsage(): void {
	process.stdout.write(
		`bunlight har — HAR recorder/replayer

Usage:
  bunlight har record <url> <out.har>   record HTTP traffic to a HAR file
  bunlight har replay <file.har>        inspect a HAR file (JSON summary on stdout)

Examples:
  bunlight har record https://example.com /tmp/example.har
  bunlight har replay /tmp/example.har

Exit codes: 0 OK, 2 misuse, 65 data error, 70 software
`,
	);
}

async function recordHar(url: string, out: string): Promise<void> {
	const page = (await Browser.newPage({
		profile: "fast",
		spawnOpts: { logLevel: "error", readyTimeoutMs: 10_000 },
	})) as Page;
	try {
		const recorder = new HarRecorder(page);
		recorder.start();
		await page.goto(url, { timeoutMs: 25_000 });
		await recorder.save(out);
		process.stderr.write(`bunlight har: recorded to ${out}\n`);
	} finally {
		try {
			await page.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

async function replayHar(file: string): Promise<void> {
	const replayer = await HarReplayer.load(file);
	// HarReplayer keeps two private maps; we surface basic stats via reflection.
	const inspect = (replayer as unknown as { _inspectStats?: () => unknown })._inspectStats;
	const stats =
		typeof inspect === "function" ? inspect.call(replayer) : { source: file, status: "loaded" };
	process.stdout.write(
		JSON.stringify({ source: file, ...((stats as object) ?? {}) }, null, 2) + "\n",
	);
}

export async function main(argv: readonly string[]): Promise<void> {
	const action = argv[0];
	if (!action || action === "--help" || action === "-h") {
		printUsage();
		process.exit(action ? 0 : 2);
	}

	try {
		switch (action) {
			case "record": {
				const url = argv[1];
				const out = argv[2];
				if (!url || !out) {
					process.stderr.write("bunlight har record <url> <out.har>\n");
					process.exit(2);
				}
				await recordHar(url, out);
				break;
			}
			case "replay": {
				const file = argv[1];
				if (!file) {
					process.stderr.write("bunlight har replay <file.har>\n");
					process.exit(2);
				}
				await replayHar(file);
				break;
			}
			default:
				process.stderr.write(`bunlight har: unknown action '${action}'\n`);
				printUsage();
				process.exit(2);
		}
	} catch (err) {
		process.stderr.write(`bunlight har: ${err instanceof Error ? err.message : String(err)}\n`);
		process.exit(65);
	}
}

if (import.meta.main) {
	main(process.argv.slice(2)).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
