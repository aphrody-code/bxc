// SPDX-License-Identifier: Apache-2.0
import type { Store } from "../db/store";

export interface RagResult {
  query: string;
  answer: string;
  sources: {
    id: string;
    author_username: string;
    text: string;
    like_count: number;
    conversation_id?: string;
  }[];
}

export interface RagOptions {
  apiKey?: string;
  model?: string;
  limit?: number;
  offlineMock?: boolean;
}

export class BeybladeXRag {
  private apiKey: string | undefined;
  private model: string;
  private limit: number;
  private offlineMock: boolean;

  constructor(options: RagOptions = {}) {
    this.apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    this.model = options.model || "gemini-2.5-flash";
    this.limit = options.limit || 15;
    this.offlineMock = options.offlineMock ?? false;
  }

  private async getEmbedding(text: string): Promise<Buffer> {
    if (!this.apiKey || this.offlineMock) {
      const mock = Array.from({ length: 768 }, () => Math.random() - 0.5);
      const magnitude = Math.sqrt(mock.reduce((sum, val) => sum + val * val, 0));
      const norm = mock.map(val => val / magnitude);
      const floatArray = new Float32Array(norm);
      return Buffer.from(floatArray.buffer);
    }

    const modelName = "gemini-embedding-001";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${this.apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${modelName}`,
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
    const values = json.embedding.values as number[];
    const floatArray = new Float32Array(values);
    return Buffer.from(floatArray.buffer);
  }

  /**
   * Helper to parse user query into search keywords.
   * Uses simple keyword extraction fallback if offline or no API key.
   */
  public async extractKeywords(query: string): Promise<string[]> {
    if (!this.apiKey || this.offlineMock) {
      // Fallback: simple tokenization, removing short words and punctuation
      const clean = query.toLowerCase().replace(/[^\w\s#]/g, " ");
      const words = clean.split(/\s+/).filter(w => w.length > 3);
      return Array.from(new Set(words));
    }

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const prompt = `Extract exactly 3 to 5 search keywords (space-separated, no punctuation, keeping hashtags intact like #BeybladeX) representing the main search terms of the following question. Do not output anything else but the keywords.
Question: "${query}"`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!res.ok) {
        throw new Error(`Gemini API error: ${res.statusText}`);
      }

      const json = await res.json() as any;
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const keywords = text.trim().split(/\s+/).map((w: string) => w.replace(/[^\w#]/g, "")).filter(Boolean);
      return keywords.length > 0 ? keywords : [query];
    } catch {
      // Fallback
      return [query];
    }
  }

  /**
   * Query the RAG system to generate an answer based on crawled SQLite data.
   */
  public async query(query: string, store: Store): Promise<RagResult> {
    const seenIds = new Set<string>();
    const candidates: any[] = [];

    // 1. Fetch seed candidate tweets from Redis similarity search
    try {
      const queryVector = await this.getEmbedding(query);
      const { redis } = await import("bun");
      await redis.connect();
      
      const simRes = await redis.send("VSIM", [
        "tweet_embeddings",
        "FP32",
        queryVector as any,
        "COUNT",
        this.limit.toString(),
        "WITHSCORES"
      ]) as Record<string, number> | null;
      
      redis.close();

      if (simRes) {
        const sortedIds = Object.entries(simRes)
          .sort((a, b) => b[1] - a[1])
          .map(entry => entry[0]);

        for (const tweetId of sortedIds) {
          try {
            const tweet = store.db.prepare(`
              SELECT id, author_username, author_name, text, created_at, like_count, conversation_id
              FROM tweets WHERE id = ?
            `).get(tweetId) as any;

            if (tweet) {
              seenIds.add(tweet.id);
              candidates.push({
                id: tweet.id,
                author_username: tweet.author_username,
                author_name: tweet.author_name,
                text: tweet.text,
                created_at: tweet.created_at || undefined,
                like_count: Number(tweet.like_count),
                conversation_id: tweet.conversation_id || undefined
              });
            }
          } catch {}
        }
      }
    } catch (err: any) {
      console.warn(`[rag] Redis vector search failed: ${err.message}. Falling back to keyword search only.`);
    }

    // 2. Fallback / Hybrid search: FTS5 keyword matching from SQLite
    const keywords = await this.extractKeywords(query);
    for (const kw of keywords) {
      try {
        const matches = store.search(kw, this.limit);
        for (const m of matches) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            candidates.push(m);
          }
        }
      } catch (err: any) {
        console.warn(`Local search for keyword "${kw}" failed: ${err.message}`);
      }
    }

    // Sort by likes to prioritize high-engagement discussions
    candidates.sort((a, b) => b.like_count - a.like_count);
    const topSeeds = candidates.slice(0, this.limit);

    // 3. Graph expansion: retrieve entire conversation thread context for the top seeds
    const contextMap = new Map<string, any>();
    const threadIds = new Set<string>();

    for (const seed of topSeeds) {
      contextMap.set(seed.id, seed);
      
      // Get conversation_id if available to reconstruct thread
      try {
        const threadRow = store.db.prepare(`
          SELECT conversation_id FROM tweets WHERE id = ?
        `).get(seed.id) as { conversation_id: string | null } | undefined;

        if (threadRow?.conversation_id) {
          threadIds.add(threadRow.conversation_id);
        }
      } catch {}
    }

    // Fetch up to 10 additional tweets in the same conversation thread to provide thread context
    for (const threadId of threadIds) {
      try {
        const threadTweets = store.db.prepare(`
          SELECT id, author_username, author_name, text, created_at, like_count, conversation_id
          FROM tweets 
          WHERE conversation_id = ? 
          ORDER BY created_at ASC
          LIMIT 10
        `).all(threadId) as any[];

        for (const t of threadTweets) {
          if (!contextMap.has(t.id)) {
            contextMap.set(t.id, {
              id: t.id,
              author_username: t.author_username,
              author_name: t.author_name,
              text: t.text,
              created_at: t.created_at || undefined,
              like_count: Number(t.like_count),
              conversation_id: t.conversation_id || undefined
            });
          }
        }
      } catch {}
    }

    const finalContexts = Array.from(contextMap.values());

    // 4. Build context prompts
    const formattedContext = finalContexts
      .map(
        (c, idx) => `[Source ${idx + 1}]
User: @${c.author_username} (${c.author_name})
Likes: ${c.like_count}
Content: ${c.text}`
      )
      .join("\n\n-------------------\n\n");

    // 5. Generate content
    let answer = "";
    if (!this.apiKey || this.offlineMock) {
      // Mock Response for testing
      answer = `[Offline Mock Response]
Based on the retrieved context containing ${finalContexts.length} discussion nodes:
- Users discussed the Beyblade X meta, specifically focusing on parts like WizardRod and Ball bit.
- The highest engagement discussion belongs to @${topSeeds[0]?.author_username || "unknown"} with ${topSeeds[0]?.like_count || 0} likes.`;
    } else {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
        const prompt = `You are a professional Beyblade X analyst. Answer the user's question by synthesizing the discussion data collected from X.com (Twitter).
Provide a clear, cohesive answer citing the authors (e.g. [@username]) where appropriate.
If the context does not contain enough information to answer, state that clearly but provide a best-effort summary of what is available.

[CONTEXT]
${formattedContext || "No discussions found matching this query in the database."}

[USER QUESTION]
${query}`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });

        if (!res.ok) {
          throw new Error(`Gemini API error during RAG: ${res.statusText}`);
        }

        const json = await res.json() as any;
        answer = json.candidates?.[0]?.content?.parts?.[0]?.text || "No response received from Gemini.";
      } catch (err: any) {
        answer = `Error generating answer: ${err.message}`;
      }
    }

    return {
      query,
      answer,
      sources: finalContexts.map(c => ({
        id: c.id,
        author_username: c.author_username,
        text: c.text,
        like_count: c.like_count,
        conversation_id: c.conversation_id
      }))
    };
  }
}
