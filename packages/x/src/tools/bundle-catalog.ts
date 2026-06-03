// SPDX-License-Identifier: Apache-2.0
/** Extract GraphQL operation descriptors from X responsive-web bundles (bxc-aligned). */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { X_DISCOVERY_PAGES, X_DISCOVERY_UA } from "../config/x-surface";

export interface BundleOperation {
  queryId: string;
  operationName: string;
  operationType: "query" | "mutation" | "subscription";
}

export interface CatalogFile {
  extracted_from?: string;
  operation_count?: number;
  operations: Record<
    string,
    { queryId: string; operationType: string; featureSwitches: string[] }
  >;
}

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_CATALOG_PATH = join(PACKAGE_ROOT, "config/x-graphql-catalog.json");

const BUNDLE_RE =
  /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/[A-Za-z0-9.-]+\.js/g;

const PATTERNS: Array<{ re: RegExp; op: number; qid: number }> = [
  {
    re: /\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/g,
    qid: 1,
    op: 2,
  },
  {
    re: /\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']/g,
    op: 1,
    qid: 2,
  },
];

function validQueryId(qid: string): boolean {
  return qid.length > 0 && /^[A-Za-z0-9_-]+$/.test(qid);
}

/** Discover client-web bundle URLs from public X pages (same pages as QueryIdStore). */
export async function discoverBundleUrls(
  extraPages: string[] = [],
): Promise<string[]> {
  const bundles = new Set<string>();
  for (const page of [...X_DISCOVERY_PAGES, ...extraPages]) {
    try {
      const resp = await fetch(page, { headers: { "User-Agent": X_DISCOVERY_UA } });
      if (!resp.ok) continue;
      const html = await resp.text();
      for (const m of html.matchAll(BUNDLE_RE)) bundles.add(m[0]);
    } catch {
      /* skip */
    }
  }
  if (bundles.size === 0) {
    throw new Error("No X client bundles discovered; layout may have changed.");
  }
  return [...bundles];
}

/** Parse all `{queryId, operationName}` pairs from bundle JS. */
export function extractAllOperationsFromJs(js: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const { re, op, qid } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of js.matchAll(re)) {
      const operationName = m[op];
      const queryId = m[qid];
      if (operationName && queryId && validQueryId(queryId) && !out.has(operationName)) {
        out.set(operationName, queryId);
      }
    }
  }
  return out;
}

/** Fetch bundles and return merged operation → queryId map. */
export async function fetchLiveQueryIds(
  targets?: string[],
): Promise<{ ids: Record<string, string>; bundles: string[] }> {
  const bundleUrls = await discoverBundleUrls();
  const targetSet = targets ? new Set(targets) : null;
  const ids: Record<string, string> = {};

  const chunk = 6;
  for (let i = 0; i < bundleUrls.length; i += chunk) {
    if (targetSet && Object.keys(ids).length >= targetSet.size) break;
    const part = bundleUrls.slice(i, i + chunk);
    const texts = await Promise.all(
      part.map((url) =>
        fetch(url, { headers: { "User-Agent": X_DISCOVERY_UA } })
          .then((r) => (r.ok ? r.text() : ""))
          .catch(() => ""),
      ),
    );
    for (const js of texts) {
      if (!js) continue;
      for (const [op, qid] of extractAllOperationsFromJs(js)) {
        if (targetSet && !targetSet.has(op)) continue;
        if (!ids[op]) ids[op] = qid;
      }
    }
  }
  return {
    ids,
    bundles: bundleUrls.map((u) => u.split("/").pop() ?? u),
  };
}

/** Merge live queryIds into on-disk catalog; preserve featureSwitches. */
export function mergeCatalogQueryIds(
  catalog: CatalogFile,
  liveIds: Record<string, string>,
  sourceBundle?: string,
): { updated: number; stale: string[]; missing_in_bundle: string[] } {
  let updated = 0;
  const stale: string[] = [];
  const missing: string[] = [];

  for (const [name, op] of Object.entries(catalog.operations)) {
    const live = liveIds[name];
    if (!live) {
      missing.push(name);
      continue;
    }
    if (op.queryId !== live) {
      stale.push(name);
      op.queryId = live;
      updated++;
    }
  }

  catalog.extracted_from = sourceBundle ?? catalog.extracted_from ?? "live-bundle-sync";
  catalog.operation_count = Object.keys(catalog.operations).length;
  return { updated, stale, missing_in_bundle: missing };
}

export function loadCatalog(path = DEFAULT_CATALOG_PATH): CatalogFile {
  return JSON.parse(readFileSync(path, "utf-8")) as CatalogFile;
}

export function saveCatalog(catalog: CatalogFile, path = DEFAULT_CATALOG_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(catalog, null, 1)}\n`);
}

/** Full sync: scrape bundles → update catalog JSON (+ optional rust mirror path). */
export async function syncCatalogFromBundles(opts?: {
  catalogPath?: string;
  rustCatalogPath?: string;
}): Promise<Record<string, unknown>> {
  const catalogPath = opts?.catalogPath ?? DEFAULT_CATALOG_PATH;
  const { ids, bundles } = await fetchLiveQueryIds();
  const catalog = loadCatalog(catalogPath);
  const mainBundle = bundles.find((b) => b.startsWith("main.")) ?? bundles[0];
  const merge = mergeCatalogQueryIds(catalog, ids, `main.${mainBundle}`);
  saveCatalog(catalog, catalogPath);

  if (opts?.rustCatalogPath && existsSync(dirname(opts.rustCatalogPath))) {
    saveCatalog(catalog, opts.rustCatalogPath);
  }

  return {
    catalog_path: catalogPath,
    bundle_count: bundles.length,
    live_ops: Object.keys(ids).length,
    catalog_ops: catalog.operation_count,
    query_ids_updated: merge.updated,
    stale_ops: merge.stale,
    missing_in_live_bundle: merge.missing_in_bundle,
  };
}