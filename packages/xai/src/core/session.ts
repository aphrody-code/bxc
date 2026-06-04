// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AuthMode, GrokAuthEntry } from "./types.ts";

export const XAI_API_BASE = "https://api.x.ai/v1";

export interface ResolvedAuth {
  mode: AuthMode;
  bearer: string;
  email?: string;
  userId?: string;
  expiresAt?: string;
  source: string;
}

/** Load Grok Build OIDC session from ~/.grok/auth.json (preferred, no metered API key). */
export function loadGrokAuthFile(
  path = join(homedir(), ".grok", "auth.json"),
): GrokAuthEntry {
  if (!existsSync(path)) {
    throw new Error(
      `Grok session not found at ${path}. Run: grok login (or set XAI_API_KEY)`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<
    string,
    GrokAuthEntry
  >;
  const entries = Object.values(raw).filter(
    (e) => e && typeof e.key === "string" && e.key.length > 0,
  );
  if (entries.length === 0) {
    throw new Error(`No valid auth entry in ${path}`);
  }
  const pick = entries.sort((a, b) => {
    const ta = Date.parse(a.expires_at ?? "") || 0;
    const tb = Date.parse(b.expires_at ?? "") || 0;
    return tb - ta;
  })[0];
  if (pick.expires_at) {
    const exp = Date.parse(pick.expires_at);
    if (!Number.isNaN(exp) && exp < Date.now()) {
      throw new Error(
        `Grok OIDC token expired at ${pick.expires_at}. Run: grok login`,
      );
    }
  }
  return pick;
}

function isApiKey(token: string): boolean {
  return token.startsWith("xai-");
}

/**
 * Resolve credentials without requiring XAI_API_KEY when Grok CLI is logged in.
 *
 * Order:
 * 1. Explicit bearer / api key argument
 * 2. XAI_API_KEY env (metered developer key)
 * 3. ~/.grok/auth.json OIDC JWT (`key` field) — same token Grok Build uses
 */
export function resolveAuth(explicit?: string): ResolvedAuth {
  if (explicit?.trim()) {
    const bearer = explicit.trim();
    const mode: "api_key" | "supergrok" = isApiKey(bearer) ? "api_key" : "supergrok";
    return {
      mode,
      bearer,
      source: "explicit",
    };
  }

  const envKey = process.env.XAI_API_KEY?.trim();
  if (envKey) {
    return {
      mode: "api_key",
      bearer: envKey,
      source: "XAI_API_KEY",
    };
  }

  // Support for "SuperGrok" / free subscriber token (api key less, gratuite).
  // User can set SUPER_GROK_TOKEN or GROK_SUPER_TOKEN or pass as bearer; treated as supergrok mode.
  const superGrok = (process.env.SUPER_GROK_TOKEN || process.env.GROK_SUPER_TOKEN || "").trim();
  if (superGrok) {
    return {
      mode: "supergrok",
      bearer: superGrok,
      source: "SUPER_GROK_TOKEN / GROK_SUPER_TOKEN env (api key less, gratuite)",
    };
  }

  const entry = loadGrokAuthFile();
  return {
    mode: "grok_oidc",
    bearer: entry.key,
    email: entry.email,
    userId: entry.user_id,
    expiresAt: entry.expires_at,
    source: "~/.grok/auth.json",
  };
}