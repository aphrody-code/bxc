// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody-code/bxc-test/config
 *
 * `defineConfig` — a `playwright.config.ts`-shaped options object. The fields
 * that bxc can honour (`use.baseURL`, `use.testIdAttribute`, `use.profile`,
 * `expect.timeout`) drive the fixture seam in `runner.ts`. Fields owned by the
 * runner (`workers`, `retries`, `projects`) are accepted for source-compat and
 * delegated to Bun's `bun test` runner (see `docs/test-package-plan.md` §6).
 */

import type { TestPageOptions } from "./page.ts";

/** Per-test `use` block, mirroring Playwright's `use` fixture overrides. */
export interface UseOptions extends TestPageOptions {
	/** Default navigation/locator timeout in ms. */
	actionTimeout?: number;
}

/** `expect` block — default assertion timeout. */
export interface ExpectConfig {
	/** Default web-first assertion timeout in ms. */
	timeout?: number;
}

/** The full config shape, a typed subset of Playwright's `PlaywrightTestConfig`. */
export interface BxcTestConfig {
	/** Per-test fixtures / overrides. */
	use?: UseOptions;
	/** Global per-test timeout (informational; Bun owns the hard timeout). */
	timeout?: number;
	/** Web-first assertion config. */
	expect?: ExpectConfig;
	/** Retry count (delegated to Bun's runner). */
	retries?: number;
	/** Worker count (delegated to Bun's runner). */
	workers?: number;
}

/**
 * Identity helper that gives a config object full type-checking and inference,
 * exactly like Playwright's `defineConfig`.
 */
export function defineConfig(config: BxcTestConfig): BxcTestConfig {
	return config;
}
