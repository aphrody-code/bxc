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
 * @module bxc/cli/chrome
 *
 * `bxc chrome` — management of the native Chromium core.
 */

import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const CARGO_TOML = join(ROOT, "rust-bridge/Cargo.toml");

function log(msg: string) {
	Bun.stderr.write(`${msg}\n`);
}

function resolveBinPath(): string | null {
	const ext = process.platform === "win32" ? ".exe" : "";
	const binName = `bxc-engine${ext}`;

	const paths = [
		join(ROOT, "rust-bridge", "target", "release", binName),
		join(ROOT, "rust-bridge", "target", "debug", binName),
		join(ROOT, "dist", binName),
		join(process.cwd(), binName),
	];

	for (const p of paths) {
		try {
			if (Bun.file(p).size > 0) return p;
		} catch {
			// ignore missing files
		}
	}
	return null;
}

/**
 * CLI Entry point for `bxc chrome ...`
 */
export async function main(args: string[]): Promise<void> {
	const subcommand = args[0];
	const bin = resolveBinPath();

	switch (subcommand) {
		case "fetch": {
			log("[chrome] fetching native Chromium...");
			const spawnArgs = bin 
				? [bin, "fetch"]
				: ["cargo", "run", "--manifest-path", CARGO_TOML, "--bin", "bxc-engine", "--", "fetch"];

			const proc = Bun.spawn(spawnArgs, { stdout: "inherit", stderr: "inherit" });
			const exitCode = await proc.exited;
			if (exitCode !== 0) {
				process.exit(exitCode);
			}
			break;
		}

		case "launch": {
			const pathIdx = args.indexOf("--path");
			let chromePath = pathIdx !== -1 ? args[pathIdx + 1] : Bun.env["BXC_CHROME_BIN"];

			if (!chromePath) {
				// Fallback to legacy env var if set
				chromePath = Bun.env["CHROME_PATH"];
			}

			if (!chromePath) {
				// Try auto-resolve path via the binary
				const pathArgs = bin
					? [bin, "chrome-path"]
					: ["cargo", "run", "--manifest-path", CARGO_TOML, "--bin", "bxc-engine", "--", "chrome-path"];

				const pathProc = Bun.spawnSync(pathArgs, { env: Bun.env });
				chromePath = pathProc.stdout.toString().trim().split("\n").pop()?.trim();
			}

			if (!chromePath) {
				log("[error] chrome path not found and auto-fetch failed.");
				process.exit(1);
			}

			log(`[chrome] launching native Chromium from ${chromePath}...`);
			const launchArgs = bin
				? [bin, "launch", chromePath]
				: ["cargo", "run", "--manifest-path", CARGO_TOML, "--bin", "bxc-engine", "--", "launch", chromePath];

			const proc = Bun.spawn(launchArgs, { stdout: "inherit", stderr: "inherit" });

			// Handle termination
			process.on("SIGINT", () => proc.kill());
			process.on("SIGTERM", () => proc.kill());

			await proc.exited;
			break;
		}

		default:
			log("Usage: bxc chrome <fetch|launch>");
			process.exit(1);
	}
}

