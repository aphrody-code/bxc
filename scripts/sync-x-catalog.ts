#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/** Sync x-graphql-catalog.json from live X bundles (TS + Rust paths). */
import { join } from "node:path";
import { syncCatalogFromBundles } from "../packages/x/src/tools/bundle-catalog.ts";

const rustCatalog = join(
  import.meta.dir,
  "../rust-bridge/crates/x-client/data/x-graphql-catalog.json",
);

const report = await syncCatalogFromBundles({ rustCatalogPath: rustCatalog });
console.log(JSON.stringify(report, null, 2));