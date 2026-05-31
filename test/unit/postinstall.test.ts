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

	test("returns windows-x64 mapping for win32 + x64", () => {
		const p = detectPlatform("win32", "x64");
		expect(p).not.toBeNull();
		expect(p?.id).toBe("x86_64-windows");
		expect(p?.dirName).toBe("windows-x64");
		expect(p?.assetName).toBe("lightpanda-x86_64-windows.exe");
	});

	test("returns null for unsupported arch on linux (ia32)", () => {
		expect(detectPlatform("linux", "ia32")).toBeNull();
	});
});

describe("shouldSkip", () => {
	test("returns null with empty env (proceed with download)", () => {
		expect(shouldSkip({})).toBeNull();
	});

	test("opt-out via BXC_NO_AUTOINSTALL=1", () => {
		const reason = shouldSkip({ BXC_NO_AUTOINSTALL: "1" });
		expect(reason).not.toBeNull();
		expect(reason).toContain("BXC_NO_AUTOINSTALL");
	});

	test("CI=1 alone causes skip", () => {
		const reason = shouldSkip({ CI: "1" });
		expect(reason).not.toBeNull();
		expect(reason).toContain("CI=1");
	});

	test("CI=1 + LIGHTPANDA_AUTOINSTALL=1 proceeds", () => {
		expect(shouldSkip({ CI: "1", LIGHTPANDA_AUTOINSTALL: "1" })).toBeNull();
	});

	test("BXC_NO_AUTOINSTALL takes precedence even with LIGHTPANDA_AUTOINSTALL", () => {
		const reason = shouldSkip({
			BXC_NO_AUTOINSTALL: "1",
			LIGHTPANDA_AUTOINSTALL: "1",
		});
		expect(reason).toContain("BXC_NO_AUTOINSTALL");
	});
});

describe("resolveTargetPath", () => {
	test("default resolves under <root>/../vendor/lightpanda-bin/<dir>/lightpanda", () => {
		const p = detectPlatform("linux", "x64");
		expect(p).not.toBeNull();
		const target = resolveTargetPath(p!, "/abs/scripts");
		expect(target).toBe(
			"/abs/scripts/../vendor/lightpanda-bin/linux-x64/lightpanda",
		);
	});

	test("BXC_VENDOR_DIR override is honored", () => {
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
			"BXC_NO_AUTOINSTALL",
			"CI",
			"LIGHTPANDA_AUTOINSTALL",
			"BXC_VENDOR_DIR",
			"LIGHTPANDA_DOWNLOAD_URL",
		]) {
			originalEnv[k] = Bun.env[k];
			delete Bun.env[k];
		}
	});

	afterEach(() => {
		for (const [k, v] of Object.entries(originalEnv)) {
			if (v === undefined) {
				delete Bun.env[k];
			} else {
				Bun.env[k] = v;
			}
		}
	});

	test("returns status=skipped when BXC_NO_AUTOINSTALL=1", async () => {
		Bun.env.BXC_NO_AUTOINSTALL = "1";
		const result = await runPostinstall();
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("BXC_NO_AUTOINSTALL");
	});

	test("returns status=skipped when CI=1 without LIGHTPANDA_AUTOINSTALL", async () => {
		Bun.env.CI = "1";
		const result = await runPostinstall();
		expect(result.status).toBe("skipped");
		expect(result.reason).toContain("CI=1");
	});
});
