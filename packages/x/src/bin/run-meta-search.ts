// SPDX-License-Identifier: Apache-2.0
import { XSession } from "../core/session";
import { XClient } from "../core/client";
import { Store } from "../db/store";

async function main() {
  console.log(`Loading session...`);
  let session: XSession;
  try {
    session = XSession.load();
  } catch (err: any) {
    console.error(`Failed to load session: ${err.message}`);
    process.exit(1);
  }

  const store = new Store();
  const client = new XClient(session);

  const searchQueries = [
    "beyblade x meta",
    "beyblade x tier list",
    "best beyblade x combo",
    "best beyblade x parts",
    "beyblade x tournament meta"
  ];

  console.log(`Starting live meta search on x.com...`);
  
  for (const query of searchQueries) {
    console.log(`Searching for: "${query}"...`);
    try {
      // Fetch latest discussions
      const page = await client.search(query, 20, undefined, "Latest");
      console.log(`Found ${page.tweets.length} tweets for "${query}".`);

      let ingested = 0;
      for (const t of page.tweets) {
        store.upsertTweet(t);
        store.addEdge(t.author.username, "authored", t.id);
        ingested++;
      }
      console.log(`Ingested ${ingested} tweets into SQLite store.`);
    } catch (err: any) {
      console.warn(`Search failed for "${query}": ${err.message}`);
    }
    // Politeness delay
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  // Query database for discussions talking about meta, best parts, tier lists
  console.log(`\nQuerying local database for meta discussions...`);
  const keywords = ["meta", "tier", "best", "combo", "win", "tournament", "parts"];
  
  const discussions: any[] = [];
  const seenIds = new Set<string>();

  for (const keyword of keywords) {
    try {
      const results = store.search(keyword, 10);
      for (const r of results) {
        if (!seenIds.has(r.id)) {
          seenIds.add(r.id);
          discussions.push(r);
        }
      }
    } catch (err: any) {
      console.error(`Search query for "${keyword}" failed: ${err.message}`);
    }
  }

  console.log(`\n--- TOP BEYBLADE X META DISCUSSIONS FOUND IN DATABASE ---`);
  if (discussions.length === 0) {
    console.log(`No matching discussions found yet.`);
  } else {
    // Sort by likes
    const sorted = discussions.sort((a, b) => b.like_count - a.like_count).slice(0, 15);
    for (const d of sorted) {
      console.log(`\n[Author: @${d.author_username}] (Likes: ${d.like_count})`);
      console.log(`Text: ${d.text}`);
      console.log(`Link: https://x.com/i/status/${d.id}`);
      console.log(`-----------------------------------------------`);
    }
  }

  store.close();
}

main().catch(console.error);
