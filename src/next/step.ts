/**
 * @module bunlight/next/step
 *
 * Optional `bun:test` step wrapper. Mirrors `@next/playwright`'s `step.ts`
 * but adapted to bun's test runner. When `bun:test` is the host (no
 * `test.step` API exists today), the wrapper falls back to executing the
 * body directly. When `@playwright/test` is also reachable (mixed
 * pipelines), we honor its `test.step()` for the Playwright UI.
 */

export type Step = <T>(title: string, body: () => Promise<T>) => Promise<T>;

let stepImpl: Step = (_title, body) => body();

try {
	const playwrightImport = await import("@playwright/test").catch(() => null);
	const pwStep =
		(playwrightImport as { test?: { step?: unknown } } | null)?.test?.step ?? undefined;
	if (typeof pwStep === "function") {
		const playwrightStep = pwStep as <T>(title: string, body: () => Promise<T>) => Promise<T>;
		stepImpl = async <T>(title: string, body: () => Promise<T>): Promise<T> => {
			try {
				return await playwrightStep(title, body);
			} catch (e) {
				// `test.step` throws "can only be called from a test" when the wrapper
				// runs outside a Playwright fixture (e.g. inside a plain `bun:test`
				// `test()` block). Fall back to direct execution there.
				if (e instanceof Error && e.message.includes("can only be called from a test")) {
					return body();
				}
				throw e;
			}
		};
	}
} catch {
	// Playwright unavailable — keep the no-op wrapper.
}

export const step: Step = stepImpl;
