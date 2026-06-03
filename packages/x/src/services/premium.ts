// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";
import { PREMIUM_GRAPHQL_OPS } from "../config/x-surface";

/** Known upsell surface keys on x.com (from Upsells GraphQL). */
export type UpsellSurfaceKey =
  | "UserProfileName"
  | "UserProfileHeader"
  | "HomeSidebar"
  | "PremiumNav"
  | "HomeNav"
  | string;

/** Checkout SKUs in responsive-web main bundle (2026-06); not separate GraphQL ops. */
export type ProductCategory =
  | "BlueVerified"
  | "BlueVerified3Months"
  | "BlueVerified6Months"
  | "BlueVerifiedPlus"
  | "BlueVerifiedPlus3Months"
  | "BlueVerifiedPlus6Months"
  | "PremiumBasic"
  | string;
export type ChargeInterval = "Month" | "Year" | string;

export interface UpsellDestination {
  charge_interval?: ChargeInterval;
  product_category?: ProductCategory;
}

export interface UpsellConfigEntry {
  key: UpsellSurfaceKey;
  attribution_referrer?: string;
  destination?: UpsellDestination;
  is_hidden?: boolean;
  variant_key?: string;
  action_label?: string;
  primary_label?: string;
}

export interface PremiumUpsells {
  configs: UpsellConfigEntry[];
  raw: unknown;
}

export interface PremiumAccountFlags {
  is_blue_verified?: boolean;
  premium_gifting_eligible?: boolean;
  creator_subscriptions_count?: number;
  super_follow_eligible?: boolean;
  super_followers_count?: number;
  is_super_follow_subscriber?: boolean;
  can_access_payments?: boolean;
}

/** Parse `Upsells` → viewer_v2.upsell_config_for_surfaces. */
export function parseUpsellsResponse(json: unknown): PremiumUpsells {
  const configs: UpsellConfigEntry[] = [];
  const surfaces =
    (json as any)?.data?.viewer_v2?.user_results?.result?.upsell_config_for_surfaces?.configs;
  if (!Array.isArray(surfaces)) {
    return { configs, raw: json };
  }
  for (const item of surfaces) {
    const key = item?.key as string;
    const val = item?.value;
    const def = val?.default_content;
    const variant = val?.variant_config?.variants?.[0];
    const content = variant ?? def;
    configs.push({
      key,
      attribution_referrer: val?.attribution_params?.referrer,
      destination: content?.destination,
      is_hidden: def?.is_hidden,
      variant_key: content?.key,
      action_label:
        content?.render_properties?.action_label ??
        content?.render_properties?.cta?.action_label,
      primary_label: content?.render_properties?.primary_label,
    });
  }
  return { configs, raw: json };
}

/** Extract premium-related flags from Viewer + UserByScreenName payloads. */
export function parsePremiumFlags(viewerJson: unknown, userJson?: unknown): PremiumAccountFlags {
  const user =
    (viewerJson as any)?.data?.viewer?.user_results?.result ??
    (userJson as any)?.data?.user?.result;
  const viewerRoot = (viewerJson as any)?.data;
  return {
    is_blue_verified: user?.is_blue_verified,
    premium_gifting_eligible: user?.premium_gifting_eligible,
    creator_subscriptions_count: user?.creator_subscriptions_count,
    super_follow_eligible: user?.super_follow_eligible,
    super_followers_count: viewerRoot?.viewer?.super_followers_count,
    is_super_follow_subscriber: viewerRoot?.is_super_follow_subscriber,
    can_access_payments: viewerRoot?.can_access_payments,
  };
}

export async function fetchPremiumUpsells(client: XClient): Promise<PremiumUpsells> {
  const json = await client.graphqlWaiting("Upsells", {});
  return parseUpsellsResponse(json);
}

export async function fetchPremiumBundle(
  client: XClient,
  handle: string,
  userId: string,
): Promise<{ upsells: PremiumUpsells; flags: PremiumAccountFlags; raw: Record<string, unknown> }> {
  const [upsellsJson, viewerJson, userJson] = await Promise.all([
    client.graphqlWaiting("Upsells", {}),
    client.graphqlWaiting("Viewer", { withCommunitiesMemberships: true }),
    client.graphqlWaiting("UserByScreenName", {
      screen_name: handle,
      withSafetyModeUserFields: true,
    }),
  ]);
  return {
    upsells: parseUpsellsResponse(upsellsJson),
    flags: parsePremiumFlags(viewerJson, userJson),
    raw: { Upsells: upsellsJson, Viewer: viewerJson, UserByScreenName: userJson },
  };
}

/** Variable templates for full Premium GraphQL coverage (see scripts/x-premium-dump.ts). */
export function premiumGraphqlVariables(
  handle: string,
  userId: string,
): Record<string, Record<string, unknown>> {
  return {
    Upsells: {},
    Viewer: { withCommunitiesMemberships: true },
    UserByScreenName: { screen_name: handle, withSafetyModeUserFields: true },
    UserCreatorSubscriptions: { userId, count: 50, includePromotedContent: false },
    CreatorSubscriptionsTimeline: { userId, count: 50, includePromotedContent: false },
    UserCreatorSubscribers: { userId, count: 50, includePromotedContent: false },
    SuperFollowers: { userId, count: 50, includePromotedContent: false },
    BlueVerifiedFollowers: { userId, count: 20, includePromotedContent: false },
    UserArticlesTweets: { userId, count: 20, includePromotedContent: true, withVoice: true },
    UsersVerifiedAvatars: { userIds: [userId] },
    EnableVerifiedPhoneLabel: {},
    DisableVerifiedPhoneLabel: {},
  };
}

/** Fetch every op in PREMIUM_GRAPHQL_OPS; failures are recorded, not thrown. */
export async function fetchAllPremiumGraphql(
  client: XClient,
  handle: string,
  userId: string,
): Promise<Record<string, { ok: true; data: unknown } | { ok: false; error: string }>> {
  const vars = premiumGraphqlVariables(handle, userId);
  const out: Record<string, { ok: true; data: unknown } | { ok: false; error: string }> = {};
  for (const op of PREMIUM_GRAPHQL_OPS) {
    try {
      const data = await client.graphqlWaiting(op, vars[op] ?? {});
      out[op] = { ok: true, data };
    } catch (err: unknown) {
      out[op] = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}