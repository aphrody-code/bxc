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
 * `bunlight` — CLI router.
 *
 * Dispatches subcommands to the appropriate module via dynamic import so
 * that FFI libraries (zigquery, curl-impersonate) are not loaded unless
 * actually needed.
 *
 * Subcommands:
 *   serve    — start a CDP server (delegated to ./serve.ts)
 *   install  — download required browser binaries (delegated to ./install.ts)
 *
 * Flags:
 *   --version, -V   print version from package.json
 *   --help, -h      print usage
 */

import { join } from "node:path";

// ---------------------------------------------------------------------------
// Version resolution
// ---------------------------------------------------------------------------

// Build-time identifier injected via `bun build --define __BUNLIGHT_VERSION__='"x.y.z"'`.
// In dev (no define), `typeof` on an undefined identifier returns "undefined" without
// throwing — so this is safe across both standalone executables and dev workflows.
declare const __BUNLIGHT_VERSION__: string;
declare const __BUNLIGHT_BUILD_TIME__: string;

let _pkgVersion = typeof __BUNLIGHT_VERSION__ !== "undefined" ? __BUNLIGHT_VERSION__ : "0.0.0-dev";

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
	Bun.stdout.write(
		`bunlight v${_pkgVersion} — Bun-native browser engine

Usage:
  bunlight <subcommand> [options]

Subcommands:
  serve     Start a CDP server for browser automation
            bunlight serve --cdp-port <N> [--profile static|fast|http|stealth|max]

  install   Download engine binaries (Lightpanda + native Chromium)
            bunlight install [--dry-run]

  chrome    Native Chromium management
            bunlight chrome fetch
            bunlight chrome launch [--path path/to/chrome]

  recon     One-shot URL → recon doc (Markdown by default)
            bunlight recon <url> [--profile static|fast|http|stealth|max] [--screenshot]
                                 [--output path.md] [--snapshot-dir dir/] [--json]
  docs      Alias of recon

  detect    Framework / CMS / library detection via wappalyzergo
            bunlight detect <url>

  scrape    Extract textContent from CSS-matched elements
            bunlight scrape <url> <css> [--profile name] [--max N]

  cookies   Cookie jar tools
            bunlight cookies load <jar.json>

  har       HAR (HTTP Archive) recorder/replayer
            bunlight har record <url> <out.har>
            bunlight har replay <file.har>

  mirror    Download a full site (HTML+CSS+JS+assets) with rewritten links
            bunlight mirror <url> <out-dir> [--profile http|static|fast|stealth]
                                            [--cookies jar.json] [--verbose]

  challonge Extract typed snapshot from a Challonge tournament page
            bunlight challonge <url-or-path> [--cookies jar.json] [--summary]

Flags:
  --version, -V   print version
  --help, -h      print this help

Examples:
  bunlight serve --cdp-port 9222 --profile stealth
  bunlight install
  bunlight detect https://www.google.com

bunlight is a high-performance browser engine optimized for VPS
and Google-grade stealth. It combines In-Process FFI (Zig/V8)
with a native Rust-driven Chromium core.

`,
	);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function main() {
	// In dev mode, read the actual version from package.json (file system available).
	// In standalone executables, the define above wins and this block is dead-code-eliminated.
	if (_pkgVersion === "0.0.0-dev") {
		try {
			const pkgPath = join(import.meta.dir, "../../package.json");
			const text = await Bun.file(pkgPath).text();
			const pkg = JSON.parse(text) as { version?: string };
			if (typeof pkg.version === "string") {
				_pkgVersion = pkg.version;
			}
		} catch {
			// Keep "0.0.0-dev".
		}
	}

	const _buildTime =
		typeof __BUNLIGHT_BUILD_TIME__ !== "undefined" ? __BUNLIGHT_BUILD_TIME__ : "dev";
	void _buildTime;

	const subcommand = process.argv[2];

	switch (subcommand) {
		case "serve": {
			await import("./serve.ts");
			break;
		}

		case "install": {
			const mod = await import("./install.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "chrome": {
			const mod = await import("./chrome.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "recon":
		case "docs": {
			const mod = await import("./recon.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "detect": {
			const mod = await import("./detect.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "scrape": {
			const mod = await import("./scrape.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "cookies": {
			const mod = await import("./cookies.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "har": {
			const mod = await import("./har.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "mirror": {
			const mod = await import("./mirror.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "challonge": {
			const mod = await import("./challonge.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "api": {
			const mod = await import("./api.ts");
			await mod.main(process.argv.slice(3));
			break;
		}

		case "--version":
		case "-V": {
			Bun.stdout.write(`bunlight ${_pkgVersion}\n`);
			break;
		}

		case "--help":
		case "-h":
		default: {
			printUsage();
			if (subcommand !== undefined && subcommand !== "--help" && subcommand !== "-h") {
				Bun.stderr.write(`Unknown subcommand: ${subcommand}\n`);
				process.exit(1);
			}
			break;
		}
	}
}

main().catch((err) => {
	console.error(`[bunlight] ${err instanceof Error ? err.stack : String(err)}`);
	process.exit(1);
});

