/**
 * @module bunlight/utils/robots
 *
 * RFC 9309-conformant robots.txt parser.
 *
 * Inspired by Crawlee's RobotsTxtFile
 * (packages/utils/src/internals/robots.ts) but rewritten Bun-native:
 *  - No `robots-parser` npm dep — hand-rolled parser.
 *  - Bun.fetch for HTTP (no got-scraping).
 *  - Supports full RFC 9309: group matching, Allow/Disallow precedence,
 *    Crawl-delay, Sitemap directives, wildcard `*` and `$` patterns.
 *
 * RFC 9309 compliance:
 *  - Case-insensitive agent matching.
 *  - Longest match wins for Allow vs Disallow conflicts.
 *  - `*` in patterns matches any sequence of characters.
 *  - `$` anchors the pattern to end of path.
 *  - Unknown directives are silently ignored.
 *  - Lines beginning with `#` are comments.
 *
 * @example
 * ```ts
 * const robots = await RobotsFile.fetch("https://example.com");
 * console.log(robots.isAllowed("https://example.com/private/", "MyBot")); // false
 * console.log(robots.crawlDelay("MyBot")); // 2 (seconds) or undefined
 * const sitemaps = robots.sitemaps; // ["https://example.com/sitemap.xml"]
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RobotsFileOptions {
	/** User-agent to send when fetching robots.txt. Default: "Bunlight/1.0" */
	userAgent?: string;
	/** Request timeout in ms. Default: 10_000 */
	timeoutMs?: number;
	/** AbortSignal for cancellation. */
	signal?: AbortSignal;
}

interface RobotsGroup {
	agents: string[];
	rules: RobotsRule[];
	crawlDelay?: number;
}

interface RobotsRule {
	allow: boolean;
	/** Compiled regex from the pattern. */
	pattern: RegExp;
	/** Raw pattern length — used for precedence (longest wins). */
	length: number;
}

// ---------------------------------------------------------------------------
// Pattern compilation (RFC 9309 §2.2.2)
// ---------------------------------------------------------------------------

/**
 * Compile a robots.txt path pattern to a RegExp.
 * Wildcards: `*` → `.*`, `$` at end → end-of-string anchor.
 */
