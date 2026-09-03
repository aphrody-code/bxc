// SPDX-License-Identifier: Apache-2.0
import { XSession } from "../core/session";
import { XClient } from "../core/client";
import { Store } from "../db/store";
import { Crawler } from "../services/crawler";

async function main() {
  console.log(`Loading session credentials...`);
  let session: XSession;
  try {
    session = XSession.load();
    console.log(`Session loaded for handle: @${session.handle || "unknown"}`);
  } catch (err: any) {
    console.error(`Failed to load session: ${err.message}`);
    process.exit(1);
  }

  const store = new Store(); // uses default path ~/.aphrody/x-store.sqlite
  const client = new XClient(session);

  console.log(`Resolving client whoami...`);
  try {
    const user = await client.whoami();
    console.log(`Authenticated as @${user.screen_name} (ID: ${user.id})`);
  } catch (err: any) {
    console.error(`Failed to authenticate client: ${err.message}`);
    store.close();
    process.exit(1);
  }

  // Seed targets
  const seedCommunities = ["1809671339109658814"];
  const seedUsers = [
    "rpb_ey", 
    "beyblade_info", 
    "takaratomytoys",
    "beybladegeeks",
    "zankye",
    "ilinnuc",
    "hasbropulse"
  ];
  const seedHashtags = [
    "#BeybladeX", 
    "#beyblade", 
    "#ベイブレードX", 
    "#ベイブレード",
    "#BeybladeXUS",
    "#BeybladeBurst",
    "#BeybladeAnime"
  ];

  console.log(`Initializing autonomous crawler...`);
  const crawler = new Crawler(client, store, {
    seedCommunities,
    seedUsers,
    seedHashtags,
    delayMs: 1500,
    maxUsersToCrawl: 100000,
    maxCommunitiesToCrawl: 10000,
    maxHashtagsToCrawl: 100000,
    crawlFollowers: true,
  });

  // Set up exit handlers
  process.on("SIGINT", () => {
    console.log("\nShutdown signal received. Stopping crawler...");
    crawler.stop();
    store.close();
    process.exit(0);
  });

  console.log(`Autonomous Crawler started.`);
  console.log(`Seeds:`);
  console.log(`- Communities: ${seedCommunities.join(", ")}`);
  console.log(`- Users: ${seedUsers.join(", ")}`);
  console.log(`- Hashtags: ${seedHashtags.join(", ")}`);
  console.log(`Running crawl loop... Press Ctrl+C to stop.`);

  // Print stats periodically
  const statsTimer = setInterval(() => {
    const crawlerStats = crawler.getStats();
    const dbStats = store.stats();
    console.log(`\n[crawler-progress] ${new Date().toISOString()}`);
    console.log(`Queues: Users=${crawlerStats.queueUsers}, Comms=${crawlerStats.queueCommunities}, Hashtags=${crawlerStats.queueHashtags}`);
    console.log(`Visited: Users=${crawlerStats.visitedUsers}, Comms=${crawlerStats.visitedCommunities}, Hashtags=${crawlerStats.visitedHashtags}`);
    console.log(`Database: Tweets=${dbStats.tweets}, Users=${dbStats.users}, Edges=${dbStats.edges}`);
  }, 30000);

  try {
    await crawler.start();
  } catch (err: any) {
    console.error(`Crawl loop exited with error: ${err.message}`);
  } finally {
    clearInterval(statsTimer);
    store.close();
  }
}

main().catch(console.error);
