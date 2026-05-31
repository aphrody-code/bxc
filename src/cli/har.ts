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
 * `bxc har <action>` — HAR (HTTP Archive) recorder/replayer.
 */

import { Browser, Page } from "../api/browser.ts";
import { HarRecorder } from "../recorder/HarRecorder.ts";
import { HarReplayer } from "../recorder/HarReplayer.ts";
import { EXIT, type CommonOptions, parseCommonArgs, logger } from "./shared.ts";

function printUsage(): void {
	Bun.stdout.write(
		`bxc har — HAR recorder/replayer

Usage:
  bxc har record <url> <out.har> [options]   record HTTP traffic to a HAR file
  bxc har replay <file.har>                  inspect a HAR file (JSON summary on stdout)

Options:
  --profile <name>      fast (default) | stealth | max

`,
	);
}

async function recordHar(
	url: string,
	out: string,
	profile: "fast" | "stealth" | "max",
	opts: CommonOptions,
): Promise<void> {
	const page = (await Browser.newPage({
		profile,
		spawnOpts: { logLevel: "error", readyTimeoutMs: 10_000 },
	})) as Page;
	try {
		const recorder = new HarRecorder(page);
		recorder.start();
		await page.goto(url, { timeoutMs: opts.timeoutMs });
		await recorder.save(out);
		if (!opts.quiet) logger.log(`recorded to ${out}`);
	} finally {
		try {
			await page.close();
		} catch {}
		await Browser.close().catch(() => {});
	}
}

async function replayHar(file: string): Promise<void> {
	const replayer = await HarReplayer.load(file);
	const inspect = (replayer as unknown as { _inspectStats?: () => unknown })
		._inspectStats;
	const stats =
		typeof inspect === "function"
			? inspect.call(replayer)
			: { source: file, status: "loaded" };
	Bun.stdout.write(
		JSON.stringify({ source: file, ...(stats as object) }, null, 2) + "\n",
	);
}

export async function main(
	argv: readonly string[],
	opts: CommonOptions,
): Promise<void> {
	const action = argv[0];
	if (!action || action === "--help" || action === "-h") {
		printUsage();
		process.exit(action ? 0 : EXIT.MISUSE);
	}

	try {
		switch (action) {
			case "record": {
				let url = "";
				let out = "";
				let profile: "fast" | "stealth" | "max" = "fast";
				for (let i = 1; i < argv.length; i++) {
					const a = argv[i];
					if (a === "--profile") {
						const v = argv[++i];
						if (v !== "fast" && v !== "stealth" && v !== "max") {
							logger.error(
								`Invalid profile for HAR recording (expected fast|stealth|max): ${v}`,
							);
							process.exit(EXIT.MISUSE);
						}
						profile = v;
					} else if (!a.startsWith("-")) {
						if (!url) url = a;
						else if (!out) out = a;
					}
				}
				if (!url || !out) {
					logger.error("record <url> <out.har> — arguments missing");
					process.exit(EXIT.MISUSE);
				}
				await recordHar(url, out, profile, opts);
				break;
			}
			case "replay": {
				const file = argv[1];
				if (!file) {
					logger.error("replay <file.har> — file argument missing");
					process.exit(EXIT.MISUSE);
				}
				await replayHar(file);
				break;
			}
			default:
				logger.error(`unknown action '${action}'`);
				printUsage();
				process.exit(EXIT.MISUSE);
		}
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
