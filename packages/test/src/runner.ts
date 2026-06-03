// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/bxc-test/runner
 *
 * The runner seam. Re-exports `bun:test`'s runner verbs so any file using this
 * package runs under `bun test`, and provides a Playwright-style per-test `page`
 * fixture (`packages/playwright/src/index.ts:907`) without a worker pool: a
 * fresh {@link TestPage} is created before the body and closed after, via
 * `bun:test` lifecycle + try/finally.
 */

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	it,
	mock,
	test as bunTest,
} from "bun:test";
import type { BxcTestConfig } from "./config.ts";
import { TestPage, type TestPageOptions } from "./page.ts";

export { afterAll, afterEach, beforeAll, beforeEach, describe, it, mock };

/** The fixtures injected into a `test(name, async ({ page }) => …)` body. */
export interface BxcFixtures {
	/** A fresh page under test, closed automatically after the test. */
	page: TestPage;
}

/** A Playwright-style test body taking the `{ page }` fixture. */
export type FixtureBody = (fixtures: BxcFixtures) => void | Promise<void>;

/**
 * A `test` callable with `bun:test`-compatible overloads plus a Playwright-style
 * fixture overload. `test.describe` aliases `describe` for Playwright muscle
 * memory; `skip` / `only` / `todo` / `each` come straight from `bun:test`.
 */
export interface BxcTest {
	(name: string, body: FixtureBody): void;
	(name: string, body: () => void | Promise<void>): void;
	describe: typeof describe;
	skip: typeof bunTest.skip;
	only: typeof bunTest.only;
	todo: typeof bunTest.todo;
	each: typeof bunTest.each;
}

/**
 * `bun:test` guards `.only` (it throws on *access* under CI to avoid
 * accidentally skipping tests). We therefore expose `skip`/`only`/`todo`/`each`
 * as forwarding wrappers that touch the underlying property only when actually
 * invoked, rather than dereferencing them at module-load time.
 */
const skipFn = ((...args: Parameters<typeof bunTest.skip>) =>
	bunTest.skip(...args)) as typeof bunTest.skip;
const onlyFn = ((...args: Parameters<typeof bunTest.only>) =>
	bunTest.only(...args)) as typeof bunTest.only;
const todoFn = ((...args: Parameters<typeof bunTest.todo>) =>
	bunTest.todo(...args)) as typeof bunTest.todo;
const eachFn = ((...args: Parameters<typeof bunTest.each>) =>
	bunTest.each(...args)) as typeof bunTest.each;

/**
 * Builds a `test` function bound to `config`. The returned function accepts
 * either a plain body or a Playwright-style `({ page })` body; in the latter
 * case a {@link TestPage} is provisioned and disposed around the body.
 */
export function createTest(config: BxcTestConfig = {}): BxcTest {
	const pageOpts: TestPageOptions = {
		profile: config.use?.profile ?? "static",
		baseURL: config.use?.baseURL,
		testIdAttribute: config.use?.testIdAttribute,
	};

	const fn = ((name: string, body: FixtureBody | (() => void | Promise<void>)) => {
		// Distinguish a fixture body (declares one arg) from a plain body.
		const wantsFixtures = body.length >= 1;
		if (!wantsFixtures) {
			bunTest(name, body as () => void | Promise<void>);
			return;
		}
		bunTest(name, async () => {
			const page = await TestPage.create(pageOpts);
			try {
				await (body as FixtureBody)({ page });
			} finally {
				await page.close();
			}
		});
	}) as BxcTest;

	fn.describe = describe;
	fn.skip = skipFn;
	fn.only = onlyFn;
	fn.todo = todoFn;
	fn.each = eachFn;
	return fn;
}

/** The default `test`, bound to an empty config (`static` profile). */
export const test: BxcTest = createTest();
