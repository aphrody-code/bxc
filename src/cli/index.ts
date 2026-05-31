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
 * `bxc` — CLI router.
 *
 * Dispatches subcommands to the appropriate module via dynamic import so
 * that FFI libraries (zigquery, curl-impersonate) are not loaded unless
 * actually needed.
 */

import { join } from "node:path";
import { ROOT, parseCommonArgs, logger, EXIT } from "./shared.ts";

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

declare const __BXC_VERSION__: string;
declare const __BXC_BUILD_TIME__: string;

let _pkgVersion =
	typeof __BXC_VERSION__ !== "undefined" ? __BXC_VERSION__ : "0.0.0-dev";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
	Bun.stdout.write(
		`bxc v${_pkgVersion} — Bun-native browser engine

Usage:
  bxc <subcommand> [options]

Subcommands:
  serve     Start a CDP server for browser automation
  install   Download engine binaries (Lightpanda + native Chromium)
  chrome    Native Chromium management
  recon     One-shot URL → recon doc (Markdown by default)
  detect    Framework / CMS / library detection via multi-signal
  scrape    Extract textContent from CSS-matched elements
  search    Google Web Search → clean results (text/JSON/Markdown)
  api       Run Bxc as an HTTP JSON API
  cookies   Cookie jar tools
  har       HAR (HTTP Archive) recorder/replayer
  mirror    Download a full site (HTML+CSS+JS+assets)
  challonge Extract snapshot from a Challonge tournament page
  worldbeyblade worldbeyblade.org automation tools (profile, thread, PMs)
  fut       FIFA Ultimate Team (FUTGG/FUTBin) player price & stats scraper
  voiranime VoirAnime streaming site catalog search & resolver (e.g. "inazuma")
  google    Google properties auditor & client
  xcom      X.com profile scraper

Global Options:
  --insecure, -k  Bypass TLS certificate validation
  --proxy <url>   Use HTTP/SOCKS5 proxy
  --quiet, -q     Suppress non-essential output
  --json          Emit JSON output where applicable
  --timeout <ms>  Global timeout (default 30000ms)
  --version, -V   Print version
  --help, -h      Print this help

Examples:
  bxc serve --cdp-port 9222
  bxc recon https://google.com --insecure
  bxc detect https://design.google --json

bxc is a high-performance browser engine optimized for VPS
and Google-grade stealth. It combines In-Process FFI (Zig/V8)
with a native Rust-driven Chromium core.

`,
	);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function main() {
	if (_pkgVersion === "0.0.0-dev") {
		try {
			const pkgPath = join(ROOT, "package.json");
			const text = await Bun.file(pkgPath).text();
			const pkg = JSON.parse(text) as { version?: string };
			if (typeof pkg.version === "string") {
				_pkgVersion = pkg.version;
			}
		} catch {
			// Keep "0.0.0-dev".
		}
	}

	const { opts, remaining } = parseCommonArgs(process.argv.slice(2));
	const subcommand = remaining[0];
	const args = remaining.slice(1);

	if (opts.json) {
		// Might want to suppress logger if JSON is requested
	}

	switch (subcommand) {
		case "serve": {
			const mod = await import("./serve.ts");
			await mod.main(args, opts);
			break;
		}

		case "install": {
			const mod = await import("./install.ts");
			await mod.main(args, opts);
			break;
		}

		case "chrome": {
			const mod = await import("./chrome.ts");
			await mod.main(args, opts);
			break;
		}

		case "recon":
		case "docs": {
			const mod = await import("./recon.ts");
			await mod.main(args, opts);
			break;
		}

		case "detect": {
			const mod = await import("./detect.ts");
			await mod.main(args, opts);
			break;
		}

		case "scrape": {
			const mod = await import("./scrape.ts");
			await mod.main(args, opts);
			break;
		}

		case "search": {
			const mod = await import("./search.ts");
			await mod.main(args, opts);
			break;
		}

		case "cookies": {
			const mod = await import("./cookies.ts");
			await mod.main(args, opts);
			break;
		}

		case "har": {
			const mod = await import("./har.ts");
			await mod.main(args, opts);
			break;
		}

		case "mirror": {
			const mod = await import("./mirror.ts");
			await mod.main(args, opts);
			break;
		}

		case "challonge": {
			const mod = await import("./challonge.ts");
			await mod.main(args, opts);
			break;
		}

		case "worldbeyblade": {
			const mod = await import("./worldbeyblade.ts");
			await mod.main(args, opts);
			break;
		}

		case "fut": {
			const mod = await import("./fut.ts");
			await mod.main(args, opts);
			break;
		}

		case "voiranime": {
			const mod = await import("./voiranime.ts");
			await mod.main(args, opts);
			break;
		}

		case "google": {
			const mod = await import("./google.ts");
			await mod.main(args, opts);
			break;
		}

		case "xcom": {
			const mod = await import("./xcom.ts");
			await mod.main(args, opts);
			break;
		}

		case "api": {
			const mod = await import("./api.ts");
			await mod.main(args, opts);
			break;
		}

		case "--version":
		case "-V": {
			Bun.stdout.write(`bxc ${_pkgVersion}\n`);
			break;
		}

		case "--help":
		case "-h":
		case undefined: {
			printUsage();
			if (
				subcommand !== undefined &&
				subcommand !== "--help" &&
				subcommand !== "-h"
			) {
				logger.error(`Unknown subcommand: ${subcommand}`);
				process.exit(EXIT.MISUSE);
			}
			break;
		}

		default: {
			printUsage();
			logger.error(`Unknown subcommand: ${subcommand}`);
			process.exit(EXIT.MISUSE);
		}
	}
}

main().catch((err) => {
	logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(EXIT.SOFTWARE);
});
