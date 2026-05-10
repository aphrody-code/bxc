/**
 * Example — Reddit JSON Crawler (profile: http)
 *
 * Fetches the top 25 posts from /r/programming using Reddit's public JSON API,
 * then fetches the top comment thread for each post.
 *
 * Profile choice: "http" (curl-impersonate, Chrome131 TLS fingerprint)
 * Reddit blocks generic User-Agents and headless browser TLS fingerprints; the
 * curl-impersonate profile presents a real browser JA3/JA4, which passes Reddit's
 * basic bot filter without a full browser rendering stack.
 *
 * Usage:
 *   bun run examples/reddit-json-crawler.ts
 *
 * Output:
 *   storage/datasets/reddit-programming/data.jsonl  (one JSON row per post)
 *   storage/datasets/reddit-programming/meta.json   (item count)
 */

import { Browser } from "../src/api/browser.ts";
import type { HttpPage } from "../src/api/browser.ts";
import { Dataset } from "../src/storage/Dataset.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RedditChild {
	data: {
		id: string;
		title: string;
		url: string;
		score: number;
		num_comments: number;
		permalink: string;
		author: string;
		created_utc: number;
	};
}

interface RedditListing {
	data: {
		children: RedditChild[];
	};
}

interface RedditCommentChild {
	data?: {
		author?: string;
		body?: string;
		score?: number;
	};
	kind?: string;
}

interface RedditCommentListing {
	data: {
		children: RedditCommentChild[];
	};
}

interface PostRecord {
	id: string;
	title: string;
	url: string;
	score: number;
	numComments: number;
	permalink: string;
	author: string;
	createdUtc: number;
	topComment: string | null;
	topCommentAuthor: string | null;
	topCommentScore: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "https://www.reddit.com";

const REDDIT_HEADERS: Record<string, string> = {
	accept: "application/json",
	"accept-language": "en-US,en;q=0.9",
	// Reddit requires a descriptive UA for API access — generic browser UA
	// is rejected by the JSON API with a 429; identify as a bot script.
	"user-agent": "bunlight-example/0.1 (educational scraping demo; contact: dev@example.com)",
};

async function fetchJson<T>(page: HttpPage, url: string): Promise<T> {
	const res = await page.fetch(url, {
		method: "GET",
		followRedirects: true,
		timeoutMs: 20_000,
		headers: REDDIT_HEADERS,
	});
	const text = await res.text();
	return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const dataset = await Dataset.open("reddit-programming");
const page = (await Browser.newPage({
	profile: "http",
	httpOpts: { profile: "chrome131" },
})) as HttpPage;

console.log("Fetching /r/programming top 25...");

let listing: RedditListing;
try {
	listing = await fetchJson<RedditListing>(page, `${BASE}/r/programming/top.json?limit=25&t=day`);
} catch (err) {
	console.error("Failed to fetch subreddit listing:", String(err));
	await page.close();
	process.exit(1);
}

const posts = listing.data.children;
console.log(`Retrieved ${posts.length} posts. Fetching comment threads...`);

for (let i = 0; i < posts.length; i++) {
	const child = posts[i];
	const post = child.data;

	// Rate-limit: Reddit allows ~1 req/sec for unauthenticated bots
	if (i > 0) await Bun.sleep(1100);

	let topComment: string | null = null;
	let topCommentAuthor: string | null = null;
	let topCommentScore: number | null = null;

	try {
		const commentUrl = `${BASE}${post.permalink}.json?limit=1&sort=top`;
		const threads = await fetchJson<RedditCommentListing[]>(page, commentUrl);
		// Second element in the array is the comments listing
		const comments = threads[1]?.data?.children ?? [];
		const firstComment = comments.find((c) => c.kind === "t1");
		if (firstComment?.data) {
			topComment = firstComment.data.body ?? null;
			topCommentAuthor = firstComment.data.author ?? null;
			topCommentScore = firstComment.data.score ?? null;
		}
	} catch {
		// Non-fatal: comment fetch may fail on deleted/locked threads
	}

	const record: PostRecord = {
		id: post.id,
		title: post.title,
		url: post.url,
		score: post.score,
		numComments: post.num_comments,
		permalink: `${BASE}${post.permalink}`,
		author: post.author,
		createdUtc: post.created_utc,
		topComment,
		topCommentAuthor,
		topCommentScore,
	};

	await dataset.pushData(record);
	console.log(`  [${i + 1}/${posts.length}] score=${post.score} "${post.title.slice(0, 60)}"`);
}

const count = dataset.getItemCount();
await dataset.close();
await page.close();

console.log(`\nDone. ${count} posts saved to storage/datasets/reddit-programming/data.jsonl`);
