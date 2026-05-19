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

import { join } from "node:path";
import { bxcFetch } from "../utils/bxc-fetch.ts";

export { bxcFetch };

/** Root directory of the bxc project. */
export const ROOT = join(import.meta.dir, "../..");

/** 
 * Common CLI options shared across subcommands.
 */
export interface CommonOptions {
	insecure: boolean;
	proxy?: string;
	quiet: boolean;
	json: boolean;
	timeoutMs: number;
}

/**
 * Parse common global flags from argv.
 * Returns the parsed options and a new argv with those flags removed.
 */
export function parseCommonArgs(argv: string[]): { opts: CommonOptions; remaining: string[] } {
	const opts: CommonOptions = {
		insecure: Bun.env.BXC_INSECURE === "1",
		quiet: Bun.env.BXC_QUIET === "1",
		json: false,
		timeoutMs: 30_000,
	};
	const remaining: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--insecure" || a === "-k") {
			opts.insecure = true;
		} else if (a === "--proxy") {
			opts.proxy = argv[++i];
		} else if (a === "--quiet" || a === "-q") {
			opts.quiet = true;
		} else if (a === "--json") {
			opts.json = true;
		} else if (a === "--timeout") {
			opts.timeoutMs = parseInt(argv[++i], 10);
		} else {
			remaining.push(a);
		}
	}
	return { opts, remaining };
}

/**
 * Standardized logging that respects the --quiet flag.
 */
export const logger = {
	log(msg: string, opts?: CommonOptions) {
		if (!opts?.quiet) Bun.stdout.write(`${msg}\n`);
	},
	warn(msg: string, opts?: CommonOptions) {
		if (!opts?.quiet) Bun.stderr.write(`[warn] ${msg}\n`);
	},
	error(msg: string) {
		Bun.stderr.write(`[error] ${msg}\n`);
	},
};

/** Exit codes mapping. */
export const EXIT = {
	OK: 0,
	MISUSE: 1,
	DATA_ERR: 65,
	SOFTWARE: 70,
	SIGINT: 130,
} as const;
