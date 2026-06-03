// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";
import { allOperations, getOperation } from "../config/catalog";
import { PREMIUM_GRAPHQL_OPS, X_SDK_COVERAGE } from "../config/x-surface";
import { fetchLiveQueryIds } from "../tools/bundle-catalog";
import { fetchAllPremiumGraphql } from "./premium";

export interface CoverageReport {
  generated_at: string;
  catalog: { total: number; queries: number; mutations: number };
  sdk_surface: readonly string[];
  premium_ops: readonly string[];
  query_id_cache?: { live_bundle_ops: number; stale_vs_catalog: string[] };
  premium_fetch?: Record<string, { ok: boolean }>;
}

/** Compare embedded catalog vs live bundle + optional live Premium probe. */
export async function buildCoverageReport(
  client?: XClient,
  opts?: { probePremium?: boolean; checkQueryIds?: boolean },
): Promise<CoverageReport> {
  const ops = allOperations();
  const report: CoverageReport = {
    generated_at: new Date().toISOString(),
    catalog: {
      total: ops.length,
      queries: ops.filter((o) => o.operationType === "query").length,
      mutations: ops.filter((o) => o.operationType === "mutation").length,
    },
    sdk_surface: X_SDK_COVERAGE,
    premium_ops: PREMIUM_GRAPHQL_OPS,
  };

  if (opts?.checkQueryIds !== false) {
    try {
      const { ids } = await fetchLiveQueryIds(ops.map((o) => o.name));
      const stale: string[] = [];
      for (const op of ops) {
        const live = ids[op.name];
        if (live && live !== op.queryId) stale.push(op.name);
      }
      report.query_id_cache = {
        live_bundle_ops: Object.keys(ids).length,
        stale_vs_catalog: stale,
      };
    } catch {
      /* network optional */
    }
  }

  if (opts?.probePremium && client) {
    const me = await client.whoami();
    const raw = await fetchAllPremiumGraphql(client, me.screen_name, me.id);
    report.premium_fetch = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, { ok: v.ok }]),
    );
  }

  return report;
}

/** Resolve queryId: runtime cache → catalog (documents resolution order). */
export function resolveOperationQueryId(
  opName: string,
  runtimeId?: string,
): string | undefined {
  return runtimeId ?? getOperation(opName)?.queryId;
}