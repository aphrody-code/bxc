// SPDX-License-Identifier: Apache-2.0
import { XClient } from "../core/client";
import { Store } from "../db/store";

export interface SyncOptions {
  cronExpression?: string;
  onSyncComplete?: (stats: { newTweets: number; timestamp: number }) => void;
  syncHome?: boolean;
  syncBookmarks?: boolean;
}

/** Schedule a periodic background sync of X data into the local store using Bun.cron. */
export function startSyncCron(
  client: XClient,
  store: Store,
  options: SyncOptions = {}
) {
  const cronExpr = options.cronExpression || "*/15 * * * *"; // every 15 minutes default
  const handle = client.session?.handle || "viewer";

  return Bun.cron(
    {
      name: `x-sync-${handle}`,
      cron: cronExpr,
    } as any,
    async () => {
      if (process.env.APHRODY_X_DEBUG) {
        console.log(`[cron-sync] Starting sync at ${new Date().toISOString()}`);
      }

      try {
        let newTweets = 0;

        // Sync Home Timeline
        if (options.syncHome !== false) {
          try {
            const page = await client.home(40);
            for (const t of page.tweets) {
              store.upsertTweet(t);
              store.addEdge(handle, "timeline", t.id);
              newTweets++;
            }
          } catch (e: any) {
            console.error(`[cron-sync] Failed to sync home timeline: ${e.message}`);
          }
        }

        // Sync Bookmarks
        if (options.syncBookmarks) {
          try {
            const page = await client.bookmarks(40);
            for (const t of page.tweets) {
              store.upsertTweet(t);
              store.addEdge(handle, "bookmarked", t.id);
              newTweets++;
            }
          } catch (e: any) {
            console.error(`[cron-sync] Failed to sync bookmarks: ${e.message}`);
          }
        }

        if (options.onSyncComplete) {
          options.onSyncComplete({ newTweets, timestamp: Date.now() });
        }
      } catch (err: any) {
        console.error(`[cron-sync] Error during sync loop execution: ${err.message}`);
      }
    }
  );
}
export type CronInstance = ReturnType<typeof Bun.cron>;
