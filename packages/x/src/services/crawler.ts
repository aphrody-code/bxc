// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";
import { Store } from "../db/store";
import { walkTimelineTweets, walkTimelineUsers } from "../core/parse";
import { findAndUpsertUsers } from "../db/ingest";
import type { User } from "../core/schemas";


export interface CrawlerOptions {
  seedUsers?: string[];
  seedCommunities?: string[];
  seedHashtags?: string[];
  maxUsersToCrawl?: number;
  maxCommunitiesToCrawl?: number;
  maxHashtagsToCrawl?: number;
  delayMs?: number;
  crawlFollowers?: boolean;
}

export class Crawler {
  private client: XClient;
  private store: Store;
  private options: Required<CrawlerOptions>;

  // Queues
  private queueUsers = new Set<string>();
  private queueCommunities = new Set<string>();
  private queueHashtags = new Set<string>();

  // Visited
  private visitedUsers = new Set<string>();
  private visitedCommunities = new Set<string>();
  private visitedHashtags = new Set<string>();

  private running = false;

  constructor(client: XClient, store: Store, options: CrawlerOptions = {}) {
    this.client = client;
    this.store = store;
    this.options = {
      seedUsers: options.seedUsers || [],
      seedCommunities: options.seedCommunities || [],
      seedHashtags: options.seedHashtags || [],
      maxUsersToCrawl: options.maxUsersToCrawl || 1000,
      maxCommunitiesToCrawl: options.maxCommunitiesToCrawl || 500,
      maxHashtagsToCrawl: options.maxHashtagsToCrawl || 500,
      delayMs: options.delayMs || 5000,
      crawlFollowers: options.crawlFollowers || false,
    };

    this.initializeQueues();
  }

  /** Read existing data from database to populate visited sets and avoid duplicates */
  private initializeQueues(): void {
    // Populate visited users from DB
    try {
      const dbUsers = this.store.db.query("SELECT username FROM users").all() as { username: string }[];
      for (const u of dbUsers) {
        if (u.username) {
          this.visitedUsers.add(u.username.toLowerCase());
        }
      }
    } catch {
      // Table might not exist or be empty
    }

    // Populate visited communities from DB (extracted from community edges)
    try {
      const dbComms = this.store.db.query(
        "SELECT DISTINCT account FROM edges WHERE kind = 'timeline' AND account LIKE 'community_%'"
      ).all() as { account: string }[];
      for (const c of dbComms) {
        const id = c.account.replace(/^community_/, "");
        if (id) {
          this.visitedCommunities.add(id);
        }
      }
    } catch {
      // Table might not exist
    }

    // Load seeds
    for (const u of this.options.seedUsers) {
      const cleaned = u.replace(/^@/, "").toLowerCase();
      if (!this.visitedUsers.has(cleaned)) {
        this.queueUsers.add(cleaned);
      }
    }
    for (const c of this.options.seedCommunities) {
      if (!this.visitedCommunities.has(c)) {
        this.queueCommunities.add(c);
      }
    }
    for (const h of this.options.seedHashtags) {
      const cleaned = h.toLowerCase();
      this.queueHashtags.add(cleaned);
    }
  }

  /** Clean up handle names */
  private cleanHandle(username: string): string {
    return username.trim().toLowerCase().replace(/^@/, "");
  }

