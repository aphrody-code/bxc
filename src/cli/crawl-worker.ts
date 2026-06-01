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

import { AutonomousCrawler } from "../crawler/AutonomousCrawler.ts";
import { type CommonOptions, logger, EXIT } from "./shared.ts";

function printUsage(): void {
	Bun.stdout.write(
		`bxc crawl-worker — Run the autonomous crawler worker daemon in the background 24/7.

Usage:
  bxc crawl-worker [options] [initial_urls...]

Options:
  --allowed-domains <doms>  Comma-separated domains to restrict crawling (e.g. "example.com,google.com")
  --max-depth <depth>       Maximum recursion depth (default: 5)
  --max-requests <count>    Limit total requests to process (default: Infinity)
  --profile <prof>          Stealth profile: static | fast | stealth | max (default: stealth)
  --queue <name>            Custom RequestQueue name (default: bxc-autonomous-crawler)
  --proxy-pool <urls>       Comma-separated proxy URLs to rotate (e.g. "http://p1.com,http://p2.com")
  --no-daemon               Run until queue is empty, then exit (disables 24/7 polling mode)
  --help, -h                Print this help

Examples:
  bxc crawl-worker --allowed-domains example.com https://example.com
  bxc crawl-worker --profile fast --queue my-custom-queue
`,
	);
}

export async function main(
	argv: string[],
	baseOpts: CommonOptions,
	cliOptions?: { exitProcess?: boolean },
): Promise<void> {
	const exitProcess = cliOptions?.exitProcess ?? process.env.NODE_ENV !== "test";

	let allowedDomains: string[] | undefined;
	let maxDepth = 5;
	let maxRequests = Infinity;
	let profile: "static" | "fast" | "stealth" | "max" = "stealth";
	let queueName = "bxc-autonomous-crawler";
	let daemon = true;
	let proxyPool: string[] | undefined;
	const initialUrls: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--allowed-domains") {
			allowedDomains = argv[++i].split(",").map((s) => s.trim());
		} else if (arg === "--max-depth") {
			maxDepth = parseInt(argv[++i], 10);
		} else if (arg === "--max-requests") {
			maxRequests = parseInt(argv[++i], 10);
		} else if (arg === "--profile") {
			const val = argv[++i];
			if (val === "static" || val === "fast" || val === "stealth" || val === "max") {
				profile = val;
			} else {
				logger.error(`Invalid profile: ${val}. Expected static, fast, stealth, or max.`);
				if (exitProcess) process.exit(EXIT.MISUSE);
				throw new Error(`Invalid profile: ${val}`);
			}
		} else if (arg === "--queue") {
			queueName = argv[++i];
		} else if (arg === "--proxy-pool") {
			proxyPool = argv[++i].split(",").map((s) => s.trim());
		} else if (arg === "--no-daemon") {
			daemon = false;
		} else if (arg === "--help" || arg === "-h") {
			printUsage();
			return;
		} else if (arg.startsWith("-")) {
			logger.error(`Unknown option: ${arg}`);
			printUsage();
			if (exitProcess) process.exit(EXIT.MISUSE);
			throw new Error(`Unknown option: ${arg}`);
		} else {
			initialUrls.push(arg);
		}
	}

	logger.log(`[crawl-worker] Starting 24/7 worker queue="${queueName}" profile="${profile}" maxDepth=${maxDepth} daemon=${daemon}`);

	const crawler = new AutonomousCrawler({
		requestQueueName: queueName,
		allowedDomains,
		maxDepth,
		maxRequests,
		profile,
		daemon,
		proxyPool,
	});

	const stopHandler = () => {
		logger.log("\n[crawl-worker] Received termination signal. Shutting down worker gracefully...");
		crawler.stop();
	};

	process.on("SIGINT", stopHandler);
	process.on("SIGTERM", stopHandler);

	try {
		await crawler.run(initialUrls);
		logger.log("[crawl-worker] Worker run completed successfully.");
	} catch (err) {
		logger.error(`[crawl-worker] Fatal error in crawler execution: ${err}`);
		if (exitProcess) process.exit(EXIT.SOFTWARE);
		throw err;
	} finally {
		process.off("SIGINT", stopHandler);
		process.off("SIGTERM", stopHandler);
	}
}
