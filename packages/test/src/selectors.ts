// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/bxc-test/selectors
 *
 * Maps Playwright's semantic locators (`getByRole`, `getByTestId`, `getByText`,
 * `getByLabel`, …) onto CSS selectors that bxc's CDP `DOM.querySelectorAll`
 * (CSS-only engine, `src/cdp/domains/DOM.ts:121`) can resolve, plus an optional
 * text predicate applied after CSS resolution.
 *
 * Playwright resolves `internal:role=…` / `internal:text=…` inside the page via
 * an injected script (`packages/injected`). bxc's default `static` profile has
 * no JS engine, so we resolve to CSS + a host-side text filter instead. The
 * role table is a deliberate heuristic (documented as "adapted" in
 * `docs/test-package-plan.md` §6), not a full ARIA accessibility tree.
 */

/**
 * A resolved locator query: a CSS selector handed to `DOM.querySelectorAll`,
 * plus optional host-side text / attribute predicates.
 */
export interface ResolvedQuery {
	/** CSS selector for `DOM.querySelectorAll`. */
	css: string;
	/** When set, keep only nodes whose stripped text matches. */
	text?: TextMatcher;
}

/** A text predicate built from a string (exact or substring) or RegExp. */
export interface TextMatcher {
	kind: "exact" | "substring" | "regex";
	value: string;
	source?: RegExp;
}

/** Builds a {@link TextMatcher} from Playwright's `string | RegExp` argument. */
export function textMatcher(
	value: string | RegExp,
	exact = false,
): TextMatcher {
	if (value instanceof RegExp) {
		return { kind: "regex", value: value.source, source: value };
	}
	return { kind: exact ? "exact" : "substring", value };
}

/** Evaluates a {@link TextMatcher} against an element's stripped text. */
export function matchesText(matcher: TextMatcher, text: string): boolean {
	const trimmed = text.trim();
	switch (matcher.kind) {
		case "exact":
			return trimmed === matcher.value.trim();
		case "substring":
			return trimmed.includes(matcher.value.trim());
		case "regex":
			return (matcher.source ?? new RegExp(matcher.value)).test(text);
	}
}

/**
 * Role → CSS heuristic table. Each entry expands to the native elements that
 * implicitly carry the ARIA role plus the explicit `[role="…"]` form.
 *
 * This mirrors the subset of the HTML-AAM (ARIA in HTML) role mapping that is
 * resolvable without a layout/accessibility engine.
 */
const ROLE_CSS: Record<string, string> = {
	button: 'button, [role="button"], input[type="button"], input[type="submit"]',
	link: 'a[href], [role="link"]',
	heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
	textbox:
		'input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea, [role="textbox"]',
	checkbox: 'input[type="checkbox"], [role="checkbox"]',
	radio: 'input[type="radio"], [role="radio"]',
	list: 'ul, ol, [role="list"]',
	listitem: 'li, [role="listitem"]',
	img: 'img, [role="img"]',
	navigation: 'nav, [role="navigation"]',
	main: 'main, [role="main"]',
	banner: 'header, [role="banner"]',
	contentinfo: 'footer, [role="contentinfo"]',
	article: 'article, [role="article"]',
	table: 'table, [role="table"]',
	row: 'tr, [role="row"]',
	cell: 'td, [role="cell"]',
	form: 'form, [role="form"]',
	dialog: 'dialog, [role="dialog"]',
	status: '[role="status"], output',
	alert: '[role="alert"]',
	combobox: 'select, [role="combobox"]',
	option: 'option, [role="option"]',
	separator: 'hr, [role="separator"]',
	paragraph: 'p',
};

/** Options accepted by {@link getByRole}, a subset of Playwright's `ByRoleOptions`. */
export interface ByRoleOptions {
	/** Accessible-name filter (matched against element text in v1). */
	name?: string | RegExp;
	/** Exact name match (string `name` only). */
	exact?: boolean;
	/** Heading level (`<h2>` → 2, or `aria-level`). */
	level?: number;
}

/** Escapes a string for use inside a CSS `[attr="…"]` selector value. */
export function cssAttrEscape(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** `getByRole(role, opts)` → CSS + text predicate. */
export function getByRole(role: string, opts: ByRoleOptions = {}): ResolvedQuery {
	let css = ROLE_CSS[role.toLowerCase()] ?? `[role="${cssAttrEscape(role)}"]`;
	if (opts.level !== undefined && role.toLowerCase() === "heading") {
		css = `h${opts.level}, [role="heading"][aria-level="${opts.level}"]`;
	}
	const query: ResolvedQuery = { css };
	if (opts.name !== undefined) {
		query.text = textMatcher(opts.name, opts.exact ?? false);
	}
	return query;
}

/** `getByTestId(id)` → `[<attr>="id"]`. */
export function getByTestId(
	testId: string,
	attribute = "data-testid",
): ResolvedQuery {
	return { css: `[${attribute}="${cssAttrEscape(testId)}"]` };
}

/** `getByText(text, { exact })` → any element, filtered by text. */
export function getByText(
	text: string | RegExp,
	opts: { exact?: boolean } = {},
): ResolvedQuery {
	return { css: "*", text: textMatcher(text, opts.exact ?? false) };
}

/** `getByLabel(text)` → `aria-label` / `[id]` referenced by a `<label for>`. */
export function getByLabel(
	text: string | RegExp,
	opts: { exact?: boolean } = {},
): ResolvedQuery {
	if (typeof text === "string") {
		return { css: `[aria-label="${cssAttrEscape(text)}"]` };
	}
	return { css: "[aria-label]", text: textMatcher(text, opts.exact ?? false) };
}

/** `getByPlaceholder(text)` → `[placeholder="…"]`. */
export function getByPlaceholder(text: string): ResolvedQuery {
	return { css: `[placeholder="${cssAttrEscape(text)}"]` };
}

/** `getByAltText(text)` → `[alt="…"]`. */
export function getByAltText(text: string): ResolvedQuery {
	return { css: `[alt="${cssAttrEscape(text)}"]` };
}

/** `getByTitle(text)` → `[title="…"]`. */
export function getByTitle(text: string): ResolvedQuery {
	return { css: `[title="${cssAttrEscape(text)}"]` };
}
