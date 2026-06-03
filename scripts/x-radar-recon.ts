#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * x-radar-recon — recon https://x.com/i/radar/new (bxc + GraphQL probe).
 *
 *   bun run scripts/x-radar-recon.ts
 *   bun run scripts/x-radar-recon.ts --out ~/yoyo/data/radar-recon
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  XClient,
  XSession,
  RADAR_NEW_URL,
  RADAR_ROUTES,
  RADAR_GRAPHQL_OPS,
  probeRadarAccess,
  radarMetrics,
  radarExplore,
  runXSurfaceRecon,
} from "@aphrody/x";

function parseArgv(argv: string[]): { outDir: string } {
  let outDir = join(homedir(), "yoyo", "data", "radar-recon");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") outDir = argv[++i] ?? outDir;
    else if (argv[i] === "-h" || argv[i] === "--help") {
      console.log("x-radar-recon — bxc recon + authenticated Radar GraphQL probe\n  --out <dir>");
      process.exit(0);
    }
  }
  return { outDir };
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv.slice(2));
  mkdirSync(opts.outDir, { recursive: true });

  console.error("[recon] bxc max on Radar URLs …");
  const recon = await runXSurfaceRecon("max", [RADAR_NEW_URL, "https://x.com/i/radar"]);
  writeFileSync(join(opts.outDir, "recon.json"), JSON.stringify(recon, null, 2));

  const session = XSession.loadOrEnv();
  const client = new XClient(session);
  const account = session.handle ?? (await client.whoami()).screen_name;

  console.error("[probe] Radar API access …");
  const probe = await probeRadarAccess(client);
  writeFileSync(join(opts.outDir, "probe.json"), JSON.stringify(probe, null, 2));

  console.error("[metrics] sample search …");
  const sample = await radarMetrics(client, "psg min_faves:50", 2);
  writeFileSync(join(opts.outDir, "sample-metrics.json"), JSON.stringify(sample, null, 2));

  console.error("[explore] ExplorePage …");
  const explore = await radarExplore(client);
  writeFileSync(join(opts.outDir, "explore.json"), JSON.stringify(explore, null, 2));

  const report = {
    generated_at: new Date().toISOString(),
    account,
    surface: RADAR_NEW_URL,
    routes: RADAR_ROUTES,
    graphql_ops: RADAR_GRAPHQL_OPS,
    probe,
    note: "No public Radar* GraphQL op in 2026 bundles; UI uses SearchTimeline querySource=radar.",
  };
  writeFileSync(join(opts.outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});