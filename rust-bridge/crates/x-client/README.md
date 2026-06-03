# Standalone X (Twitter) Web API Client

A high-performance polyglot (Rust & Bun/TypeScript) headless client to interact directly with the private web API of X (Twitter). Bypasses developer portal restrictions using session cookies, dynamic queryIds, and stealth HTTP headers.

## Features

- **GraphQL & REST legacy fallback**: Fully maps X's private web endpoint gateway.
- **Dynamic queryId scraping**: Reads current javascript bundle queryIds from x.com at runtime to remain resilient against client updates.
- **Local-first SQLite storage**: Dual-language schema parity storing tweets, users, timeline edges, and follows, with a virtual FTS5 index for instant search.
- **Stealth and rate-limit safety**: Captures rate limit headers and queues requests, using user-agent and UUID generation to resemble authentic browser clients.
- **Media uploads & note tweets**: Native chunked uploads for media attachments and long-form tweet posting.

## Directory Structure

- `src/` — Standalone Rust crate (builds a library `x_client` and CLI `x-cli`).
- `ts/` — Standalone Bun/TypeScript package (`@aphrody/x`).
- `data/` — GraphQL operation catalogs.

## Installation & Build

### Prerequisites
- Rust (Edition 2024)
- Bun (latest)
- Just (Task runner, optional)

### Build the Rust target:
```bash
cargo build --release
```

### Install TypeScript dependencies:
```bash
cd ts
bun install
```

### Run tests:
```bash
# Rust
cargo test

# TypeScript/Bun
cd ts
bun test
```

Using `just` task runner:
```bash
just build
just test
```

## License
Apache-2.0
