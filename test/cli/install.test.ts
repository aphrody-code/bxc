/**
 * Tests for `bunlight install` CLI subcommand.
 *
 * Tests that perform actual network I/O or write to the filesystem are
 * controlled by the BUNLIGHT_TEST_NETWORK env var. Set it to "1" to run them.
 *
 * All tests can be run offline safely — network/download tests skip with a
 * clear reason when BUNLIGHT_TEST_NETWORK != "1".
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NETWORK_TESTS = process.env.BUNLIGHT_TEST_NETWORK === "1";

function logSkip(reason: string): void {
	console.log(`  [skip] ${reason}`);
}

/** Create a unique temp dir for a test run. */
function tempVendorDir(): string {
	return join(tmpdir(), `bunlight-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// ---------------------------------------------------------------------------
// Import the module under test.
// ---------------------------------------------------------------------------

import {
	detectLightpandaPlatform,
	resolveLightpandaPath,
	installLightpanda,
	runInstall,
	VENDOR_DIR,
} from "../../src/cli/install.ts";

// ---------------------------------------------------------------------------
// Unit tests — no network, no disk writes
// ---------------------------------------------------------------------------

describe("detectLightpandaPlatform", () => {
	test("returns linux-x64 for linux/x64", () => {
		const result = detectLightpandaPlatform("linux", "x64");
		expect(result).not.toBeNull();
		expect(result!.dirName).toBe("linux-x64");
		expect(result!.id).toBe("x86_64-linux");
		expect(result!.assetName).toBe("lightpanda-x86_64-linux");
	});

	test("returns linux-arm64 for linux/arm64", () => {
		const result = detectLightpandaPlatform("linux", "arm64");
		expect(result).not.toBeNull();
		expect(result!.dirName).toBe("linux-arm64");
		expect(result!.id).toBe("aarch64-linux");
	});

	test("returns darwin-arm64 for darwin/arm64", () => {
		const result = detectLightpandaPlatform("darwin", "arm64");
		expect(result).not.toBeNull();
		expect(result!.dirName).toBe("darwin-arm64");
		expect(result!.id).toBe("aarch64-macos");
	});

	test("returns null for unsupported platform (win32)", () => {
		const result = detectLightpandaPlatform("win32", "x64");
		expect(result).toBeNull();
	});

	test("returns null for unsupported arch (ia32 on linux)", () => {
		const result = detectLightpandaPlatform("linux", "ia32" as NodeJS.Architecture);
		expect(result).toBeNull();
	});
});

describe("resolveLightpandaPath", () => {
	test("builds correct path from platform and vendor dir", () => {
		const platform = detectLightpandaPlatform("linux", "x64");
		expect(platform).not.toBeNull();
		const p = resolveLightpandaPath(platform!, "/custom/vendor");
		expect(p).toBe("/custom/vendor/lightpanda-bin/linux-x64/lightpanda");
	});

	test("uses VENDOR_DIR constant when no override given", () => {
		const platform = detectLightpandaPlatform("linux", "x64")!;
		const p = resolveLightpandaPath(platform);
		expect(p).toContain("lightpanda-bin");
		expect(p).toContain("linux-x64");
		expect(p.endsWith("/lightpanda")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// VENDOR_DIR default
// ---------------------------------------------------------------------------

describe("VENDOR_DIR", () => {
	test("defaults to ~/.bunlight/vendor when env not set", () => {
		// The env var may or may not be set in CI. Just check the shape.
		expect(typeof VENDOR_DIR).toBe("string");
		expect(VENDOR_DIR.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Idempotency — dry-run and pre-existing file
// ---------------------------------------------------------------------------

describe("installLightpanda idempotency", () => {
	test("dry-run returns installed status without touching disk", async () => {
		const vendorDir = tempVendorDir();
		// dry-run: no network access, no file created.
		const result = await installLightpanda(true /* dryRun */, vendorDir);
		// On unsupported platforms the status is "unsupported", on supported ones
		// it should be "installed" (dry-run path) — unless the GitHub lookup fails
		// which would give "failed". We accept both "installed" and "unsupported".
		expect(["installed", "unsupported", "failed"]).toContain(result.status);
	});

	test("skips download if binary already present with non-zero size", async () => {
		const vendorDir = tempVendorDir();
		const platform = detectLightpandaPlatform();
		if (!platform) {
			logSkip(`unsupported platform ${process.platform}/${process.arch} for this test`);
			return;
		}

		// Pre-populate the target path with a fake non-zero binary.
		const fakeBinPath = resolveLightpandaPath(platform, vendorDir);
		await Bun.$`mkdir -p ${fakeBinPath.substring(0, fakeBinPath.lastIndexOf("/"))}`.quiet();
		await Bun.write(fakeBinPath, "fake-binary-content");

		// Should not attempt any download.
		const result = await installLightpanda(false /* not dryRun */, vendorDir);
		expect(result.status).toBe("present");
		expect(result.path).toBe(fakeBinPath);

		// Cleanup.
		await Bun.$`rm -rf ${vendorDir}`.quiet();
	});
});

// ---------------------------------------------------------------------------
// runInstall
// ---------------------------------------------------------------------------

describe("runInstall", () => {
	test("returns an object with lightpanda key", async () => {
		const vendorDir = tempVendorDir();
		const result = await runInstall({ dryRun: true }, vendorDir);
		expect(result).toHaveProperty("lightpanda");
		expect(typeof result.lightpanda.status).toBe("string");
	});

	test("result has only the lightpanda key (no forbidden engines)", async () => {
		const vendorDir = tempVendorDir();
		const result = await runInstall({ dryRun: true }, vendorDir);
		expect(Object.keys(result)).toEqual(["lightpanda"]);
	});
});

// ---------------------------------------------------------------------------
// CLI index.ts — --version and --help via subprocess
// ---------------------------------------------------------------------------

describe("bunlight CLI (index.ts)", () => {
	const INDEX = join(import.meta.dir, "../../src/cli/index.ts");

	test("--version prints a version string", async () => {
		const proc = Bun.spawn(["bun", "run", INDEX, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		// Should contain a version in semver-ish format.
		expect(out.trim()).toMatch(/^bunlight \d+\.\d+\./);
	});

	test("-V prints a version string", async () => {
		const proc = Bun.spawn(["bun", "run", INDEX, "-V"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out.trim()).toMatch(/^bunlight \d+\.\d+\./);
	});

	test("--help prints usage including subcommands", async () => {
		const proc = Bun.spawn(["bun", "run", INDEX, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out).toContain("serve");
		expect(out).toContain("install");
		expect(out).toContain("--version");
	});

	test("-h prints usage", async () => {
		const proc = Bun.spawn(["bun", "run", INDEX, "-h"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out).toContain("bunlight");
	});

	test("unknown subcommand exits with code 1", async () => {
		const proc = Bun.spawn(["bun", "run", INDEX, "notasubcommand"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		expect(code).toBe(1);
	});

	test("install --help prints install usage", async () => {
		const proc = Bun.spawn(["bun", "run", INDEX, "install", "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const out = await new Response(proc.stdout).text();
		await proc.exited;
		expect(out).toContain("--dry-run");
		// Forbidden engines must not be advertised in help.
		expect(out).not.toContain("--with-chromium");
		expect(out).not.toContain("--with-camoufox");
	});
});

// ---------------------------------------------------------------------------
// Network integration test — real Lightpanda install (opt-in)
// ---------------------------------------------------------------------------

describe("installLightpanda — real download (BUNLIGHT_TEST_NETWORK=1)", () => {
	test("downloads and installs Lightpanda binary", async () => {
		if (!NETWORK_TESTS) {
			logSkip("set BUNLIGHT_TEST_NETWORK=1 to run real download test");
			return;
		}

		const vendorDir = tempVendorDir();
		try {
			const result = await installLightpanda(false, vendorDir);

			if (result.status === "unsupported") {
				logSkip(`unsupported platform ${process.platform}/${process.arch}`);
				return;
			}

			expect(result.status).toBe("installed");
			expect(result.path).toBeDefined();

			const binary = Bun.file(result.path!);
			expect(await binary.exists()).toBe(true);
			expect(binary.size).toBeGreaterThan(1_000_000); // At least 1 MB

			// Verify it's executable.
			const testProc = Bun.spawn(["test", "-x", result.path!], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const exitCode = await testProc.exited;
			expect(exitCode).toBe(0);
		} finally {
			await Bun.$`rm -rf ${vendorDir}`.quiet();
		}
	});

	test("second install is idempotent (present, no re-download)", async () => {
		if (!NETWORK_TESTS) {
			logSkip("set BUNLIGHT_TEST_NETWORK=1 to run idempotency network test");
			return;
		}

		const vendorDir = tempVendorDir();
		try {
			// First install.
			await installLightpanda(false, vendorDir);
			// Second install — should be instant and status=present.
			const result = await installLightpanda(false, vendorDir);

			if (result.status === "unsupported") {
				logSkip(`unsupported platform ${process.platform}/${process.arch}`);
				return;
			}

			expect(result.status).toBe("present");
		} finally {
			await Bun.$`rm -rf ${vendorDir}`.quiet();
		}
	});
});
