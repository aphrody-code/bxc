#!/usr/bin/env bun
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

function readVersion(): string {
	// package.json lives one level above src/.
	const pkgPath = join(import.meta.dir, "../../package.json");
	try {
		const pkg = Bun.file(pkgPath);
		// Synchronous size check (fast) before async text — if the file is not
		// present we fall back to the embedded default.
		if (pkg.size === 0) return "0.0.0";
		// We need the version synchronously. Use JSON.parse on the raw text via a
		// sync Bun.file read through the underlying ArrayBuffer.
		// Bun does not expose a synchronous text() API, but we can use the
		// well-known trick: read it via the native Bun.file().stream() + TextDecoder
		// is async. Instead, embed the fallback and rely on top-level await.
		return _pkgVersion;
	} catch {
		return "0.0.0";
	}
}

// Build-time identifier injected via `bun build --define __BUNLIGHT_VERSION__='"x.y.z"'`.
// In dev (no define), `typeof` on an undefined identifier returns "undefined" without
// throwing — so this is safe across both standalone executables and dev workflows.
declare const __BUNLIGHT_VERSION__: string;
declare const __BUNLIGHT_BUILD_TIME__: string;

let _pkgVersion = typeof __BUNLIGHT_VERSION__ !== "undefined" ? __BUNLIGHT_VERSION__ : "0.0.0-dev";

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

const _buildTime = typeof __BUNLIGHT_BUILD_TIME__ !== "undefined" ? __BUNLIGHT_BUILD_TIME__ : "dev";
void _buildTime;

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function printUsage(): void {
	process.stdout.write(
		`bunlight v${_pkgVersion} — Bun-native browser engine

Usage:
  bunlight <subcommand> [options]

Subcommands:
  serve     Start a CDP server for browser automation
            bunlight serve --cdp-port <N> [--profile static|fast|http]

  install   Download Lightpanda for the current platform
            bunlight install [--dry-run]

  recon     One-shot URL → recon doc (Markdown by default)
            bunlight recon <url> [--profile static|fast|http] [--screenshot]
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
            bunlight mirror <url> <out-dir> [--profile http|static|fast]
                                            [--cookies jar.json] [--verbose]

  challonge Extract typed snapshot from a Challonge tournament page
            bunlight challonge <url-or-path> [--cookies jar.json] [--summary]

Flags:
  --version, -V   print version
  --help, -h      print this help

Examples:
  bunlight serve --cdp-port 9222 --profile fast
  bunlight install
  bunlight detect https://nextjs.org

bunlight is Lightpanda-only. Forbidden engines : Chrome / Chromium /
Firefox / Edge / Safari and any derivative (patchright, Camoufox).
For server-grade anti-detection use launchGhostBrowser
(src/profiles/ghost/) — Lightpanda + CDP stealth injects.

`,
	);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const subcommand = process.argv[2];

switch (subcommand) {
	case "serve": {
		// serve.ts reads process.argv directly. It already handles the case
		// where argv[0] (after "bun" + script stripping) is "serve" and
		// removes it via parseArgs(). So importing it is sufficient —
		// the top-level `main().catch(...)` call at the bottom of serve.ts
		// is invoked when the module is evaluated as a side effect.
		await import("./serve.ts");
		break;
	}

	case "install": {
		const mod = await import("./install.ts");
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
		process.stdout.write(`bunlight ${_pkgVersion}\n`);
		break;
	}

	case "--help":
	case "-h":
	default: {
		printUsage();
		if (subcommand !== undefined && subcommand !== "--help" && subcommand !== "-h") {
			process.stderr.write(`Unknown subcommand: ${subcommand}\n`);
			process.exit(1);
		}
		break;
	}
}
