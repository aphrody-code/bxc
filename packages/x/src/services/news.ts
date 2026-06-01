// SPDX-License-Identifier: Apache-2.0
import type { XClient } from "../core/client";

const TAB_FOR_YOU = "VGltZWxpbmU6DAC2CwABAAAAB2Zvcl95b3UAAA==";
const TAB_TRENDING = "VGltZWxpbmU6DAC2CwABAAAACHRyZW5kaW5nAAA=";
const TAB_NEWS = "VGltZWxpbmU6DAC2CwABAAAABG5ld3MAAA==";
const TAB_SPORTS = "VGltZWxpbmU6DAC2CwABAAAABnNwb3J0cwAA";
const TAB_ENTERTAINMENT = "VGltZWxpbmU6DAC2CwABAAAADWVudGVydGFpbm1lbnQAAA==";

function tabTimelineId(tab: string): string | null {
  switch (tab) {
    case "forYou":
    case "for-you":
    case "for_you":
      return TAB_FOR_YOU;
    case "trending":
      return TAB_TRENDING;
    case "news":
      return TAB_NEWS;
    case "sports":
      return TAB_SPORTS;
    case "entertainment":
      return TAB_ENTERTAINMENT;
    default:
      return null;
  }
}

export interface NewsOptions {
  tabs?: string[];
  ai_only?: boolean;
}

export interface NewsItem {
  id: string;
  headline: string;
  category: string;
  time_ago?: string;
  post_count?: number;
  description?: string;
  url?: string;
}

/** Parse a K/M/B-suffixed post count like "12.3K posts" or "5M posts". */
export function parsePostCount(s: string): number | null {
  const lower = s.toLowerCase();
  const idx = lower.indexOf("post");
  if (idx === -1) return null;
  const head = s.substring(0, idx);
  // Match digits, dots, spaces, K, M, B
  const tokens = head.match(/[\d.]+\s*[kKmMbB]?/g);
  if (!tokens || tokens.length === 0) return null;
  const token = tokens[tokens.length - 1].trim().toLowerCase();

  let mult = 1;
  let digits = token;
  if (token.endsWith("k")) {
    mult = 1_000;
    digits = token.slice(0, -1);
  } else if (token.endsWith("m")) {
    mult = 1_000_000;
    digits = token.slice(0, -1);
  } else if (token.endsWith("b")) {
    mult = 1_000_000_000;
    digits = token.slice(0, -1);
  }

  const val = parseFloat(digits);
  if (isNaN(val)) return null;
  return Math.round(val * mult);
}

/** Parse one itemContent node into a NewsItem, applying the AI filter. */
export function parseNewsItem(
  itemContent: any,
  entryId: string,
  source: string,
  aiOnly: boolean
): NewsItem | null {
  if (!itemContent) return null;

  const headline = itemContent.name || itemContent.title || "";
  if (!headline) return null;

  const trendMetadata = itemContent.trend_metadata;
  const trendUrl =
    itemContent.trend_url?.url ||
    trendMetadata?.url?.url ||
    undefined;

  const socialContext = itemContent.social_context?.text || "";
  const hasNewsCategory =
    socialContext.includes("News") || socialContext.includes("hours ago");
  const isFullSentence = headline.split(/\s+/).length >= 5;
  const isExplicitAi = !!itemContent.is_ai_trend;
  const isAiNews = isExplicitAi || (isFullSentence && hasNewsCategory);

  if (aiOnly && !isAiNews) {
    return null;
  }

  let category = "Trending";
  let timeAgo: string | undefined;
  let postCount: number | undefined;

  if (socialContext) {
    for (const part of socialContext.split("·").map((p: string) => p.trim())) {
      if (part.includes("ago")) {
        timeAgo = part;
      } else if (part.toLowerCase().includes("post")) {
        const pc = parsePostCount(part);
        if (pc !== null) postCount = pc;
      } else if (part) {
        category = part;
      }
    }
  }

  if (trendMetadata?.meta_description) {
    const pc = parsePostCount(trendMetadata.meta_description);
    if (pc !== null) postCount = pc;
  }

  if (trendMetadata?.domain_context && (category === "Trending" || category === "News")) {
    category = trendMetadata.domain_context;
  }

  const id = trendUrl || `${entryId}-${headline}`.replace(/\s+/g, "_");
  const finalCategory = isAiNews ? `AI · ${category}` : category;

  return {
    id,
    headline,
    category: finalCategory,
    time_ago: timeAgo,
    post_count: postCount,
    description: itemContent.description || undefined,
    url: trendUrl,
  };
}

/** Parse all news items from a GenericTimelineById response. */
export function parseTabItems(
  data: any,
  source: string,
  maxCount: number,
  aiOnly: boolean
): NewsItem[] {
  const items: NewsItem[] = [];
  const instructions = data?.data?.timeline?.timeline?.instructions;
  if (!Array.isArray(instructions)) {
    return items;
  }

  for (const instruction of instructions) {
    const entries: any[] = [];
    if (Array.isArray(instruction.entries)) {
      entries.push(...instruction.entries);
    } else if (instruction.entry) {
      entries.push(instruction.entry);
    } else {
      continue;
    }

    for (const entry of entries) {
      if (items.length >= maxCount) {
        return items;
      }
      const entryId = entry.entryId || "";
      const content = entry.content;
      if (!content) continue;

      // Single trend item
      if (content.itemContent) {
        const item = parseNewsItem(content.itemContent, entryId, source, aiOnly);
        if (item) items.push(item);
      }

      // Module of items
      if (Array.isArray(content.items)) {
        for (const itemData of content.items) {
          if (items.length >= maxCount) {
            return items;
          }
          const ic = itemData?.itemContent || itemData?.item?.itemContent;
          if (ic) {
            const item = parseNewsItem(ic, entryId, source, aiOnly);
            if (item) items.push(item);
          }
        }
      }
    }
  }

  return items;
}

/** Fetch news / trending items from the requested Explore tabs. */
export async function getNews(
  client: XClient,
  count: number,
  options: NewsOptions = {}
): Promise<NewsItem[]> {
  const tabs = options.tabs || ["forYou", "news", "sports", "entertainment"];
  const aiOnly = !!options.ai_only;

  const items: NewsItem[] = [];
  const seen = new Set<string>();

  for (const tab of tabs) {
    const timelineId = tabTimelineId(tab);
    if (!timelineId) continue;

    const variables = {
      timelineId,
      count: count * 2,
      includePromotedContent: false,
    };

    try {
      const json = await client.graphql("GenericTimelineById", variables);
      const parsed = parseTabItems(json, tab, count, aiOnly);

      if (process.env.APHRODY_X_DEBUG) {
        console.error(`[news] tab ${tab}: parsed ${parsed.length} items`);
      }

      for (const it of parsed) {
        if (!seen.has(it.headline)) {
          seen.add(it.headline);
          items.push(it);
        }
      }

      if (items.length >= count) {
        break;
      }
    } catch (e: any) {
      if (process.env.APHRODY_X_DEBUG) {
        console.error(`[news] tab ${tab} graphql error: ${e.message}`);
      }
      continue; // one failing tab shouldn't abort the rest
    }
  }

  return items.slice(0, count);
}
