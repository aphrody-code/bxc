#!/usr/bin/env bun
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
 * import-cookies.ts — convert a Chrome DevTools "Cookies" tab-separated dump
 * into the Playwright/CDP JSON format expected by `bunlight`'s cookie-loader.
 *
 * The DevTools dump (Application > Cookies > select-all > copy) emits one
 * cookie per line with tab-separated columns :
 *
 *   name  value  domain  path  expires  size  httpOnly  secure  sameSite ...
 *
 * Example invocation :
 *
 *   bun run examples/challonge-api/import-cookies.ts \
 *     ./challonge-cookies.tsv \
 *     ./examples/challonge-api/cookies/private/challonge.json
 *
 * Or from stdin :
 *
 *   pbpaste | bun run examples/challonge-api/import-cookies.ts \
 *     - ./examples/challonge-api/cookies/private/challonge.json
 *
 * Output schema (compatible with `bunlight/src/cookies/cookie-loader.ts`) :
 *
 *   [
 *     { "name": "cf_clearance", "value": "...", "domain": ".challonge.com",
 *       "path": "/", "expires": 1778429330, "secure": true, "httpOnly": true,
 *       "sameSite": "None" },
 *     ...
 *   ]
 *
 * Bun-native only.
 */

interface CookieEntry {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: "Strict" | "Lax" | "None";
}

const SAMESITE_MAP: Record<string, CookieEntry["sameSite"]> = {
	strict: "Strict",
	lax: "Lax",
	none: "None",
	"": undefined as unknown as "None",
};

function isCheck(s: string): boolean {
	const t = s.trim().toLowerCase();
	return t === "yes" || t === "true" || t === "✓" || t === "y";
}

function parseExpires(raw: string): number | undefined {
	const t = raw.trim();
	if (!t || t.toLowerCase() === "session") return undefined;
	const ms = Date.parse(t);
	if (Number.isNaN(ms)) return undefined;
	return Math.floor(ms / 1000);
}

function parseLine(line: string): CookieEntry | null {
	// Split on TAB; tolerate runs of spaces if no TAB present.
	const parts = line.includes("\t") ? line.split("\t") : line.split(/ {2,}/);
	if (parts.length < 4) return null;
	const [name, value, domain, path, expires, _size, httpOnly, secure, sameSite] = parts.map((s) =>
		s.trim(),
	);
	if (!name || !domain) return null;
	const out: CookieEntry = {
		name,
		value: value ?? "",
		domain,
		path: path || "/",
	};
	const exp = parseExpires(expires ?? "");
	if (exp !== undefined) out.expires = exp;
	if (isCheck(httpOnly ?? "")) out.httpOnly = true;
	if (isCheck(secure ?? "")) out.secure = true;
	const ssKey = (sameSite ?? "").toLowerCase();
	if (ssKey in SAMESITE_MAP && SAMESITE_MAP[ssKey] !== undefined) {
		out.sameSite = SAMESITE_MAP[ssKey];
	}
	return out;
}

async function readSource(path: string): Promise<string> {
	if (path === "-") {
		const decoder = new TextDecoder();
		const chunks: string[] = [];
		for await (const chunk of Bun.stdin.stream()) {
			chunks.push(decoder.decode(chunk));
		}
		return chunks.join("");
	}
	const f = Bun.file(path);
	if (!(await f.exists())) {
		throw new Error(`Source not found: ${path}`);
	}
	return f.text();
}

export async function importCookies(source: string, target: string): Promise<CookieEntry[]> {
	const raw = await readSource(source);
	const cookies: CookieEntry[] = [];
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		// Skip header line if it starts with "Name" (DevTools-specific).
		if (/^name\s+value/i.test(trimmed)) continue;
		const c = parseLine(trimmed);
		if (c) cookies.push(c);
	}
	const json = JSON.stringify(cookies, null, 2);
	if (target !== "-") {
		await Bun.write(target, json);
	} else {
		Bun.stdout.write(json + "\n");
	}
	Bun.stderr.write(
		`import-cookies: ${cookies.length} cookies → ${target === "-" ? "stdout" : target}\n`,
	);
	return cookies;
}

if (import.meta.main) {
	const [, , source, target] = process.argv;
	if (!source || !target) {
		Bun.stderr.write(
			"Usage: bun import-cookies.ts <source.tsv|-> <target.json|->\n" +
				"Example: bun import-cookies.ts cookies.tsv cookies/private/challonge.json\n",
		);
		process.exit(2);
	}
	await importCookies(source, target);
}
