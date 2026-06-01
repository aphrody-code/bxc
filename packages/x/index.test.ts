// SPDX-License-Identifier: Apache-2.0
import { expect, test, describe } from "bun:test";
import { XSession } from "./src/core/session";
import { XClient } from "./src/core/client";
import { getOperation, allOperations } from "./src/config/catalog";
import { featuresFor } from "./src/core/features";
import { parsePostCount } from "./src/services/news";
import { Store, edge } from "./src/db/store";
import { parseArchiveArray, archiveTweetToTweet } from "./src/db/archive";

describe("X Client Unit Tests", () => {
  test("catalog resolves operations", () => {
    const op = getOperation("Viewer");
    expect(op).toBeDefined();
    expect(op?.name).toBe("Viewer");
    expect(op?.operationType).toBe("query");

    const all = allOperations();
    expect(all.length).toBeGreaterThan(100);
  });

  test("feature flag lookup", () => {
    const op = getOperation("CreateTweet");
    expect(op).toBeDefined();
    const feat = featuresFor(op!);
    expect(feat).toBeDefined();
    expect(feat.responsive_web_graphql_timeline_navigation_enabled).toBe(true);
  });

  test("post count parsing", () => {
    expect(parsePostCount("12.3K posts")).toBe(12300);
    expect(parsePostCount("5M posts")).toBe(5000000);
    expect(parsePostCount("42 posts")).toBe(42);
    expect(parsePostCount("no number here")).toBeNull();
  });

  test("session string parsing", () => {
    const cookieStr = "auth_token=abc123xyz; ct0=csrf456tuv";
    const session = XSession.fromCookieString(cookieStr);
    expect(session.auth_token).toBe("abc123xyz");
    expect(session.ct0).toBe("csrf456tuv");
  });

  test("SQLite store operations", () => {
    const store = new Store(":memory:");
    const sampleTweet = {
      id: "999888",
      text: "hello bun and sqlite database",
      author: { username: "aphrody_code", name: "Aphrody" },
      reply_count: 1,
      retweet_count: 2,
      like_count: 5,
      quote_count: 0,
      is_note_tweet: false,
    };

    store.upsertTweet(sampleTweet);
    store.addEdge("viewer", edge.AUTHORED, sampleTweet.id);

    const stats = store.stats();
    expect(stats.tweets).toBe(1);
    expect(stats.edges).toBe(1);

    const results = store.search("sqlite", 5);
    expect(results.length).toBe(1);
    expect(results[0].id).toBe("999888");
    expect(results[0].author_username).toBe("aphrody_code");
    expect(results[0].like_count).toBe(5);

    const digest = store.digest(5);
    expect(digest.top_authors[0][0]).toBe("aphrody_code");
    expect(digest.top_tweets[0].id).toBe("999888");

    store.close();
  });

  test("archive parsing and conversion", () => {
    const raw = `window.YTD.tweets.part0 = [
      { "tweet" : { "id_str": "12345", "full_text": "hello archive", "favorite_count": "12", "created_at": "Wed May 22 10:00:00 +0000 2026" } }
    ]`;
    const arr = parseArchiveArray(raw);
    expect(arr.length).toBe(1);

    const owner = { username: "viewer", name: "Viewer" };
    const tweet = archiveTweetToTweet(arr[0], owner);
    expect(tweet).not.toBeNull();
    expect(tweet?.id).toBe("12345");
    expect(tweet?.text).toBe("hello archive");
    expect(tweet?.like_count).toBe(12);
    expect(tweet?.author.username).toBe("viewer");
  });

  test("ingestBeybladeData and Crawler validation", async () => {
    const store = new Store(":memory:");
    
    // Create a temporary mock file for testing ingest
    const mockDataPath = "/tmp/mock_beyblade_data.json";
    const mockData = {
      metadata: { created_at: "2026-05-29T00:00:00Z" },
      users: {
        takaratomytoys: {
          id: "145144333",
          name: "タカラトミー",
          screen_name: "takaratomytoys",
          followers_count: 444946,
          friends_count: 1214
        }
      },
      tweets: {
        "2054521752789672031": {
          id: "2054521752789672031",
          text: "RPB NEWS 4 ⭐️ #BeybladeX",
          created_at: "Wed May 13 11:18:51 +0000 2026",
          like_count: 21,
          retweet_count: 9,
          reply_count: 1,
          lang: "lv",
          author: "rpb_ey",
          source: "user_timeline"
        }
      },
      communities: {
        "1809671339109658814": {
          id: "1809671339109658814",
          raw_response: {
            data: {
              communityResults: {
                result: {
                  __typename: "Community",
                  ranked_community_timeline: {
                    timeline: {
                      instructions: [
                        {
                          type: "TimelineAddEntries",
                          entries: [
                            {
                              content: {
                                entryType: "TimelineTimelineItem",
                                itemContent: {
                                  __typename: "TimelineTweet",
                                  tweet_results: {
                                    result: {
                                      __typename: "Tweet",
                                      rest_id: "2060047525457916400",
                                      core: {
                                        user_results: {
                                          result: {
                                            __typename: "User",
                                            rest_id: "2005828960802988035",
                                            core: {
                                              name: "RPB",
                                              screen_name: "rpb_ey"
                                            }
                                          }
                                        }
                                      },
                                      legacy: {
                                        full_text: "Merci d'avoir participé !",
                                        created_at: "Thu May 28 17:16:18 +0000 2026",
                                        favorite_count: 10
                                      }
                                    }
                                  }
                                }
                              }
                            }
                          ]
                        }
                      ]
                    }
                  }
                }
              }
            }
          }
        }
      }
    };

    await Bun.write(mockDataPath, JSON.stringify(mockData));

    // Test Ingest
    const { ingestBeybladeData } = await import("./src/db/ingest");
    const stats = await ingestBeybladeData(mockDataPath, store);

    expect(stats.tweetsIngested).toBeGreaterThanOrEqual(2);
    expect(stats.usersIngested).toBeGreaterThanOrEqual(2);
    expect(stats.communitiesIngested).toBe(1);

    const dbStats = store.stats();
    expect(dbStats.tweets).toBeGreaterThanOrEqual(2);
    expect(dbStats.users).toBeGreaterThanOrEqual(2);

    // Test Crawler Initialization and Visited Sets logic
    const { Crawler } = await import("./src/services/crawler");
    const { XSession } = await import("./src/core/session");
    const { XClient } = await import("./src/core/client");

    const session = new XSession({ auth_token: "token", ct0: "csrf" });
    const client = new XClient(session);
    const crawler = new Crawler(client, store, {
      seedUsers: ["rpb_ey"],
      seedCommunities: ["1809671339109658814"],
      seedHashtags: ["#BeybladeX"]
    });

    const cStats = crawler.getStats();
    // Visited users list should have rpb_ey from ingest
    expect(cStats.visitedCommunities).toBeGreaterThanOrEqual(1);

    store.close();
  });

  test("BeybladeXRag pipeline query validation", async () => {
    const { Store } = await import("./src/db/store");
    const { BeybladeXRag } = await import("./src/services/rag");
    const tempDb = new Store(":memory:");

    // Ingest some dummy test data
    const dummyTweet = {
      id: "12345",
      text: "WizardRod 9-60 Ball is the absolute best stamina combo in Beyblade X!",
      author: { id: "user1", username: "meta_master", name: "Meta Master" },
      created_at: "2026-05-29T00:00:00Z",
      like_count: 50,
      retweet_count: 5,
      reply_count: 2,
      quote_count: 0
    } as any;
    tempDb.upsertTweet(dummyTweet);
    tempDb.addEdge("meta_master", "authored", "12345");

    const rag = new BeybladeXRag({ offlineMock: true });
    const result = await rag.query("What is the best combo for WizardRod?", tempDb);

    expect(result.query).toBe("What is the best combo for WizardRod?");
    expect(result.sources.length).toBe(1);
    expect(result.sources[0].author_username).toBe("meta_master");
    expect(result.answer).toContain("meta_master");
    expect(result.answer).toContain("WizardRod");

    tempDb.close();
  });
});

describe("X Client Integration Tests", () => {
  test("whoami & getNews integration", async () => {
    let session: XSession;
    try {
      session = XSession.load();
    } catch {
      console.warn("Skipping live integration tests: no session file found.");
      return;
    }

    const client = new XClient(session);
    console.log("Session loaded successfully. Resolving whoami...");

    try {
      const user = await client.whoami();
      console.log(`Successfully authenticated as @${user.screen_name} (ID: ${user.id})`);
      expect(user.id).toBeDefined();
      expect(user.screen_name).toBeDefined();
      expect(user.name).toBeDefined();

      console.log("Fetching news from Explore tabs...");
      const news = await client.getNews(5);
      console.log(`Fetched ${news.length} news items:`);
      for (const item of news) {
        console.log(`- [${item.category}] ${item.headline} (${item.post_count ?? 0} posts)`);
      }
      expect(news.length).toBeGreaterThanOrEqual(0);
    } catch (err: any) {
      console.error("Live integration test failed:", err.message);
      throw err;
    }
  });
});
