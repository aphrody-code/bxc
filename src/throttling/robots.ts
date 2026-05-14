/**
 * @module bunlight/throttling/robots
 *
 * Minimal RFC 9309-conformant robots.txt parser for the rate limiter.
 *
 * This is a lightweight, standalone parser focused on the three directives
 * needed for polite crawling:
 *   - User-agent
 *   - Disallow / Allow
 *   - Crawl-delay
 *
 * Wildcards supported: `*` in path patterns (matches any char sequence),
 * `$` as end-of-path anchor.
 *
 * Fetch strategy:
 *   - GET /robots.txt with a timeout (default 8s).
 *   - 404 or 5xx response: assume fully allowed (RFC 9309 section 2.3.1.2).
 *   - Network error or timeout: assume fully allowed (polite degradation).
 *
 * @example
 * ```ts
 * const rules = await fetchRobotRules("https://example.com", "MyBot/1.0");
 * console.log(rules.crawlDelay); // 2 or undefined
 * console.log(rules.allowed("/private/")); // false
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed result for one user-agent from robots.txt. */
export interface RobotRules {
	/** Crawl-delay in seconds, or undefined if not specified. */
	crawlDelay?: number;
	/**
	 * Returns true if the given path is allowed to be fetched.
	 * Path should start with `/`.
	 */
	allowed(path: string): boolean;
}

// Internal types

interface ParsedRule {
	allow: boolean;
	/** Compiled regex from the pattern. */
	pattern: RegExp;
	/** Raw pattern length for precedence (longest wins per RFC 9309). */
	length: number;
}

interface ParsedGroup {
	agents: string[];
	rules: ParsedRule[];
	crawlDelay?: number;
}

// ---------------------------------------------------------------------------
// Pattern compilation
// ---------------------------------------------------------------------------

/**
 * Compile a robots.txt path pattern string into a RegExp.
 * RFC 9309 section 2.2.2:
 *   - `*` matches any sequence of characters (including empty string).
 *   - `$` at end anchors the match to end of path.
 */
