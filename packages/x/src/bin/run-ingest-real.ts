// SPDX-License-Identifier: Apache-2.0
import { ingestBeybladeData } from "../db/ingest";
import { Store } from "../db/store";

async function main() {
  const filePath = "/home/ubuntu/.gemini/antigravity-cli/brain/915df5ef-84a3-4d37-a2c1-92f6e24b5e5c/scratch/beyblade_data.json";
  console.log(`Loading SQLite Store...`);
  const store = new Store(); // uses default path ~/.aphrody/x-store.sqlite
  
  console.log(`Starting ingestion of ${filePath}...`);
  try {
    const stats = await ingestBeybladeData(filePath, store);
    console.log(`Ingestion completed successfully!`);
    console.log(`- Tweets Ingested: ${stats.tweetsIngested}`);
    console.log(`- Users Ingested: ${stats.usersIngested}`);
    console.log(`- Communities Ingested: ${stats.communitiesIngested}`);
    
    const dbStats = store.stats();
    console.log(`Database Current Stats:`);
    console.log(`- Path: ${dbStats.path}`);
    console.log(`- Total Tweets: ${dbStats.tweets}`);
    console.log(`- Total Users: ${dbStats.users}`);
    console.log(`- Total Edges: ${dbStats.edges}`);
    console.log(`- Total Follows: ${dbStats.follows}`);
  } catch (err: any) {
    console.error(`Ingestion failed: ${err.message}`);
  } finally {
    store.close();
  }
}

main().catch(console.error);
