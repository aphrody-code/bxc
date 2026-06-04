// SPDX-License-Identifier: Apache-2.0
/**
 * X tools integration for Grok/xAI client.
 *
 * Allows Grok (via tool calling) to use our native packages/x client
 * (cookie-based, keyless, full stealth + store) for X data.
 *
 * This makes Grok + bxc fully native for X reconnaissance without
 * external API keys.
 */

import { XClient, XSession } from "@aphrody/x";
// Note: getNews is re-exported on XClient instance via the service.
import type { NewsItem } from "@aphrody/x"; // for typing, optional at runtime

export interface XSearchToolArgs {
  query: string;
  count?: number;
  mode?: "Latest" | "Top";
}

export interface XProfileToolArgs {
  handle: string;
}

export interface XTweetsToolArgs {
  handle: string;
  count?: number;
}

export interface XNewsToolArgs {
  count?: number;
  // options passthrough if needed later
}

export interface XWhoamiToolArgs {
  // no args
}

export class XTools {
  private x: XClient;

  constructor(sessionOrClient?: XSession | string | any) {
    if (sessionOrClient && typeof sessionOrClient === "object" && (sessionOrClient.search || sessionOrClient.userByScreenName || sessionOrClient.whoami)) {
      // treat as prebuilt client (real XClient or test mock with methods)
      this.x = sessionOrClient;
    } else if (typeof sessionOrClient === "string") {
      this.x = new XClient(XSession.fromCookieString(sessionOrClient));
    } else if (sessionOrClient) {
      this.x = new XClient(sessionOrClient);
    } else {
      this.x = new XClient(XSession.loadOrEnv());
    }
  }

  async search(args: XSearchToolArgs) {
    const res = await this.x.search(args.query, args.count ?? 10, undefined, args.mode ?? "Latest");
    // Return simplified for tool result
    return {
      tweets: (res.tweets || []).map((t: any) => ({
        id: t.id,
        text: t.text,
        author: t.author?.username,
        created_at: t.created_at,
        like_count: t.like_count,
        retweet_count: t.retweet_count,
      })),
      next_cursor: res.next_cursor,
    };
  }

  async profile(args: XProfileToolArgs) {
    return this.x.userByScreenName(args.handle.replace(/^@/, ""));
  }

  async whoami() {
    // Production: returns the viewer UserInfo from native session (cookie OIDC equiv for X)
    return this.x.whoami();
  }

  async tweets(args: XTweetsToolArgs) {
    const handle = args.handle.replace(/^@/, "");
    const user = await this.x.userByScreenName(handle);
    const page = await this.x.userTweets(user.id, args.count ?? 20);
    return {
      user: { id: user.id, screen_name: user.screen_name, name: user.name },
      tweets: (page.tweets || []).map((t: any) => ({
        id: t.id,
        text: t.text,
        created_at: t.created_at,
        like_count: t.like_count,
        retweet_count: t.retweet_count,
        author: t.author?.username,
      })),
      next_cursor: page.next_cursor,
    };
  }

  async news(args: XNewsToolArgs = {}) {
    // Uses native X explore/news surface (no extra keys)
    const items = await this.x.getNews(args.count ?? 10);
    return {
      items: (items || []).map((n: NewsItem | any) => ({
        id: n.id || n.url,
        title: n.title || n.text,
        url: n.url,
        source: n.source,
        score: n.score,
      })),
    };
  }
}

export const xSearchToolDef = {
  type: "function" as const,
  function: {
    name: "x_search",
    description: "Search the X (Twitter) Latest or Top timeline using the native bxc X client. Use for real-time posts, trends, user content.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", description: "Max results (default 10, max 50)" },
        mode: { type: "string", enum: ["Latest", "Top"], description: "Search mode" },
      },
      required: ["query"],
    },
  },
};

export const xProfileToolDef = {
  type: "function" as const,
  function: {
    name: "x_profile",
    description: "Fetch public X profile info (followers, bio, etc) using native client.",
    parameters: {
      type: "object",
      properties: {
        handle: { type: "string", description: "@username or username" },
      },
      required: ["handle"],
    },
  },
};

export const xWhoamiToolDef = {
  type: "function" as const,
  function: {
    name: "x_whoami",
    description: "Resolve the currently authenticated X/Twitter account (viewer) using the native bxc X session. No args.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
};

export const xTweetsToolDef = {
  type: "function" as const,
  function: {
    name: "x_tweets",
    description: "Fetch recent tweets from a specific X user handle using native client (stealth, cookie, full archive access).",
    parameters: {
      type: "object",
      properties: {
        handle: { type: "string", description: "@username or username" },
        count: { type: "number", description: "Max tweets (default 20)" },
      },
      required: ["handle"],
    },
  },
};

export const xNewsToolDef = {
  type: "function" as const,
  function: {
    name: "x_news",
    description: "Fetch trending news / Explore tab items from X using the native client (real-time, no keys).",
    parameters: {
      type: "object",
      properties: {
        count: { type: "number", description: "Max items (default 10)" },
      },
    },
  },
};
