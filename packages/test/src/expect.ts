// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/bxc-test/expect
 *
 * Web-first, auto-retrying assertions for {@link BxcLocator}, mirroring
 * Playwright's matcher polling model (`packages/playwright/src/matchers/
 * toBeTruthy.ts:31-38`): each matcher runs a predicate in a poll loop until it
 * passes or `timeout` elapses, then throws a Playwright-shaped message.
 *
 * `expect(value)` on anything that is *not* a `BxcLocator` falls through to
 * `bun:test`'s native `expect`, so `expect(2+2).toBe(4)` keeps working in the
 * same file.
 */

import { expect as bunExpect } from "bun:test";
import { BxcLocator, nodeAttribute, nodeText, nodeVisible } from "./locator.ts";
import { matchesText, textMatcher } from "./selectors.ts";

/** Default assertion timeout (Playwright's `expect` default is 5s). */
const DEFAULT_EXPECT_TIMEOUT = 5_000;
const POLL_MS = 50;

/** Options accepted by every web-first matcher. */
export interface MatcherOptions {
	/** Override the assertion timeout in ms. */
	timeout?: number;
}

/** Outcome of a single predicate evaluation inside the poll loop. */
interface Probe {
	pass: boolean;
	/** Human description of what was actually observed (for the failure log). */
	actual: string;
}

/**
 * Runs `probe` until it reports `pass === !isNot`, or `timeout` elapses.
 * Throws a Playwright-shaped assertion error on timeout.
 */
async function poll(
	matcher: string,
	expected: string,
	isNot: boolean,
	timeout: number,
	probe: () => Promise<Probe>,
): Promise<void> {
	const deadline = Date.now() + timeout;
	let last: Probe = { pass: false, actual: "<not evaluated>" };
	for (;;) {
		try {
			last = await probe();
		} catch (err) {
			last = { pass: false, actual: `<error: ${(err as Error).message}>` };
		}
		if (last.pass === !isNot) return;
		if (Date.now() >= deadline) break;
		await Bun.sleep(POLL_MS);
	}
	const not = isNot ? "not " : "";
	throw new Error(
		`expect(locator).${not}${matcher}() failed\n\n` +
			`Expected: ${not}${expected}\n` +
			`Received: ${last.actual}\n\n` +
			`Timeout ${timeout}ms exceeded while retrying the assertion.`,
	);
}

/** The web-first matcher surface returned by `expect(locator)`. */
export interface LocatorMatchers {
	/** Negates the next matcher. */
	readonly not: LocatorMatchers;
	/** Element is attached and not hidden. */
	toBeVisible(options?: MatcherOptions): Promise<void>;
	/** Element is absent or hidden. */
	toBeHidden(options?: MatcherOptions): Promise<void>;
	/** Element's stripped text equals (string) / matches (RegExp). */
	toHaveText(expected: string | RegExp, options?: MatcherOptions): Promise<void>;
	/** Element's stripped text contains `expected`. */
	toContainText(expected: string, options?: MatcherOptions): Promise<void>;
	/** Locator resolves to exactly `n` elements. */
	toHaveCount(n: number, options?: MatcherOptions): Promise<void>;
	/** Element has attribute `name` (optionally equal to `value`). */
	toHaveAttribute(
		name: string,
		value?: string | RegExp,
		options?: MatcherOptions,
	): Promise<void>;
	/** Element is not `disabled`. */
	toBeEnabled(options?: MatcherOptions): Promise<void>;
	/** Element is `disabled`. */
	toBeDisabled(options?: MatcherOptions): Promise<void>;
}

/** Builds the matcher object for a locator, with `isNot` threaded through. */
function makeMatchers(locator: BxcLocator, isNot: boolean): LocatorMatchers {
	const page = locator._page;
	const t = (o?: MatcherOptions) => o?.timeout ?? DEFAULT_EXPECT_TIMEOUT;

	// Honour `.nth/.first/.last` so the matcher asserts on the targeted element.
	const firstId = (): Promise<number | null> => locator._resolveTargeted();

	return {
		get not(): LocatorMatchers {
			return makeMatchers(locator, !isNot);
		},

		async toBeVisible(options) {
			await poll("toBeVisible", "visible", isNot, t(options), async () => {
				const id = await firstId();
				const visible = id !== null && (await nodeVisible(page, id));
				return {
					pass: visible,
					actual: id === null ? "not attached" : visible ? "visible" : "hidden",
				};
			});
		},

		async toBeHidden(options) {
			await poll("toBeHidden", "hidden", isNot, t(options), async () => {
				const id = await firstId();
				const visible = id !== null && (await nodeVisible(page, id));
				return {
					pass: !visible,
					actual: id === null ? "not attached" : visible ? "visible" : "hidden",
				};
			});
		},

		async toHaveText(expected, options) {
			const m = textMatcher(expected, !(expected instanceof RegExp));
			await poll(
				"toHaveText",
				`text ${m.kind === "regex" ? `/${m.value}/` : `"${m.value}"`}`,
				isNot,
				t(options),
				async () => {
					const id = await firstId();
					if (id === null) return { pass: false, actual: "not attached" };
					const text = await nodeText(page, id);
					return { pass: matchesText(m, text), actual: `"${text}"` };
				},
			);
		},

		async toContainText(expected, options) {
			await poll(
				"toContainText",
				`text containing "${expected}"`,
				isNot,
				t(options),
				async () => {
					const id = await firstId();
					if (id === null) return { pass: false, actual: "not attached" };
					const text = await nodeText(page, id);
					return { pass: text.includes(expected), actual: `"${text}"` };
				},
			);
		},

		async toHaveCount(n, options) {
			await poll("toHaveCount", `count ${n}`, isNot, t(options), async () => {
				const count = await locator.count();
				return { pass: count === n, actual: `count ${count}` };
			});
		},

		async toHaveAttribute(name, value, options) {
			const want =
				value === undefined ? undefined : textMatcher(value, !(value instanceof RegExp));
			await poll(
				"toHaveAttribute",
				`attribute "${name}"${value === undefined ? "" : `=${value}`}`,
				isNot,
				t(options),
				async () => {
					const id = await firstId();
					if (id === null) return { pass: false, actual: "not attached" };
					const attr = await nodeAttribute(page, id, name);
					if (attr === null)
						return { pass: false, actual: `no attribute "${name}"` };
					const ok = want === undefined ? true : matchesText(want, attr);
					return { pass: ok, actual: `${name}="${attr}"` };
				},
			);
		},

		async toBeEnabled(options) {
			await poll("toBeEnabled", "enabled", isNot, t(options), async () => {
				const id = await firstId();
				if (id === null) return { pass: false, actual: "not attached" };
				const disabled = await nodeAttribute(page, id, "disabled");
				return {
					pass: disabled === null,
					actual: disabled === null ? "enabled" : "disabled",
				};
			});
		},

		async toBeDisabled(options) {
			await poll("toBeDisabled", "disabled", isNot, t(options), async () => {
				const id = await firstId();
				if (id === null) return { pass: false, actual: "not attached" };
				const disabled = await nodeAttribute(page, id, "disabled");
				return {
					pass: disabled !== null,
					actual: disabled === null ? "enabled" : "disabled",
				};
			});
		},
	};
}

/**
 * Playwright-style `expect`. Returns web-first matchers for a {@link BxcLocator}
 * and otherwise delegates to `bun:test`'s `expect` (so value assertions,
 * snapshots, `.toBe`, etc. all keep working unchanged).
 */
export function expect(actual: BxcLocator): LocatorMatchers;
export function expect(actual: unknown): ReturnType<typeof bunExpect>;
export function expect(actual: unknown): LocatorMatchers | ReturnType<typeof bunExpect> {
	if (actual instanceof BxcLocator) {
		return makeMatchers(actual, false);
	}
	return bunExpect(actual);
}
