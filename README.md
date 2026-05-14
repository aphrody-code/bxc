# Bunlight ⚡️

> **The High-Performance Browser Automation Engine for Bun.**  
> A zero-spawn, in-process browser engine fusion of Bun and Lightpanda.

[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](https://github.com/aphrody-code/bunlight)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](./LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun_1.3+-black.svg)](https://bun.sh)
[![Lightpanda](https://img.shields.io/badge/engine-Lightpanda-blueviolet.svg)](https://github.com/lightpanda-io/browser)

Bunlight eliminates the overhead of traditional browser automation. Instead of spawning heavy browser processes and communicating over slow WebSockets/CDP, Bunlight integrates the browser engine directly into your Bun runtime.

---

## 🚀 Key Features

- **Zero-Spawn Architecture**: Browser engine runs in-process as a Zig-native extension.
- **Sub-Millisecond Latency**: Function calls replace network overhead.
- **5-Profile Versatility**: Switch between `static`, `http`, `fast`, `stealth`, and `max` based on your target's complexity.
- **Stealth by Design**: Built-in bypasses for Cloudflare, Akamai, and DataDome using the 2026 state-of-the-art stack.
- **MCP Ready**: Official Model Context Protocol support for Gemini and Claude.
- **TypeScript First**: Strict types, async/await, and `await using` resource management.

---

## 📦 Installation

### Via Bun (Recommended)

```bash
bun add @aphrody-code/bunlight
bunlight install --all
```

### One-Line Standalone Install

```bash
curl -fsSL https://raw.githubusercontent.com/aphrody-code/bunlight/main/install.sh | bash
```

---

## 🛠 Usage

### Basic Scraping (Static)
Best for high-speed HTML extraction without JavaScript.

```typescript
import { Browser } from "@aphrody-code/bunlight";

await using page = await Browser.newPage({ profile: "static" });
await page.goto("https://news.ycombinator.com");

const titles = await page.$$eval(".titleline > a", els => els.map(e => e.textContent));
console.log(titles);
```

### Advanced Automation (Stealth)
Bypassing modern anti-bot protections.

```typescript
import { Browser } from "@aphrody-code/bunlight";

await using page = await Browser.newPage({ profile: "stealth" });
await page.goto("https://protected-site.com");

// Interacts like a real human
await page.click("#login-btn");
await page.type("#user", "my_user");
```

---

## 📊 Profiles Comparison

| Profile | Engine | JS | Anti-Bot | Latency | Use Case |
|---------|--------|----|----------|---------|----------|
| `static` | ZigQuery | No | Low | < 5ms | Rapid HTML scraping |
| `http` | Curl-Imp | No | Medium | ~100ms | TLS fingerprinting |
| `fast` | Lightpanda | Yes | Medium | ~120ms | SPA & Dynamic content |
| `stealth` | Patchright | Yes | High | ~800ms | Cloudflare Bypass |
| `max` | Camoufox | Yes | Extreme | ~1500ms | Turnstile/DataDome |

---

## 🤖 AI & MCP Integration

Bunlight is natively compatible with the **Model Context Protocol (MCP)**.  
Use the included Gemini extension to give your AI agents browser superpowers.

```bash
gemini extensions link packages/bunlight/extensions/gemini-bunlight
```

---

## ☁️ VPS Optimization & Continuous Usage

Bunlight is designed for 24/7 autonomous operation on VPS environments.

- **Systemd Integration**: Use `scripts/deploy/bunlight.service` to run Bunlight as a self-healing background service.
- **SQLite Persistence**: Optimized with Write-Ahead Logging (WAL) for high-concurrency storage of scrape results.
- **Native Scheduler**: Run periodic tasks without external dependencies using `bun run cron:start`.

## 🌐 Public API & GraphQL

Expose your Bunlight instance as a secure web service.

```bash
# Start the API server (REST + GraphQL)
bun run api:dev
```

- **GraphQL Studio**: Explore and test tools at `http://localhost:3000/graphql`.
- **Swagger UI**: Interactive REST documentation at `http://localhost:3000/swagger`.
- **Type Generation**: Generate end-to-end types for your clients with `bun run packages/api/generate:types`.

---

## 🛡 License

MIT License. See [LICENSE](./LICENSE) for details.  
Built with ❤️ by the **Aphrody Code** team.