function compilePattern(raw: string): RegExp {
	const anchored = raw.endsWith("$");
	const base = anchored ? raw.slice(0, -1) : raw;

	// Escape regex metacharacters except *, then convert * to .*
	const escaped = base.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");

	return new RegExp("^" + escaped + (anchored ? "$" : ""), "i");
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse the raw text of a robots.txt file into groups.
 * Exported for testing and reuse.
 */
export function parseRobotsTxt(content: string): ParsedGroup[] {
	const lines = content.split(/\r?\n/);
	const groups: ParsedGroup[] = [];
	let current: ParsedGroup | null = null;

	const flush = (): void => {
		if (current !== null) {
			groups.push(current);
			current = null;
		}
	};

	for (const raw of lines) {
		// Strip inline comments and trim whitespace
		const line = raw.replace(/#.*$/, "").trim();

		if (!line) {
			// Blank line ends the current group
			flush();
			continue;
		}

		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const field = line.slice(0, colonIdx).trim().toLowerCase();
		const value = line.slice(colonIdx + 1).trim();

		switch (field) {
			case "user-agent": {
				const agent = value.toLowerCase();
				if (current === null || current.rules.length > 0) {
					// Start a fresh group
					flush();
					current = { agents: [agent], rules: [] };
				} else {
					// Multiple User-agent before any rules: multi-agent group
					current.agents.push(agent);
				}
				break;
			}

			case "disallow": {
				if (current === null) break;
				// Empty Disallow = allow everything (RFC 9309 section 2.2.3)
				if (value === "") break;
				current.rules.push({
					allow: false,
					pattern: compilePattern(value),
					length: value.length,
				});
				break;
			}

			case "allow": {
				if (current === null) break;
				if (value === "") break;
				current.rules.push({
					allow: true,
					pattern: compilePattern(value),
					length: value.length,
				});
				break;
			}

			case "crawl-delay": {
				if (current === null) break;
				const delay = parseFloat(value);
				if (!Number.isNaN(delay) && delay >= 0) {
					current.crawlDelay = delay;
				}
				break;
			}

			default:
				// Unknown directives are silently ignored per RFC 9309 section 2.3
				break;
		}
	}

	// Flush the final group if the file does not end with a blank line
	flush();

	return groups;
}

// ---------------------------------------------------------------------------
// Group matching
// ---------------------------------------------------------------------------

/**
 * Select the best-matching groups for a given user-agent string.
 * Prefers exact agent match over wildcard `*` per RFC 9309.
 */
function selectGroups(groups: ParsedGroup[], agentLower: string): ParsedGroup[] {
	const exact = groups.filter((g) => g.agents.includes(agentLower));
	if (exact.length > 0) return exact;
	return groups.filter((g) => g.agents.includes("*"));
}

/**
 * Check whether a path is allowed given a set of matched groups.
 * Longest match wins; ties favour Allow per RFC 9309 section 2.2.2.
 */
function isPathAllowed(activeGroups: ParsedGroup[], path: string): boolean {
	interface Candidate {
		allow: boolean;
		length: number;
	}

	let best: Candidate | null = null;

	for (const group of activeGroups) {
		for (const rule of group.rules) {
			if (!rule.pattern.test(path)) continue;
			if (
				best === null ||
				rule.length > best.length ||
				(rule.length === best.length && rule.allow)
			) {
				best = { allow: rule.allow, length: rule.length };
			}
		}
	}

	// No matching rule: allow by default
	return best === null ? true : best.allow;
}

// ---------------------------------------------------------------------------
// RobotRules implementation
// ---------------------------------------------------------------------------

/**
 * Build a `RobotRules` object from parsed groups for a specific user-agent.
 * Exported for testing.
 */
export function buildRobotRules(groups: ParsedGroup[], userAgent: string): RobotRules {
	const agentLower = userAgent.toLowerCase();
	const activeGroups = selectGroups(groups, agentLower);

	// Crawl-delay: prefer exact match, fallback to wildcard group
	let crawlDelay: number | undefined;
	const exactGroup = groups.find((g) => g.agents.includes(agentLower));
	if (exactGroup?.crawlDelay !== undefined) {
		crawlDelay = exactGroup.crawlDelay;
	} else {
		const wildcardGroup = groups.find((g) => g.agents.includes("*"));
		crawlDelay = wildcardGroup?.crawlDelay;
	}

	return {
		crawlDelay,
		allowed(path: string): boolean {
			// Normalise: must start with /
			const p = path.startsWith("/") ? path : "/" + path;
			return isPathAllowed(activeGroups, p);
		},
	};
}

// ---------------------------------------------------------------------------
// Fetch helper
// ---------------------------------------------------------------------------

/** Options for fetching robots.txt. */
export interface FetchRobotRulesOptions {
	/** User-agent string used for both the HTTP request and the rules lookup. */
	userAgent?: string;
	/** Fetch timeout in milliseconds. Default: 8000. */
	timeoutMs?: number;
}

/**
 * Fetch /robots.txt for the given URL's origin and return parsed rules
 * for the specified user-agent.
 *
 * On any failure (404, 5xx, network error, timeout) returns a fully
 * permissive set of rules (crawlDelay = undefined, allowed = always true).
 *
 * Uses the global `fetch` (Bun's native implementation, no npm deps).
 */
export async function fetchRobotRules(
	url: string,
	userAgent = "Bunlight/1.0",
	opts: FetchRobotRulesOptions = {},
): Promise<RobotRules> {
	const timeoutMs = opts.timeoutMs ?? 8_000;

	// Build the robots.txt URL from the origin
	let robotsUrl: string;
	try {
		const u = new URL(url);
		robotsUrl = `${u.protocol}//${u.host}/robots.txt`;
	} catch {
		// Invalid URL: allow everything
		return buildRobotRules([], userAgent);
	}

	try {
		const res = await fetch(robotsUrl, {
			headers: { "User-Agent": userAgent },
			signal: AbortSignal.timeout(timeoutMs),
		});

		// 404 or 5xx: treat as allow-all per RFC 9309 section 2.3.1.2
		if (res.status === 404 || res.status >= 500) {
			return buildRobotRules([], userAgent);
		}

		const text = await res.text();
		const groups = parseRobotsTxt(text);
		return buildRobotRules(groups, userAgent);
	} catch {
		// Network error, timeout, CORS, etc. -> allow everything
		return buildRobotRules([], userAgent);
	}
}
