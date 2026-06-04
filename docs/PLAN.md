# bxc Autopilot PLAN (native X + xAI clients)

Focus: Make @aphrody/x (native cookie X client) + @aphrody/xai (native TS Grok client with SuperGrok keyless) the best-in-class for agentic, zero-key, high-performance X/Grok workflows.

## Current Status (autopilot as of 2026-06-04, post docs polish)
- High-level fluent Chat in xai (createChat/append/sample/stream/executeToolCalls/sampleStructured) mirroring xai-sdk-python design + full tool calling loop with auto XTools dispatch.
- SuperGrok / keyless auth: SUPER_GROK_TOKEN, ~/.grok/auth.json OIDC → "supergrok"/"grok_oidc" modes (no xai- key needed for gratuite access).
- X integration: XTools (ctor injectable for tests) + tool defs + xNativeTools in xai (uses native @aphrody/x XClient for search/profile/news/tweets/whoami). Local For You algo (rankTweets etc from x-algorithm port) in x.
- Tests: 30 pass + 2 skip (live opt-in), 32 total, 120 expects across packages/x + packages/xai (unit, no live). Covers stream toolCallDeltas, full executeToolCalls loop, XTools mocks, synergy, algo filters/scoring/diversity, errors, reasoning_effort, structured.
- CLI/MCP updated to use high-level + native X.
- Docs complete & readable: packages/x/README.md (new, TOC, features, algo, synergy examples), packages/xai/README.md (TOC, full self-contained examples for Chat/XTools/agent loops, Quick Ref, prod notes), root README + CLAUDE.md updated with links + accurate counts. See packages/*/README.md.
- Autopilot loop + subagents + monitors running (YOLO, scoped verify on x/xai paths to reduce noise, auto status in log).
- Scoping in scripts/autopilot.sh tightened (direct oxlint + per-pkg tsc on feature paths only).

## Next Items (autopilot will pick in order, auto-execute, auto-fix)
1. **Full tool calling support in high-level Chat**: Detect tool_calls in sample/stream responses, provide .callTools(handlers) or auto-dispatch for known X tools.
2. **Deeper X client synergy**: 
   - XTools to support full XClient surface (radar, pro decks, media, archive?).
   - Bidirectional: allow XClient to use Grok for summarization/AI extract (e.g. new method on XClient).
3. **More Python SDK parity**:
   - Structured outputs (response_format json_schema + basic parse).
   - Reasoning models (pass reasoning_effort through createChat).
   - Image gen / video (add image.generate, video.generate stubs using raw + types).
   - Server-side tools / agentic (web_search, code, x_search built-ins that use our native clients).
4. **Robustness**:
   - Better streaming (handle tool_calls deltas, usage in final chunk).
   - Retry / backoff in Chat (reuse low-level if any, or simple).
   - Telemetry hooks (optional, like Python).
5. **CLI/MCP**:
   - `bxc grok chat-session` or interactive mode using Chat.
   - MCP tool `bxc_grok_chat_session` for stateful multi-turn (conversation_id?).
6. **Testing & CI**:
   - Mocked tool calling tests.
   - Integration test using fake SuperGrok + fake X session (or record/replay).
   - Ensure no regression on low-level.
7. **Docs & examples**:
   - Full example in packages/x/examples/ : "grok-x-agent.ts" (Grok decides to use native X tools).
   - Update main README, CLAUDE.md with "X + Grok native combo".
8. **Polish**:
   - Version bump in packages/xai/package.json.
   - Add to skills/ if MCP relevant.
   - Performance: cache models, etc.

## Constraints (autopilot must obey)
- Always keyless first (SuperGrok / OIDC preferred).
- Use native packages/x for any X data (no external APIs when possible).
- Keep Bun/TS native (fetch, no heavy gRPC unless justified).
- YOLO: edit, test, verify, document without confirmation.
- Zero human: if ambiguous, choose the robust path (e.g. typed > any).
- Scope: changes only improve the native clients feature or related plans.

Autopilot: run verify (no live), implement 1 item per cycle, auto-commit? (no, just prepare), update this PLAN, loop.

Next cycle target: item 1 (tool calling in Chat) + item 3 partial (structured + reasoning through).
