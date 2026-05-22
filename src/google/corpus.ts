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
 * @module bxc/google/corpus
 *
 * Self-reinforcing knowledge base for the Google web-stack profiler. Every
 * `bxc profile` run feeds its findings here; subsequent runs read it back to
 * prime detection (known API patterns, framework signatures, JS globals).
 * The corpus is a single JSON file — no DB, no native dep, gitignored.
 *
 * "bxc gets stronger on every scrape": each scrape increments occurrence
 * counts and widens the per-host signature, so the profiler's confidence and
 * the API surface it knows about grow monotonically over time.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/** A counted, time-stamped observation. */
export interface Tally {
	count: number;
	firstSeen: string;
	lastSeen: string;
}

/** Everything bxc has learned about one host. */
export interface HostKnowledge {
	host: string;
	scrapes: number;
	/** Framework name → tally (React, Wiz/Boq, Angular, Lit, Next.js…). */
	frameworks: Record<string, Tally>;
	/** API endpoint pattern (host + normalised path) → tally. */
	apis: Record<string, Tally>;
	/** Window global name → tally (gapi, google, __NEXT_DATA__, ng…). */
	globals: Record<string, Tally>;
	/** Response/security header name → last observed value. */
	headers: Record<string, string>;
	/** Rolling averages of the resource graph. */
	stats: { css: number; js: number; api: number; htmlBytes: number };
}

export interface Corpus {
	version: 1;
	updatedAt: string;
	hosts: Record<string, HostKnowledge>;
}

/** What a single profile run contributes to the corpus. */
export interface ProfileContribution {
	host: string;
	frameworks: string[];
	apis: string[];
	globals: string[];
	headers: Record<string, string>;
	counts: { css: number; js: number; api: number; htmlBytes: number };
}

export function corpusDir(): string {
	return (
		process.env.BXC_PROFILE_DIR ?? join(process.cwd(), "storage", "google-profiles")
	);
}

function corpusPath(): string {
	return join(corpusDir(), "corpus.json");
}

const EMPTY: Corpus = { version: 1, updatedAt: "", hosts: {} };

/** Load the corpus, or an empty one if none exists yet. */
export async function loadCorpus(): Promise<Corpus> {
	try {
		const file = Bun.file(corpusPath());
		if (!(await file.exists())) return structuredClone(EMPTY);
		const parsed = (await file.json()) as Corpus;
		if (parsed?.version !== 1 || typeof parsed.hosts !== "object") {
			return structuredClone(EMPTY);
		}
		return parsed;
	} catch {
		return structuredClone(EMPTY);
	}
}

async function saveCorpus(corpus: Corpus): Promise<void> {
	await mkdir(corpusDir(), { recursive: true });
	corpus.updatedAt = new Date().toISOString();
	await Bun.write(corpusPath(), JSON.stringify(corpus, null, 2));
}

function bump(map: Record<string, Tally>, keys: readonly string[], now: string): void {
	for (const raw of keys) {
		const key = raw.trim();
		if (!key) continue;
		const t = map[key];
		if (t) {
			t.count += 1;
			t.lastSeen = now;
		} else {
			map[key] = { count: 1, firstSeen: now, lastSeen: now };
		}
	}
}

/** Exponential moving average — recent scrapes weigh ~30 %. */
function ema(prev: number, next: number): number {
	return Math.round(prev * 0.7 + next * 0.3);
}

/**
 * Merge one profile's findings into the corpus and persist it. Returns the
 * updated per-host knowledge so the caller can show what bxc now knows.
 */
export async function reinforce(c: ProfileContribution): Promise<HostKnowledge> {
	const corpus = await loadCorpus();
	const now = new Date().toISOString();

	const k: HostKnowledge =
		corpus.hosts[c.host] ??
		{
			host: c.host,
			scrapes: 0,
			frameworks: {},
			apis: {},
			globals: {},
			headers: {},
			stats: { css: 0, js: 0, api: 0, htmlBytes: 0 },
		};

	k.scrapes += 1;
	bump(k.frameworks, c.frameworks, now);
	bump(k.apis, c.apis, now);
	bump(k.globals, c.globals, now);
	k.headers = { ...k.headers, ...c.headers };
	k.stats = {
		css: ema(k.stats.css, c.counts.css),
		js: ema(k.stats.js, c.counts.js),
		api: ema(k.stats.api, c.counts.api),
		htmlBytes: ema(k.stats.htmlBytes, c.counts.htmlBytes),
	};

	corpus.hosts[c.host] = k;
	await saveCorpus(corpus);
	return k;
}

/**
 * Learned hints for an upcoming scrape of `host`: the API patterns and
 * framework names bxc has already confirmed there (sorted by frequency).
 * Lets the profiler prioritise and recognise faster on repeat visits.
 */
export async function corpusHints(
	host: string,
): Promise<{ apis: string[]; frameworks: string[]; globals: string[] }> {
	const corpus = await loadCorpus();
	const k = corpus.hosts[host];
	if (!k) return { apis: [], frameworks: [], globals: [] };
	const byFreq = (m: Record<string, Tally>) =>
		Object.entries(m)
			.toSorted((a, b) => b[1].count - a[1].count)
			.map(([key]) => key);
	return {
		apis: byFreq(k.apis),
		frameworks: byFreq(k.frameworks),
		globals: byFreq(k.globals),
	};
}
