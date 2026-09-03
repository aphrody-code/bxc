// SPDX-License-Identifier: Apache-2.0
import { XSession } from "../core/session";
import { XClient } from "../core/client";
import { Store } from "../db/store";
import { walkTimelineUsers } from "../core/parse";
import { redis } from "bun";

const model = "gemini-embedding-001";
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// Initialize tweet_embeddings table
function initEmbeddingsTable(store: Store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS tweet_embeddings (
      tweet_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
  `);
}

// Convert float32 array to Buffer for SQLite BLOB
function vectorToBlob(vector: number[]): Buffer {
  const floatArray = new Float32Array(vector);
  return Buffer.from(floatArray.buffer);
}

// Get embedding from Gemini API
async function getGeminiEmbedding(text: string): Promise<number[]> {
  if (!apiKey) {
    const mock = Array.from({ length: 768 }, () => Math.random() - 0.5);
    const magnitude = Math.sqrt(mock.reduce((sum, val) => sum + val * val, 0));
    return mock.map(val => val / magnitude);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      content: {
        parts: [{ text }]
      },
      outputDimensionality: 768
    })
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
  }

  const json = await response.json() as any;
  if (!json.embedding?.values) {
    throw new Error("Invalid embedding response format");
  }
  return json.embedding.values;
}

async function getVerifiedFollowers(client: XClient, userId: string): Promise<any[]> {
  try {
    const res = await client.graphqlWaiting("BlueVerifiedFollowers", {
      userId,
      count: 80,
      includePromotedContent: false,
    });
    const parsed = walkTimelineUsers(res);
    return parsed.users;
  } catch (err: any) {
    console.error(`[targeted-crawler] Failed to fetch verified followers for user ID ${userId}: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log("=== Starting Targeted Crawler ===");
  
  console.log("Connecting to SQLite Store...");
  const store = new Store();
  initEmbeddingsTable(store);

  console.log("Loading session credentials...");
  let session: XSession;
  try {
    session = XSession.load();
    console.log(`Session loaded for handle: @${session.handle || "unknown"}`);
  } catch (err: any) {
    console.error(`Failed to load session: ${err.message}`);
    store.close();
    process.exit(1);
  }

  const client = new XClient(session);

  console.log("Resolving whoami...");
  try {
    const user = await client.whoami();
    console.log(`Authenticated as @${user.screen_name} (ID: ${user.id})`);
  } catch (err: any) {
    console.error(`Failed to authenticate client: ${err.message}`);
    store.close();
    process.exit(1);
  }

  console.log("Connecting to Redis...");
  try {
    await redis.connect();
    console.log("Connected to Redis.");
  } catch (err: any) {
    console.error(`Failed to connect to Redis: ${err.message}`);
    store.close();
    process.exit(1);
  }

  // Targets definition
  const followTargets = ["rpb_ey", "SunAfterTheBey"];
  const verifiedFollowersTargets = ["SunAfterTheBey", "Beyblade_Espace", "x_beyblade"];
  const directTweetTargets = ["x_beyblade"];

  const queueUsernames = new Set<string>();

  // Helper to add handle to queue
  const enqueue = (username: string) => {
    const cleaned = username.trim().toLowerCase().replace(/^@/, "");
    if (cleaned && cleaned !== "null" && cleaned !== "undefined") {
      queueUsernames.add(cleaned);
    }
  };

  // Add direct targets first
  for (const t of directTweetTargets) enqueue(t);

  // 1. Fetch followings
  for (const target of followTargets) {
    try {
      console.log(`[targeted-crawler] Resolving ID for @${target}...`);
      const userId = await client.userIdFor(target);
      console.log(`[targeted-crawler] Fetching following list for @${target} (ID: ${userId})...`);
      const res = await client.following(userId, 100);
      console.log(`[targeted-crawler] Found ${res.users.length} followed accounts.`);
      for (const u of res.users) {
        store.upsertUser(u);
        store.addFollow(target, "following", u);
        enqueue(u.username);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`[targeted-crawler] Failed to fetch following for ${target}: ${err.message}`);
    }
  }

  // 2. Fetch verified followers
  for (const target of verifiedFollowersTargets) {
    try {
      console.log(`[targeted-crawler] Resolving ID for @${target}...`);
      const userId = await client.userIdFor(target);
      console.log(`[targeted-crawler] Fetching verified followers list for @${target} (ID: ${userId})...`);
      const users = await getVerifiedFollowers(client, userId);
      console.log(`[targeted-crawler] Found ${users.length} verified followers.`);
      for (const u of users) {
        store.upsertUser(u);
        store.addFollow(target, "follower", u);
        enqueue(u.username);
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`[targeted-crawler] Failed to fetch verified followers for ${target}: ${err.message}`);
    }
  }

  console.log(`\n[targeted-crawler] Consolidated targeted user queue. Total unique users: ${queueUsernames.size}`);
  console.log(Array.from(queueUsernames));

  // 3. Process each targeted user (crawl tweets + embed + sync to Redis)
  let count = 0;
  for (const username of queueUsernames) {
    count++;
    console.log(`\n[targeted-crawler] [${count}/${queueUsernames.size}] Processing @${username}...`);
    try {
      // Resolve User ID
      const userId = await client.userIdFor(username);
      const profile = await client.userByScreenName(username);
      
      store.upsertUser({
        id: userId,
        username: profile.screen_name,
        name: profile.name,
        followers_count: profile.followers_count,
        following_count: profile.friends_count,
      });

      console.log(`[targeted-crawler] Fetching tweets for @${username} (ID: ${userId})...`);
      const tweetsPage = await client.userTweets(userId, 15);
      console.log(`[targeted-crawler] Got ${tweetsPage.tweets.length} tweets.`);

      for (const t of tweetsPage.tweets) {
        // Upsert SQLite
        store.upsertTweet(t);
        store.addEdge(username, "authored", t.id);

        // Generate embedding
        try {
          const embedding = await getGeminiEmbedding(t.text);
          const blob = vectorToBlob(embedding);

          store.db.prepare(`
            INSERT INTO tweet_embeddings (tweet_id, embedding)
            VALUES (?, ?)
            ON CONFLICT(tweet_id) DO UPDATE SET embedding = excluded.embedding
          `).run(t.id, blob);

          // Push to Redis
          await redis.send("VADD", [
            "tweet_embeddings",
            "FP32",
            blob as any,
            t.id
          ]);
        } catch (embedErr: any) {
          console.error(`[targeted-crawler] Failed to generate/push embedding for tweet ${t.id}: ${embedErr.message}`);
        }
      }

      console.log(`[targeted-crawler] Completed @${username}.`);
      
      // Delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (err: any) {
      console.error(`[targeted-crawler] Failed to process user @${username}: ${err.message}`);
      // Sleep a bit on failure
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log("\n=== Targeted Crawler completed! ===");
  store.close();
  try {
    redis.close();
  } catch {}
}

main().catch(console.error);
