---
name: bxc-x-client
description: This skill should be used for the native cookie-based X/Twitter client (@aphrody/x), GraphQL + REST, catalog sync from bundles, local For You ranking (rankTweets / tweetToPostCandidate from x-algorithm port), SQLite store + FTS, Radar / X Pro decks, stealth profiles, and using it from Grok tool calling via XTools.
metadata:
  short-description: Use the native cookie-based bxc X client.
---

See packages/x/README.md (the canonical, complete, readable one created as part of bxc docs work) and the bxc-grok-xai skill for the synergy side.

Key exports: XClient, XSession, rankTweets, tweetToPostCandidate, XTools (in xai package).

Cross-platform: pure TS + optional Rust FFI companion in rust-bridge/crates/x-client.

Use the bxc-x-grok-architect agent for deep integration work.
