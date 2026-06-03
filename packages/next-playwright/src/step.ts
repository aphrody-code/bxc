// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/next-playwright/step
 *
 * `step()` — the bxc reimplementation of `@next/playwright`'s internal step
 * helper (`/tmp/next.js/packages/next-playwright/src/step.ts`). The upstream
 * version probes for `@playwright/test` and wraps the body in `test.step()` so
 * the acquire/release actions show as labeled steps in Playwright's UI.
 *
 * bxc's test runner (`@aphrody/bxc-test`, built on `bun:test`) has no
 * `test.step` UI primitive, so — exactly like the upstream Jest fallback — the
 * default behaviour is to run the body directly. A host (a richer bxc reporter,
 * a trace recorder) may install its own reporter via {@link setStepReporter} to
 * observe the labeled boundaries without this package taking a hard dependency
 * on any particular runner.
 */

/** A step function: run `body`, optionally surfacing `title` to a reporter. */
export type Step = <T>(title: string, body: () => Promise<T>) => Promise<T>;

/** The pluggable reporter seam; defaults to running the body directly. */
let reporter: Step = (_title, body) => body();

/**
 * Installs a custom step reporter (e.g. a bxc trace/label sink). Passing
 * `null` restores the default direct-execution behaviour. Returns the previous
 * reporter so callers can restore it (nesting-safe).
 */
export function setStepReporter(next: Step | null): Step {
	const prev = reporter;
	reporter = next ?? ((_title, body) => body());
	return prev;
}

/**
 * Runs `body` under the active reporter. A reporter that throws is never
 * allowed to mask the body: any reporter failure falls back to executing the
 * body directly, mirroring upstream's "can only be called from a test" guard.
 */
export const step: Step = async (title, body) => {
	try {
		return await reporter(title, body);
	} catch (e) {
		if (
			e instanceof Error &&
			e.message.includes("can only be called from a test")
		) {
			return body();
		}
		throw e;
	}
};
