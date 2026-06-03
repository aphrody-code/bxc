// SPDX-License-Identifier: Apache-2.0
/**
 * X.com private web API surface map (bxc recon + bundle extraction, 2026-06).
 * Shared by @aphrody-code/x and aphrody-x-client.
 */

export const X_DISCOVERY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

/** Pages that reference responsive-web bundles (queryId discovery). */
export const X_DISCOVERY_PAGES = [
  "https://x.com/?lang=en",
  "https://x.com/explore",
  "https://x.com/notifications",
  "https://x.com/settings/profile",
  "https://x.com/i/premium",
  "https://x.com/i/radar",
  "https://x.com/i/radar/new",
  "https://x.com/settings/subscriptions",
] as const;

export const PREMIUM_PAGE_URL = "https://x.com/i/premium" as const;

export const PREMIUM_ROUTES = [
  "/i/premium",
  "/i/premium_sign_up",
  "/i/premium_cross_grade",
  "/i/premium_tier_switch",
  "/i/twitter_blue_sign_up",
  "/i/blue",
  "/i/verified-application",
  "/i/verified-invoice",
  "/i/verified-order-summary",
  "/i/verified-orgs-signup",
  "/i/verified-welcome",
  "/i/verified/settings",
  "/i/verifiedorganizations",
  "/settings/subscriptions",
  "/settings/creator-subscriptions",
  "/settings/verified",
] as const;

export const PREMIUM_PRODUCT_SKUS = [
  "BlueVerified",
  "BlueVerified3Months",
  "BlueVerified6Months",
  "BlueVerifiedPlus",
  "BlueVerifiedPlus3Months",
  "BlueVerifiedPlus6Months",
  "PremiumBasic",
] as const;

export const PREMIUM_GRAPHQL_OPS = [
  "Upsells",
  "Viewer",
  "UserByScreenName",
  "UserCreatorSubscriptions",
  "CreatorSubscriptionsTimeline",
  "UserCreatorSubscribers",
  "SuperFollowers",
  "BlueVerifiedFollowers",
  "UserArticlesTweets",
  "UsersVerifiedAvatars",
  "EnableVerifiedPhoneLabel",
  "DisableVerifiedPhoneLabel",
] as const;

/** High-level CLI / SDK coverage (typed helpers exist on XClient). */
export const X_SDK_COVERAGE = [
  "post",
  "reply",
  "delete",
  "note",
  "like",
  "unlike",
  "retweet",
  "unretweet",
  "bookmark",
  "unbookmark",
  "pin",
  "unpin",
  "follow",
  "unfollow",
  "block",
  "unblock",
  "mute",
  "unmute",
  "user",
  "timeline",
  "dm",
  "graphql",
  "read",
  "thread",
  "search",
  "userTweets",
  "home",
  "likes",
  "bookmarks",
  "mentions",
  "following",
  "followers",
  "listTimeline",
  "lists",
  "news",
  "uploadMedia",
  "premium",
  "whoami",
] as const;

export const X_API_ENDPOINTS = {
  graphql: "https://x.com/i/api/graphql/{queryId}/{operationName}",
  graphql_post: "https://x.com/i/api/graphql/{queryId}/{OperationName}",
  rest_v1_1: "https://x.com/i/api/1.1/",
  api_v2: "https://api.x.com/",
  bearer_note: "Static web Bearer in bundle (not personal OAuth)",
} as const;

export const X_REST_V1_1 = [
  "friendships/create.json",
  "friendships/destroy.json",
  "blocks/create.json",
  "blocks/destroy.json",
  "mutes/users/create.json",
  "mutes/users/destroy.json",
  "favorites/create.json",
  "dm/new2.json",
  "account/verify_credentials.json",
] as const;

export const PREMIUM_PAYMENT_HOSTS = [
  "https://pay.x.com",
  "https://pay.twitter.com",
  "https://money.x.com",
  "https://money-dev.x.com",
  "https://money-staging.x.com",
  "https://payments-prod.x.com",
  "https://payments-staging.x.com",
  "https://payments-dev.x.com",
] as const;

export const X_CDN = {
  bundles: "https://abs.twimg.com/responsive-web/client-web/",
  media: "https://pbs.twimg.com",
  video: "https://video.twimg.com",
  ton: "https://ton.x.com",
} as const;

/** URLs for bxc recon (profile max recommended for SPA routes). */
export const X_RECON_URLS = [
  "https://x.com",
  "https://x.com/home",
  "https://x.com/i/premium",
  "https://x.com/i/radar/new",
  "https://x.com/explore",
  "https://x.com/settings/subscriptions",
  "https://x.com/i/radar",
  "https://x.com/i/radar/new",
  ...PREMIUM_PAYMENT_HOSTS.slice(0, 2),
] as const;