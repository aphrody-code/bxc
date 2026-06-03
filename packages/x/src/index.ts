// SPDX-License-Identifier: Apache-2.0

export { XSession, type XSessionData } from "./core/session";
export { API_BASE } from "./core/client";
export {
  XClient,
  type RateLimit,
  type TweetResult,
  type UserInfo,
  type ListInfo,
  type TimelineTweet,
} from "./core/client";
export { QueryIdStore, type QueryIdSnapshot } from "./config/query-ids";
export {
  XError,
  checkApiErrors,
  walkTimelineTweets,
  walkTimelineUsers,
  parseSingleTweet,
  parseTweetResult,
  parseUserResult,
  type Author,
  type Tweet,
  type TweetPage,
  type User,
  type UserPage,
} from "./core/parse";
export { getNews, parsePostCount, parseNewsItem, parseTabItems, type NewsItem, type NewsOptions } from "./services/news";
export {
  X_DISCOVERY_PAGES,
  X_DISCOVERY_UA,
  X_RECON_URLS,
  X_SDK_COVERAGE,
  X_REST_V1_1,
  X_CDN,
  PREMIUM_ROUTES,
  PREMIUM_GRAPHQL_OPS,
  PREMIUM_PRODUCT_SKUS,
  PREMIUM_PAGE_URL,
  PREMIUM_PAYMENT_HOSTS,
  X_API_ENDPOINTS,
} from "./config/x-surface";
export {
  syncCatalogFromBundles,
  fetchLiveQueryIds,
  discoverBundleUrls,
  extractAllOperationsFromJs,
} from "./tools/bundle-catalog";
export { runXSurfaceRecon, type XSurfaceReconReport, type ReconSummary } from "./tools/bxc-recon";
export { buildCoverageReport, resolveOperationQueryId, type CoverageReport } from "./services/coverage";
export {
  fetchPremiumUpsells,
  fetchPremiumBundle,
  fetchAllPremiumGraphql,
  premiumGraphqlVariables,
  parseUpsellsResponse,
  parsePremiumFlags,
  type PremiumUpsells,
  type PremiumAccountFlags,
  type UpsellConfigEntry,
  type UpsellSurfaceKey,
  type ProductCategory,
  type ChargeInterval,
} from "./services/premium";
export {
  RADAR_PAGE_URL,
  RADAR_NEW_URL,
  RADAR_ROUTES,
  RADAR_GRAPHQL_OPS,
  RADAR_QUERY_SOURCE,
  RADAR_SEARCH_PRODUCTS,
  RADAR_QUERY_SYNTAX_HELP,
  type RadarSearchProduct,
} from "./config/radar-surface";
export {
  X_PRO_HOST,
  X_PRO_DECKS_NEW,
  X_PRO_DECKS_MANAGE,
  X_PRO_DECK_URL,
  GRYPHON_BUNDLE_BASE,
  X_PRO_ROUTES,
  GRYPHON_GRAPHQL_OPS,
  X_PRO_COLUMN_TIMELINE_OPS,
  X_PRO_RECON_URLS,
} from "./config/x-pro-surface";
export {
  viewerAccountSync,
  getDeck,
  createDeck,
  updateDeck,
  removeDeck,
  reorderDecks,
  createColumn,
  updateColumn,
  removeColumn,
  reorderColumns,
  importClientSyncColumns,
  probeXProAccess,
  parseViewerAccountSync,
  type XProDeck,
  type XProDeckColumn,
  type XProDeckConfig,
  type XProAccountSync,
  type ViewerAccountSyncResult,
} from "./services/x-pro-deck";
export {
  radarSearch,
  radarSearchAll,
  radarMetrics,
  radarExplore,
  probeRadarAccess,
  type RadarSearchOptions,
  type RadarMetrics,
  type RadarActivityBucket,
  type RadarExploreSnapshot,
} from "./services/radar";
export { uploadMedia } from "./services/media";
export { getOperation, allOperations, queries, mutations, type Operation } from "./config/catalog";
export { Store, edge, type StoredTweet, type Stats as StoreStats, type Digest } from "./db/store";
export { importArchive, resolveTweetsFile, parseArchiveArray, archiveTweetToTweet } from "./db/archive";
export { startSyncCron, type SyncOptions } from "./services/cron";
export { AuthorSchema, TweetSchema, UserSchema, ListInfoSchema } from "./core/schemas";
export { ingestBeybladeData, type IngestStats } from "./db/ingest";
export { Crawler, type CrawlerOptions } from "./services/crawler";
export { BeybladeXRag, type RagResult, type RagOptions } from "./services/rag";

