/**
 * Unit tests for src/throttling/robots.ts
 *
 * Covers:
 *   - parseRobotsTxt: User-agent, Disallow, Allow, Crawl-delay, blank lines,
 *     comments, multi-agent groups, EOF without blank line
 *   - buildRobotRules: agent matching, allow/disallow precedence, wildcard
 *   - fetchRobotRules: error handling (no network calls in unit tests)
 */

import { describe, it, expect } from "bun:test";
import { parseRobotsTxt, buildRobotRules, fetchRobotRules } from "../../src/throttling/robots.ts";

// ---------------------------------------------------------------------------
// parseRobotsTxt
// ---------------------------------------------------------------------------

describe("parseRobotsTxt", () => {
	it("parses a simple Disallow group", () => {
		const content = `
User-agent: *
Disallow: /private/
`;
		const groups = parseRobotsTxt(content);
		expect(groups).toHaveLength(1);
		expect(groups[0].agents).toContain("*");
		expect(groups[0].rules).toHaveLength(1);
		expect(groups[0].rules[0].allow).toBe(false);
	});

	it("parses Allow rules", () => {
		const content = `
User-agent: *
Allow: /public/
Disallow: /
`;
		const groups = parseRobotsTxt(content);
		const rules = groups[0].rules;
		expect(rules.some((r) => r.allow === true)).toBe(true);
		expect(rules.some((r) => r.allow === false)).toBe(true);
	});

	it("parses Crawl-delay", () => {
		const content = `
User-agent: *
Crawl-delay: 3
`;
		const groups = parseRobotsTxt(content);
		expect(groups[0].crawlDelay).toBe(3);
	});

	it("parses Crawl-delay as float", () => {
		const content = `
User-agent: *
Crawl-delay: 0.5
`;
		const groups = parseRobotsTxt(content);
		expect(groups[0].crawlDelay).toBe(0.5);
	});

	it("parses multiple agents in one group (before any rule)", () => {
		const content = `
User-agent: Googlebot
User-agent: Bingbot
Disallow: /admin/
`;
		const groups = parseRobotsTxt(content);
		expect(groups).toHaveLength(1);
		expect(groups[0].agents).toContain("googlebot");
		expect(groups[0].agents).toContain("bingbot");
	});

	it("parses multiple distinct groups", () => {
		const content = `
User-agent: Googlebot
Disallow: /private/

User-agent: *
Disallow: /
`;
		const groups = parseRobotsTxt(content);
		expect(groups).toHaveLength(2);
	});

	it("strips inline comments", () => {
		const content = `
User-agent: * # this is a comment
Disallow: /admin/ # also a comment
`;
		const groups = parseRobotsTxt(content);
		expect(groups[0].rules).toHaveLength(1);
	});

	it("handles file without trailing blank line", () => {
		const content = `User-agent: *\nDisallow: /private/`;
		const groups = parseRobotsTxt(content);
		expect(groups).toHaveLength(1);
	});

	it("returns empty array for empty content", () => {
		expect(parseRobotsTxt("")).toHaveLength(0);
	});

	it("ignores lines without a colon", () => {
		const content = `
User-agent: *
Disallow /bad-line
Disallow: /private/
`;
		const groups = parseRobotsTxt(content);
		expect(groups[0].rules).toHaveLength(1);
	});

	it("ignores unknown directives (Sitemap: etc.)", () => {
		const content = `
User-agent: *
Sitemap: https://example.com/sitemap.xml
Disallow: /private/
`;
		const groups = parseRobotsTxt(content);
		// Sitemap is an unknown directive in this minimal parser, ignored
		expect(groups[0].rules).toHaveLength(1);
	});

	it("handles empty Disallow (allow everything)", () => {
		const content = `
User-agent: *
Disallow:
`;
		const groups = parseRobotsTxt(content);
		// Empty Disallow produces no rules
		expect(groups[0].rules).toHaveLength(0);
	});

	it("handles CRLF line endings", () => {
		const content = "User-agent: *\r\nDisallow: /private/\r\n";
		const groups = parseRobotsTxt(content);
		expect(groups).toHaveLength(1);
		expect(groups[0].rules).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// buildRobotRules
// ---------------------------------------------------------------------------

describe("buildRobotRules", () => {
	it("allows all paths when no groups match", () => {
		const rules = buildRobotRules([], "*");
		expect(rules.allowed("/anything")).toBe(true);
	});

	it("disallows a path matched by Disallow rule", () => {
		const content = `
User-agent: *
Disallow: /private/
`;
		const groups = parseRobotsTxt(content);
		const rules = buildRobotRules(groups, "*");
		expect(rules.allowed("/private/")).toBe(false);
		expect(rules.allowed("/public/")).toBe(true);
	});

	it("Allow overrides Disallow when Allow is more specific (longer pattern)", () => {
		const content = `
User-agent: *
Disallow: /
Allow: /public/
`;
		const groups = parseRobotsTxt(content);
		const rules = buildRobotRules(groups, "*");
		expect(rules.allowed("/public/page")).toBe(true);
		expect(rules.allowed("/private/data")).toBe(false);
	});

	it("prefers exact agent match over wildcard", () => {
		const content = `
User-agent: mybot
Disallow: /

User-agent: *
Allow: /
`;
		const groups = parseRobotsTxt(content);
		const mybotRules = buildRobotRules(groups, "mybot");
		const otherRules = buildRobotRules(groups, "otherbot");
		expect(mybotRules.allowed("/anything")).toBe(false);
		expect(otherRules.allowed("/anything")).toBe(true);
	});

	it("returns crawlDelay from exact agent group", () => {
		const content = `
User-agent: mybot
Crawl-delay: 5

User-agent: *
Crawl-delay: 2
`;
		const groups = parseRobotsTxt(content);
		const mybotRules = buildRobotRules(groups, "mybot");
		const otherRules = buildRobotRules(groups, "otherbot");
		expect(mybotRules.crawlDelay).toBe(5);
		expect(otherRules.crawlDelay).toBe(2);
	});

	it("normalises path without leading slash", () => {
		const content = `
User-agent: *
Disallow: /private/
`;
		const groups = parseRobotsTxt(content);
		const rules = buildRobotRules(groups, "*");
		// Should accept paths without leading slash by prepending /
		expect(rules.allowed("private/")).toBe(false);
	});

	it("supports wildcard * in pattern matching", () => {
		const content = `
User-agent: *
Disallow: /search?*
`;
		const groups = parseRobotsTxt(content);
		const rules = buildRobotRules(groups, "*");
		expect(rules.allowed("/search?q=hello")).toBe(false);
		expect(rules.allowed("/page")).toBe(true);
	});

	it("supports $ anchor in pattern", () => {
		const content = `
User-agent: *
Disallow: /trap$
`;
		const groups = parseRobotsTxt(content);
		const rules = buildRobotRules(groups, "*");
		expect(rules.allowed("/trap")).toBe(false);
		expect(rules.allowed("/trap/subpage")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// fetchRobotRules - error handling (no network)
// ---------------------------------------------------------------------------

describe("fetchRobotRules", () => {
	it("returns permissive rules for an invalid URL", async () => {
		const rules = await fetchRobotRules("not-a-url");
		expect(rules.allowed("/anything")).toBe(true);
		expect(rules.crawlDelay).toBeUndefined();
	});

	it("returns permissive rules when network fails (unreachable host)", async () => {
		// 192.0.2.0/24 is TEST-NET-1 per RFC 5737, guaranteed unreachable
		const rules = await fetchRobotRules("http://192.0.2.1/some/page", "TestBot/1.0", {
			timeoutMs: 500,
		});
		expect(rules.allowed("/anything")).toBe(true);
		expect(rules.crawlDelay).toBeUndefined();
	});
});
