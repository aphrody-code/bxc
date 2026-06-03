// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { X_DISCOVERY_PAGES, X_DISCOVERY_UA } from "./x-surface";

const DISCOVERY_PAGES = [...X_DISCOVERY_PAGES];
const DISCOVERY_UA = X_DISCOVERY_UA;

export interface QueryIdSnapshot {
  fetched_at: number;
  ttl_secs: number;
  ids: Record<string, string>;
  bundles: string[];
}

export class QueryIdStore {
  private cachePath: string;
  private ttlSecs: number;
  private cachedSnapshot: QueryIdSnapshot | null = null;

  constructor(cachePath?: string, ttlSecs = 24 * 60 * 60) {
    this.cachePath = cachePath || this.defaultCachePath();
    this.ttlSecs = ttlSecs;
  }

  private defaultCachePath(): string {
    const home = homedir();
    return join(home, ".config", "aphrody", "x", "query-ids-cache.json");
  }

  public get(operation: string): string | undefined {
    const snap = this.snapshot();
    return snap?.ids[operation];
  }

  public snapshot(): QueryIdSnapshot | null {
    if (this.cachedSnapshot) {
      return this.cachedSnapshot;
    }
    if (existsSync(this.cachePath)) {
      try {
        const raw = readFileSync(this.cachePath, "utf-8");
        this.cachedSnapshot = JSON.parse(raw) as QueryIdSnapshot;
        return this.cachedSnapshot;
      } catch {
        return null;
      }
    }
    return null;
  }

  public isFresh(snap: QueryIdSnapshot): boolean {
    const age = Math.floor(Date.now() / 1000) - snap.fetched_at;
    return age >= 0 && age <= snap.ttl_secs;
  }

  public async refresh(targets: string[], force = false): Promise<QueryIdSnapshot> {
    const current = this.snapshot();
    if (!force && current && this.isFresh(current)) {
      // Check if all targets are already in the cache
      const hasAll = targets.every((t) => current.ids[t] !== undefined);
      if (hasAll) {
        return current;
      }
    }

    console.log(`Refreshing live X queryIds for operations: ${targets.join(", ")}...`);
    const bundleUrls = await this.discoverBundles();
    const discovered = await this.fetchAndExtract(bundleUrls, targets);

    if (Object.keys(discovered).length === 0) {
      if (current) {
        return current;
      }
      throw new Error("QueryId refresh found no operations. X.com layout may have changed.");
    }

    const ids: Record<string, string> = {};
    for (const name of targets) {
      if (discovered[name]) {
        ids[name] = discovered[name];
      }
    }

    const snapshot: QueryIdSnapshot = {
      fetched_at: Math.floor(Date.now() / 1000),
      ttl_secs: this.ttlSecs,
      ids,
      bundles: bundleUrls.map((u) => u.split("/").pop() || u),
    };

    // Save to disk
    try {
      const dir = join(this.cachePath, "..");
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(this.cachePath, JSON.stringify(snapshot, null, 2) + "\n");
    } catch (e: any) {
      console.error(`Failed to save queryId cache to disk: ${e.message}`);
    }

    this.cachedSnapshot = snapshot;
    return snapshot;
  }

  private async discoverBundles(): Promise<string[]> {
    const bundleRe = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;
    const bundles = new Set<string>();

    for (const page of DISCOVERY_PAGES) {
      try {
        const resp = await fetch(page, {
          headers: { "User-Agent": DISCOVERY_UA },
        });
        if (!resp.ok) continue;
        const html = await resp.text();
        const matches = html.matchAll(bundleRe);
        for (const m of matches) {
          bundles.add(m[0]);
        }
      } catch {
        // Suppress individual page discovery errors
      }
    }

    if (bundles.size === 0) {
      throw new Error("No client bundles discovered; x.com layout may have changed.");
    }
    return Array.from(bundles);
  }

  private async fetchAndExtract(bundleUrls: string[], targets: string[]): Promise<Record<string, string>> {
    const discovered: Record<string, string> = {};
    const targetSet = new Set(targets);

    // Fetch bundles concurrently in chunks of 5
    const chunkSize = 5;
    for (let i = 0; i < bundleUrls.length; i += chunkSize) {
      if (Object.keys(discovered).length === targetSet.size) {
        break;
      }
      const chunk = bundleUrls.slice(i, i + chunkSize);
      const promises = chunk.map((url) =>
        fetch(url, { headers: { "User-Agent": DISCOVERY_UA } })
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => "")
      );

      const results = await Promise.all(promises);
      for (const js of results) {
        if (!js) continue;
        this.extractOperations(js, targetSet, discovered);
      }
    }
    return discovered;
  }

  private extractOperations(js: string, targets: Set<string>, out: Record<string, string>): void {
    // Regex matches: {queryId:"AAA",operationName:"BBB"}
    const re1 = /\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/g;
    const re2 = /\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']/g;

    const matches1 = js.matchAll(re1);
    for (const m of matches1) {
      const qid = m[1];
      const op = m[2];
      if (targets.has(op) && !out[op] && this.validQueryId(qid)) {
        out[op] = qid;
      }
    }

    const matches2 = js.matchAll(re2);
    for (const m of matches2) {
      const op = m[1];
      const qid = m[2];
      if (targets.has(op) && !out[op] && this.validQueryId(qid)) {
        out[op] = qid;
      }
    }
  }

  private validQueryId(qid: string): boolean {
    return qid.length > 0 && /^[A-Za-z0-9_-]+$/.test(qid);
  }
}