function compilePattern(raw: string): RegExp {
	// Escape all regex metacharacters except * and $
	const anchored = raw.endsWith("$");
	const base = anchored ? raw.slice(0, -1) : raw;

	const escaped = base.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

	return new RegExp("^" + escaped + (anchored ? "$" : ""), "i");
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function parseRobotsTxt(content: string): { groups: RobotsGroup[]; sitemaps: string[] } {
	const lines = content.split(/\r?\n/);
	const groups: RobotsGroup[] = [];
	const sitemaps: string[] = [];

	let currentGroup: RobotsGroup | null = null;

	for (const raw of lines) {
		// Strip inline comments and trim
		const line = raw.replace(/#.*$/, "").trim();
		if (!line) {
			// Empty line ends the current group
			if (currentGroup !== null) {
				groups.push(currentGroup);
				currentGroup = null;
			}
			continue;
		}

		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const field = line.slice(0, colonIdx).trim().toLowerCase();
		const value = line.slice(colonIdx + 1).trim();

		switch (field) {
			case "user-agent": {
				const agent = value.toLowerCase();
				if (currentGroup === null || currentGroup.rules.length > 0) {
					// Start a new group
					currentGroup = { agents: [agent], rules: [] };
				} else {
					// Multiple User-agent lines before any rules = multi-agent group
					currentGroup.agents.push(agent);
				}
				break;
			}
			case "disallow": {
				if (currentGroup === null) break;
				if (value === "") {
					// Empty Disallow means "allow everything" (RFC 9309 §2.2.3)
					// We skip adding a rule — absence means allowed.
					break;
				}
				currentGroup.rules.push({
					allow: false,
					pattern: compilePattern(value),
					length: value.length,
				});
				break;
			}
			case "allow": {
				if (currentGroup === null) break;
				currentGroup.rules.push({
					allow: true,
					pattern: compilePattern(value),
					length: value.length,
				});
				break;
			}
			case "crawl-delay": {
				if (currentGroup === null) break;
				const delay = parseFloat(value);
				if (!Number.isNaN(delay) && delay >= 0) {
					currentGroup.crawlDelay = delay;
				}
				break;
			}
			case "sitemap": {
				if (value) sitemaps.push(value);
				break;
			}
			default:
				// Unknown directives are ignored per RFC 9309 §2.3.
				break;
		}
	}

	// Flush the last group if file doesn't end with a blank line
	if (currentGroup !== null) {
		groups.push(currentGroup);
	}

	return { groups, sitemaps };
}

// ---------------------------------------------------------------------------
// RobotsFile
// ---------------------------------------------------------------------------

/**
 * Parsed and queryable robots.txt file.
 */
export class RobotsFile {
	readonly #groups: RobotsGroup[];
	readonly #sitemaps: string[];
	readonly #sourceUrl: string;

	private constructor(sourceUrl: string, content: string) {
		this.#sourceUrl = sourceUrl;
		const parsed = parseRobotsTxt(content);
		this.#groups = parsed.groups;
		this.#sitemaps = parsed.sitemaps;
	}

	// ---------------------------------------------------------------------------
	// Factories
	// ---------------------------------------------------------------------------

	/**
	 * Fetch robots.txt for the given URL's origin and parse it.
	 * Returns a permissive (allow-all) instance if the file cannot be fetched.
	 */
	static async fetch(url: string, opts: RobotsFileOptions = {}): Promise<RobotsFile> {
		const origin = new URL(url);
		const robotsUrl = `${origin.protocol}//${origin.host}/robots.txt`;
		const ua = opts.userAgent ?? "Bunlight/1.0";
		const timeoutMs = opts.timeoutMs ?? 10_000;

		try {
			const res = await globalThis.fetch(robotsUrl, {
				headers: { "User-Agent": ua },
				signal: opts.signal ?? AbortSignal.timeout(timeoutMs),
			});

			// 404 or 5xx → treat as "allow all" per RFC 9309 §2.3.1.2
			if (res.status === 404 || res.status >= 500) {
				return new RobotsFile(robotsUrl, "");
			}

			const text = await res.text();
			return new RobotsFile(robotsUrl, text);
		} catch {
			// Network errors → allow all
			return new RobotsFile(robotsUrl, "");
		}
	}

	/**
	 * Parse robots.txt from raw string content (useful for testing or caching).
	 */
	static parse(sourceUrl: string, content: string): RobotsFile {
		return new RobotsFile(sourceUrl, content);
	}

	// ---------------------------------------------------------------------------
	// Queries
	// ---------------------------------------------------------------------------

	/** URL of the robots.txt file that was parsed. */
	get sourceUrl(): string {
		return this.#sourceUrl;
	}

	/** All `Sitemap:` directives found in the file. */
	get sitemaps(): string[] {
		return this.#sitemaps;
	}

	/**
	 * Check whether a user-agent is allowed to crawl a URL path.
	 *
	 * Matching precedence (RFC 9309 §2.2.2):
	 *  1. Find all groups that match the agent (including `*`).
	 *  2. Collect all matching rules from those groups.
	 *  3. The rule with the longest (most specific) pattern wins.
	 *  4. Ties broken in favour of Allow.
	 *  5. If no rules match, the URL is allowed.
	 */
	isAllowed(url: string, userAgent = "*"): boolean {
		const path = (() => {
			try {
				const u = new URL(url);
				return u.pathname + u.search;
			} catch {
				return url; // allow relative paths in tests
			}
		})();

		const agentLower = userAgent.toLowerCase();
		const matchedGroups = this.#groups.filter(
			(g) => g.agents.includes(agentLower) || g.agents.includes("*"),
		);

		// Prefer exact agent match over wildcard
		const specificGroups = matchedGroups.filter((g) => g.agents.includes(agentLower));
		const activeGroups = specificGroups.length > 0 ? specificGroups : matchedGroups;

		// Collect all matching rules across groups
		interface MatchedRule {
			allow: boolean;
			length: number;
		}
		const matches: MatchedRule[] = [];

		for (const group of activeGroups) {
			for (const rule of group.rules) {
				if (rule.pattern.test(path)) {
					matches.push({ allow: rule.allow, length: rule.length });
				}
			}
		}

		if (matches.length === 0) return true; // No rule → allow

		// Longest pattern wins; ties favour Allow
		let best: MatchedRule = matches[0];
		for (const m of matches.slice(1)) {
			if (m.length > best.length) best = m;
			else if (m.length === best.length && m.allow) best = m;
		}

		return best.allow;
	}

	/**
	 * Return the `Crawl-delay` value (in seconds) for the given user-agent.
	 * Returns `undefined` if no crawl-delay is specified.
	 */
	crawlDelay(userAgent = "*"): number | undefined {
		const agentLower = userAgent.toLowerCase();

		// Prefer exact match
		const exact = this.#groups.find((g) => g.agents.includes(agentLower));
		if (exact?.crawlDelay !== undefined) return exact.crawlDelay;

		// Fallback to wildcard group
		const wildcard = this.#groups.find((g) => g.agents.includes("*"));
		return wildcard?.crawlDelay;
	}

	/**
	 * Return raw allow/disallow rules for a specific user-agent (for debugging).
	 */
	getRules(userAgent = "*"): Array<{ allow: boolean; pattern: string }> {
		const agentLower = userAgent.toLowerCase();
		const groups = this.#groups.filter(
			(g) => g.agents.includes(agentLower) || g.agents.includes("*"),
		);
		return groups.flatMap((g) =>
			g.rules.map((r) => ({ allow: r.allow, pattern: r.pattern.source })),
		);
	}
}