  /** Regex extract hashtags and mentions from text to discover new targets */
  private extractMentionsAndHashtags(text: string): { hashtags: string[]; mentions: string[] } {
    const hashtags: string[] = [];
    const mentions: string[] = [];

    // Hashtags
    const hashRegex = /#\w+/g;
    let match;
    while ((match = hashRegex.exec(text)) !== null) {
      hashtags.push(match[0].toLowerCase());
    }

    // Mentions
    const mentionRegex = /@(\w+)/g;
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1].toLowerCase());
    }

    return { hashtags, mentions };
  }

  /** Run the crawler continuously */
  public async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    if (process.env.APHRODY_X_DEBUG) {
      console.log("[crawler] Starting autonomous crawling loop...");
    }

    while (this.running) {
      try {
        const didWork = await this.step();
        if (!didWork) {
          if (process.env.APHRODY_X_DEBUG) {
            console.log("[crawler] All queues are empty. Waiting for new seeds or scheduled cron...");
          }
          // Idle wait
          await new Promise((resolve) => setTimeout(resolve, 30000));
        } else {
          // Politeness delay between requests
          await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
        }
      } catch (err: any) {
        console.error(`[crawler] Error in crawl step: ${err.message}`);
        // Backoff on error
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }
  }

  /** Stop the running crawler */
  public stop(): void {
    this.running = false;
    if (process.env.APHRODY_X_DEBUG) {
      console.log("[crawler] Stopping autonomous crawling loop...");
    }
  }

  /** Perform a single crawl task from the queues */
  public async step(): Promise<boolean> {
    // 1. Process community queue first
    if (this.queueCommunities.size > 0 && this.visitedCommunities.size < this.options.maxCommunitiesToCrawl) {
      const commId = this.queueCommunities.values().next().value!;
      this.queueCommunities.delete(commId);
      this.visitedCommunities.add(commId);

      if (process.env.APHRODY_X_DEBUG) {
        console.log(`[crawler] Crawling Community: ${commId}`);
      }

      try {
        const res = await this.client.graphqlWaiting("CommunityTweetsTimeline", {
          communityId: commId,
          count: 40,
        });

        if (res) {
          const page = walkTimelineTweets(res);
          for (const t of page.tweets) {
            this.store.upsertTweet(t);
            this.store.addEdge(t.author.username, "authored", t.id);
            this.store.addEdge(`community_${commId}`, "timeline", t.id);

            // Queue the author recursively
            const cleanedAuthor = this.cleanHandle(t.author.username);
            if (cleanedAuthor && !this.visitedUsers.has(cleanedAuthor)) {
              this.queueUsers.add(cleanedAuthor);
            }

            // Feed new items to search queues
            const { hashtags, mentions } = this.extractMentionsAndHashtags(t.text);
            for (const h of hashtags) {
              if (!this.visitedHashtags.has(h)) this.queueHashtags.add(h);
            }
            for (const m of mentions) {
              const cleaned = this.cleanHandle(m);
              if (!this.visitedUsers.has(cleaned)) this.queueUsers.add(cleaned);
            }
          }

          // Recursively find and upsert all users in response
          findAndUpsertUsers(res, this.store);

          // Queue explicit timeline users too
          const userPage = walkTimelineUsers(res);
          for (const u of userPage.users) {
            const cleaned = this.cleanHandle(u.username);
            if (!this.visitedUsers.has(cleaned)) {
              this.queueUsers.add(cleaned);
            }
          }
        }
      } catch (err: any) {
        console.error(`[crawler] Failed community ${commId}: ${err.message}`);
      }
      return true;
    }

    // 2. Process user queue
    if (this.queueUsers.size > 0 && this.visitedUsers.size < this.options.maxUsersToCrawl) {
      const username = this.queueUsers.values().next().value!;
      this.queueUsers.delete(username);
      this.visitedUsers.add(username);

      if (process.env.APHRODY_X_DEBUG) {
        console.log(`[crawler] Crawling User: ${username}`);
      }

      try {
        // Resolve profile/ID
        const profile = await this.client.userByScreenName(username);
        if (profile.id) {
          const userObj: User = {
            id: profile.id,
            username: profile.screen_name,
            name: profile.name,
            followers_count: profile.followers_count,
            following_count: profile.friends_count,
          };
          this.store.upsertUser(userObj);

          // Get recent tweets
          const tweetsPage = await this.client.userTweets(profile.id, 40);
          for (const t of tweetsPage.tweets) {
            this.store.upsertTweet(t);
            this.store.addEdge(profile.screen_name, "authored", t.id);

            const { hashtags, mentions } = this.extractMentionsAndHashtags(t.text);
            for (const h of hashtags) {
              if (!this.visitedHashtags.has(h)) this.queueHashtags.add(h);
            }
            for (const m of mentions) {
              const cleaned = this.cleanHandle(m);
              if (!this.visitedUsers.has(cleaned)) this.queueUsers.add(cleaned);
            }
          }

          // Optionally crawl followers/following relationships
          if (this.options.crawlFollowers) {
            try {
              const followingPage = await this.client.following(profile.id, 20);
              for (const u of followingPage.users) {
                this.store.upsertUser(u);
                this.store.addFollow(profile.screen_name, "following", u);
                const cleaned = this.cleanHandle(u.username);
                if (!this.visitedUsers.has(cleaned)) this.queueUsers.add(cleaned);
              }
            } catch (err: any) {
              console.warn(`[crawler] Failed following crawl for ${username}: ${err.message}`);
            }
          }
        }
      } catch (err: any) {
        console.error(`[crawler] Failed user ${username}: ${err.message}`);
      }
      return true;
    }

    // 3. Process hashtag/query queue
    if (this.queueHashtags.size > 0 && this.visitedHashtags.size < this.options.maxHashtagsToCrawl) {
      const hashtag = this.queueHashtags.values().next().value!;
      this.queueHashtags.delete(hashtag);
      this.visitedHashtags.add(hashtag);

      if (process.env.APHRODY_X_DEBUG) {
        console.log(`[crawler] Crawling Hashtag/Query: ${hashtag}`);
      }

      try {
        const searchPage = await this.client.search(hashtag, 40);
        for (const t of searchPage.tweets) {
          this.store.upsertTweet(t);
          this.store.addEdge(t.author.username, "authored", t.id);

          // Queue the author recursively
          const cleanedAuthor = this.cleanHandle(t.author.username);
          if (cleanedAuthor && !this.visitedUsers.has(cleanedAuthor)) {
            this.queueUsers.add(cleanedAuthor);
          }

          const { hashtags, mentions } = this.extractMentionsAndHashtags(t.text);
          for (const h of hashtags) {
            if (!this.visitedHashtags.has(h)) this.queueHashtags.add(h);
          }
          for (const m of mentions) {
            const cleaned = this.cleanHandle(m);
            if (!this.visitedUsers.has(cleaned)) this.queueUsers.add(cleaned);
          }
        }
      } catch (err: any) {
        console.error(`[crawler] Failed search ${hashtag}: ${err.message}`);
      }
      return true;
    }

    return false;
  }

  // Getters for status monitoring
  public getStats() {
    return {
      queueUsers: this.queueUsers.size,
      queueCommunities: this.queueCommunities.size,
      queueHashtags: this.queueHashtags.size,
      visitedUsers: this.visitedUsers.size,
      visitedCommunities: this.visitedCommunities.size,
      visitedHashtags: this.visitedHashtags.size,
    };
  }
}
