<!-- SPDX-License-Identifier: Apache-2.0 -->
# gemini-web

Pure-Rust SDK for the **Gemini web app** (`gemini.google.com/app`) — the
consumer Gemini product, driven by the signed-in Google session cookies (no API
key). Mirrors the `notebooklm` crate's Boq `batchexecute` transport.

Full protocol reference: [`docs/research/gemini-web-protocol.md`](../../docs/research/gemini-web-protocol.md).
Feature matrix: [`docs/research/gemini-web-feature-matrix.md`](../../docs/research/gemini-web-feature-matrix.md).

## Auth

Export your signed-in Google cookies (e.g. the Cookie-Editor extension, JSON
array format) to `~/.aphrody/google-cookies.json`. The anti-CSRF `at` token is
scraped from the app page at construction — no key, no OAuth. Secrets stay under
your home directory; never inside the workspace.

## Quick start

```rust
use gemini_web::{GeminiWebClient, GeminiModel};

# async fn run() -> gemini_web::Result<()> {
// The caller installs a rustls CryptoProvider before the first request.
let client = GeminiWebClient::from_default_cookie_file("en").await?;

// One-shot (3.5 Flash by default):
let reply = client.ask("Explain io_uring in one sentence.", None).await?;
println!("{}", reply.text);

// Pick a model + continue the thread:
let header = GeminiModel::Pro.header();
let follow = client.send("And epoll?", Some(&header), &reply.metadata).await?;
println!("{} (images: {:?})", follow.text, follow.generated_image_urls);
# Ok(())
# }
```

## Surface

| Area | Item |
|---|---|
| Client | `GeminiWebClient::{from_default_cookie_file, from_cookie_file, from_auth, ask, send, get_config_flag, refresh}` |
| Models | `GeminiModel::{FlashLite, Flash, Pro}` (verified header tokens), `ReasoningLevel::{Standard, Extended}` (Deep Think) |
| Reply | `ChatReply { text, metadata, web_image_urls, generated_image_urls, generated_video_urls, candidate_count }` |
| Transport | `HttpTransport::{rpc_raw, stream_generate}`, `SessionTokens` |
| Auth | `Auth`, `CookieJar`, `SessionCookie`, `sapisidhash` |
| Codec | `boq::{encode_f_req, parse_envelopes, ...}` |

## Consumers

- `aphrody-chat::GeminiWebBackend` — native 3.5 Flash chat backend.
- `aphrody-mcp` tools — `gemini_chat`, `gemini_image` (Nano Banana),
  `gemini_video` (Veo), `gemini_deep_research`.

## Status

Verified live end-to-end: cookie auth → page bootstrap → `batchexecute` config
read → `StreamGenerate` send → reply + threading. Model selection (Flash-Lite /
3.5 Flash verified). Image/video extraction is response-side. Video (Veo) and
Deep Research are async generative flows reached via prompt-routing; mode-chip
activation + poll-to-completion are documented enhancements.
