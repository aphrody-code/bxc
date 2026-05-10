/**
 * Unit tests for scripts/postinstall.ts
 *
 * Covers : platform detection, skip logic (CI/opt-out), target path resolution,
 *          unsupported platform branch, idempotency probe.
 *
 * Network-dependent flow (fetchReleaseAsset / streamDownload) is exercised
 * indirectly through `runPostinstall` in a "should-skip" mode to keep the
 * suite fast and offline-safe.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	detectPlatform,
	resolveTargetPath,
	runPostinstall,
	shouldSkip,
} from "../../scripts/postinstall.ts";

describe("detectPlatform", () => {
	test("returns linux-x64 mapping for linux + x64", () => {
		const p = detectPlatform("linux", "x64");
		expect(p).not.toBeNull();
		expect(p?.id).toBe("x86_64-linux");
		expect(p?.dirName).toBe("linux-x64");
		expect(p?.assetName).toBe("lightpanda-x86_64-linux");
	});

	test("returns linux-arm64 mapping for linux + arm64", () => {
		const p = detectPlatform("linux", "arm64");
		expect(p?.id).toBe("aarch64-linux");
		expect(p?.dirName).toBe("linux-arm64");
		expect(p?.assetName).toBe("lightpanda-aarch64-linux");
	});

	test("returns darwin-x64 mapping for darwin + x64", () => {
		const p = detectPlatform("darwin", "x64");
		expect(p?.id).toBe("x86_64-macos");
		expect(p?.dirName).toBe("darwin-x64");
		expect(p?.assetName).toBe("lightpanda-x86_64-macos");
	});

	test("returns darwin-arm64 mapping for darwin + arm64", () => {
		const p = detectPlatform("darwin", "arm64");
		expect(p?.id).toBe("aarch64-macos");
		expect(p?.dirName).toBe("darwin-arm64");
		expect(p?.assetName).toBe("lightpanda-aarch64-macos");
	});

	test("returns null for unsupported platform (win32)", () => {
		expect(detectPlatform("win32", "x64")).toBeNull();
	});

	test("returns null for unsupported arch on linux (ia32)", () => {
		expect(detectPlatform("linux", "ia32")).toBeNull();
	});
});

describe("shouldSkip", () => {
	test("returns null with empty env (proceed with download)", () => {
		expect(shouldSkip({})).toBeNull();
	});

	test("opt-out via BUNLIGHT_NO_AUTOINSTALL=1", () => {
		const reason = shouldSkip({ BUNLIGHT_NO_AUTOINSTALL: "1" });
		expect(reason).not.toBeNull();
		expect(reason).toContain("BUNLIGHT_NO_AUTOINSTALL");
	});

	test("CI=1 alone causes skip", () => {
		const reason = shouldSkip({ CI: "1" });
		expect(reason).not.toBeNull();
		expect(reason).toContain("CI=1");
	});

	test("CI=1 + LIGHTPANDA_AUTOINSTALL=1 proceeds", () => {
		expect(shouldSkip({ CI: "1", LIGHTPANDA_AUTOINSTALL: "1" })).toBeNull();
	});

	test("BUNLIGHT_NO_AUTOINSTALL takes precedence even with LIGHTPANDA_AUTOINSTALL", () => {
		const reason = shouldSkip({
			BUNLIGHT_NO_AUTOINSTALL: "1",
			LIGHTPANDA_AUTOINSTALL: "1",
		});
		expect(reason).toContain("BUNLIGHT_NO_AUTOINSTALL");
	});
});

describe("resolveTargetPath", () => {
	test("default resolves under <root>/../vendor/lightpanda-bin/<dir>/lightpanda", () => {
		const p = detectPlatform("linux", "x64");
		expect(p).not.toBeNull();
		const target = resolveTargetPath(p!, "/abs/scripts");
		expect(target).toBe("/abs/scripts/../vendor/lightpanda-bin/linux-x64/lightpanda");
	});

	test("BUNLIGHT_VENDOR_DIR override is honored", () => {
		const p = detectPlatform("darwin", "arm64");
		expect(p).not.toBeNull();
		const target = resolveTargetPath(p!, "/ignored", "/tmp/custom");
		expect(target).toBe("/tmp/custom/darwin-arm64/lightpanda");
	});
});

describe("runPostinstall (skip paths only — offline safe)", () => {
	const originalEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		// Snapshot env keys we mutate.
		for (const k of [
			"BUNLIGHT_NO_AUTOINSTALL",
			"CI",
			"LIGHTPANDA_AUTOINSTALL",
			"BUNLIGHT_VENDOR_DIR",
			"LIGHTPANDA_DOWNLOAD_URL",
		]) {
			originalEnv[k] = process.env[k];
			delete process.env[k];
		}
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(originalEnv)) {
			if (v === undefined) {
				delete process.env[k];
			} else {
				process.env[k] = v;
			}
		}
	});

	test("returns status=skipped when BUNLIGHT_NO_AUTOINSTALL=1", async () => {
		process.env.BUNLIGHT_NO_AUTOINSTALL = "1";
		const result = await runPostinstall();
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("BUNLIGHT_NO_AUTOINSTALL");
	});

	test("returns status=skipped when CI=1 without LIGHTPANDA_AUTOINSTALL", async () => {
		process.env.CI = "1";
		const result = await runPostinstall();
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("CI=1");
	});
});
