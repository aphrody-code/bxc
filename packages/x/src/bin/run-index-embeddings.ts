// SPDX-License-Identifier: Apache-2.0
import { Store } from "../db/store";
import { redis } from "bun";

const model = "gemini-embedding-001";
const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

// Create the embeddings table if not exists
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
    // Return mock 768-dimensional normalized vector if offline/no key
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

async function indexBatch(store: Store): Promise<number> {
  // Find up to 50 tweets that don't have embeddings yet
  const rows = store.db.prepare(`
    SELECT t.id, t.text 
    FROM tweets t
    LEFT JOIN tweet_embeddings e ON t.id = e.tweet_id
    WHERE e.tweet_id IS NULL
    LIMIT 50
  `).all() as { id: string; text: string }[];

  if (rows.length === 0) {
    return 0;
  }

  console.log(`[embeddings-loop] Generating embeddings for a batch of ${rows.length} tweets...`);
  
  let successCount = 0;
  for (const row of rows) {
    try {
      // Clean up text slightly to avoid unnecessary whitespace
      const cleanText = row.text.trim();
      if (!cleanText) continue;

      const vector = await getGeminiEmbedding(cleanText);
      const blob = vectorToBlob(vector);

      store.db.prepare(`
        INSERT OR REPLACE INTO tweet_embeddings (tweet_id, embedding)
        VALUES (?, ?)
      `).run(row.id, blob);

      // Add to Redis Vector Set too
      try {
        await redis.send("VADD", [
          "tweet_embeddings",
          "FP32",
          blob as any,
          row.id
        ]);
      } catch (redisErr: any) {
        console.warn(`[embeddings-loop] Failed to add embedding for tweet ${row.id} to Redis: ${redisErr.message}`);
      }

      successCount++;
      
      // Small delay to respect rate limits if using a live key
      if (apiKey) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (err: any) {
      console.warn(`[embeddings-loop] Failed to embed tweet ${row.id}: ${err.message}`);
      // Backoff if we hit a rate limit
      if (err.message.includes("429")) {
        console.warn("[embeddings-loop] Rate limit hit. Waiting 30s...");
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
  }

  return successCount;
}

async function main() {
  console.log("=== Starting Continuous Embeddings Indexing Loop ===");
  if (!apiKey) {
    console.warn("⚠️  GEMINI_API_KEY or GOOGLE_API_KEY is not set. Generating mock embeddings in offline mode.");
  } else {
    console.log(`Using live Gemini API model: ${model}`);
  }

  const store = new Store();
  initEmbeddingsTable(store);

  // Connect to Redis
  console.log("[embeddings-loop] Connecting to Redis...");
  try {
    await redis.connect();
    console.log("[embeddings-loop] Connected to Redis.");
    
    // Sync existing embeddings from SQLite to Redis on startup
    console.log("[embeddings-loop] Syncing existing embeddings from SQLite to Redis...");
    const existing = store.db.prepare(`
      SELECT tweet_id, embedding FROM tweet_embeddings
    `).all() as { tweet_id: string; embedding: Buffer }[];
    
    console.log(`[embeddings-loop] Found ${existing.length} existing embeddings in SQLite. Syncing to Redis...`);
    let syncedCount = 0;
    for (const row of existing) {
      try {
        await redis.send("VADD", [
          "tweet_embeddings",
          "FP32",
          row.embedding as any,
          row.tweet_id
        ]);
        syncedCount++;
      } catch (err: any) {
        console.warn(`[embeddings-loop] Failed to sync embedding for tweet ${row.tweet_id} to Redis: ${err.message}`);
      }
    }
    console.log(`[embeddings-loop] Sync complete. Pushed ${syncedCount}/${existing.length} embeddings to Redis.`);
  } catch (redisErr: any) {
    console.error(`[embeddings-loop] Failed to initialize Redis: ${redisErr.message}`);
    process.exit(1);
  }

  // Set up shutdown handlers
  let running = true;
  process.on("SIGINT", () => {
    console.log("\nShutdown signal received. Exiting loop...");
    running = false;
    store.close();
    try {
      redis.close();
    } catch {}
    process.exit(0);
  });

  while (running) {
    try {
      // Get current counts
      const totalTweets = (store.db.query("SELECT COUNT(*) as count FROM tweets").get() as any).count;
      const embeddedTweets = (store.db.query("SELECT COUNT(*) as count FROM tweet_embeddings").get() as any).count;
      
      console.log(`[embeddings-loop] Status: Embedded ${embeddedTweets}/${totalTweets} tweets.`);

      const processed = await indexBatch(store);
      
      if (processed === 0) {
        // No new tweets to process, wait 30 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 30000));
      } else {
        // Minor cooldown between batches
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (err: any) {
      console.error(`[embeddings-loop] Error in loop iteration: ${err.message}`);
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
  }
}

main().catch(console.error);
