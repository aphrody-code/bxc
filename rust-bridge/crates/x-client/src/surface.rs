// SPDX-License-Identifier: Apache-2.0
//! X.com API surface constants (aligned with `@aphrody/x` `x-surface.ts`).

/// Discovery pages that embed responsive-web bundle URLs.
pub const DISCOVERY_PAGES: &[&str] = &[
    "https://x.com/?lang=en",
    "https://x.com/explore",
    "https://x.com/notifications",
    "https://x.com/settings/profile",
    "https://x.com/i/premium",
    "https://pro.x.com/i/radar/new",
    "https://x.com/settings/subscriptions",
];

/// X Pro (Gryphon) recon URLs.
pub const X_PRO_RECON_URLS: &[&str] = &[
    "https://pro.x.com",
    "https://pro.x.com/i/decks/new",
    "https://pro.x.com/i/decks/1823398034933199077",
];

/// Gryphon deck GraphQL operations (gryphon-client bundle).
pub const GRYPHON_GRAPHQL_OPS: &[&str] = &[
    "ViewerAccountSync",
    "CreateDeck",
    "UpdateDeck",
    "RemoveDeck",
    "ReorderDecks",
    "CreateColumn",
    "UpdateColumn",
    "RemoveColumn",
    "ReorderColumns",
    "GryphonImportClientSyncColumns",
    "GryphonDeleteAccountSync",
    "UpdateGryphonOnboardingState",
];

pub const GRAPHQL_URL_TEMPLATE: &str =
    "https://x.com/i/api/graphql/{query_id}/{operation_name}";

pub const REST_V1_1_BASE: &str = "https://x.com/i/api/1.1/";

/// GraphQL ops for Premium / subscriptions hub.
pub const PREMIUM_GRAPHQL_OPS: &[&str] = &[
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
];

/// Checkout SKU strings (client-side, not GraphQL operation names).
pub const PRODUCT_SKUS: &[&str] = &[
    "BlueVerified",
    "BlueVerified3Months",
    "BlueVerified6Months",
    "BlueVerifiedPlus",
    "BlueVerifiedPlus3Months",
    "BlueVerifiedPlus6Months",
    "PremiumBasic",
];