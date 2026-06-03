// SPDX-License-Identifier: Apache-2.0
/**
 * bxc CLI integration — runs `bxc recon` (profile `max` recommended for X SPA).
 */

import { X_RECON_URLS } from "../config/x-surface";

export type BxcReconProfile = "static" | "fast" | "http" | "stealth" | "max";

export interface ReconSummary {
  url: string;
  finalUrl?: string;
  httpStatus?: number;
  profile?: string;
  cdn?: string;
  error?: string;
  raw?: unknown;
}

export interface XSurfaceReconReport {
  generated_at: string;
  profile: BxcReconProfile;
  results: Record<string, ReconSummary>;
}

/** Invoke global `bxc recon` per URL (best: profile `max` for x.com SPA). */
export async function runXSurfaceRecon(
  profile: BxcReconProfile = "max",
  urls: readonly string[] = X_RECON_URLS,
): Promise<XSurfaceReconReport> {
  const results: XSurfaceReconReport["results"] = {};

  for (const url of urls) {
    try {
      const proc = Bun.spawn({
        cmd: ["bxc", "recon", url, "--profile", profile, "--json", "--quiet", "--timeout", "90000"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await proc.exited;
      const text = await new Response(proc.stdout).text();
      if (code !== 0) {
        const err = await new Response(proc.stderr).text();
        results[url] = { url, error: err.trim() || `bxc exit ${code}` };
        continue;
      }
      const parsed = JSON.parse(text) as Record<string, unknown>;
      results[url] = {
        url,
        finalUrl: parsed.finalUrl as string | undefined,
        httpStatus: parsed.httpStatus as number | undefined,
        profile: parsed.profile as string | undefined,
        cdn: (parsed.headers as { cdnVendor?: string })?.cdnVendor,
        raw: parsed,
      };
    } catch (err: unknown) {
      results[url] = { url, error: err instanceof Error ? err.message : String(err) };
    }
  }

  return {
    generated_at: new Date().toISOString(),
    profile,
    results,
  };
}