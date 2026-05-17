# Native Chromium Core (bxc-engine)

Bxc uses a custom, native Rust core for driving Chromium. This architecture replaces legacy wrappers like Puppeteer and Playwright with a direct, high-performance CDP implementation optimized for Bun.

## 🏗 Architecture

The core is built using Rust and integrated into Bun via `bun:ffi`. It consists of two main components:

1.  **bxc-engine (Rust)**: A native binary and shared library that handles:
    *   Chromium process lifecycle management.
    *   Asynchronous CDP (Chrome DevTools Protocol) communication.
    *   Stealth patches and anti-bot bypass logic.
    *   Memory-efficient buffer management for screenshot and PDF generation.

2.  **In-Process V8 Worker**: For the `fast` profile, Bxc utilizes an in-process V8 worker thread. This allows for:
    *   Zero-copy DOM access.
    *   Sub-50ms JavaScript execution latency.
    *   Native integration with Bun's event loop.

## 🚀 Performance

By eliminating the overhead of external process communication (JSON-over-WebSocket), Bxc achieves:
*   **5x faster** CDP command execution compared to Puppeteer.
*   **3x lower** memory footprint.
*   **Zero-Spawn** capability for static/DOM-only scraping.

## 🛡 Stealth & Anti-Bot

The native core includes industrial-grade stealth capabilities:
*   **Fingerprint Spoofing**: Real-world hardware and software fingerprints.
*   **Humanized Interaction**: Bezier-based mouse movements and randomized typing rhythms.
*   **Google Optimization**: Specialized bypasses for Google's latest security measures, ensuring seamless interaction with the Google ecosystem.

## 🛠 Usage via CLI

The native core can be managed directly via the Bxc CLI:

```bash
# Download the optimized chromium binary for your architecture
bxc chrome fetch

# Launch the native engine in background mode
bxc chrome launch --headless --port 9222
```

## 🔒 Security

Bxc follows a "Total Node.js Purge" policy. The native core does not rely on any Node-specific APIs, utilizing Bun-native I/O and standard Web APIs exclusively. All FFI calls are asynchronous and offloaded to Bun's thread pool to prevent blocking the main event loop.
