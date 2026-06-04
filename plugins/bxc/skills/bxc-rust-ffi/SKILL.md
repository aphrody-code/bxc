---
name: bxc Rust FFI Bridge
description: This skill should be used when working on rust-bridge/, FFI between Bun and Rust (cdylib, no_mangle extern "C", lol_html, V8, x-client, x-algorithm), rusqlite workspace constraints, tokio async blocks for FFI, cross-platform cdylib (.so/.dylib/.dll), bxc_x_* symbols, Cargo workspace for rust-bridge crates, or porting Rust code for native browser/X/ranking in Bun projects.
version: 0.1.0
---

# bxc Rust FFI (cdylib for Bun)

The hot path of bxc lives in Rust, exposed to Bun via cdylib + N-API style FFI (or raw extern "C" with bun:ffi or manual).

## Crate Layout (in rust-bridge/)
- bxc-rust-bridge (the cdylib crate exporting bxc_* symbols)
- crates/x-client (native X GraphQL/REST + rusqlite store + ranking helpers)
- crates/x-algorithm (pure Rust port of xai-org/x-algorithm For You ranking, used via FFI or re-exported)

## Critical Rules
- **Single rusqlite**: libsqlite3-sys "links" = "sqlite3". Only one version of rusqlite (0.37) can be linked in the cdylib. All crates in the workspace must use `{ workspace = true }` for rusqlite.
- **Workspace Cargo.toml**: Define [workspace.dependencies] rusqlite = { version = "0.37", features = ["bundled"] } etc. Use in member crates.
- **no_mangle + extern "C"**: For symbols called from Bun (or via the bridge lib).
- **Async in FFI**: Use tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(...) inside the extern "C" fn. Never leak runtimes.
- **Error handling**: Return *mut c_char (JSON or null). Caller frees with CString.
- **Build**: `cargo build -p bxc-rust-bridge --release` (or via `bun run build:linux`). Output in rust-bridge/target/release/libbxc_rust_bridge.{so,dylib,dll}

## Cross-Platform Notes
- Linux: .so (default target)
- macOS: .dylib (x86_64-apple-darwin + aarch64-apple-darwin for universal if needed)
- Windows: .dll (x86_64-pc-windows-msvc). Also produce .exe for standalone tools.
- In Bun code: use `dlopen` with platform-specific name or `process.platform` + `process.arch` to pick the right file. Provide `BXC_RUST_BRIDGE_LIB` override.

## Common FFI Pattern (from bxc)
```rust
#[no_mangle]
pub extern "C" fn bxc_x_algorithm_rank(
    candidates_json: *const c_char,
    context_json: *const c_char,
    top_k: i32,
) -> *mut c_char {
    // parse with serde, call pure algo, return CString::new(json).unwrap().into_raw()
}
```

Bun side lazily dlopen the lib on first use; falls back to pure JS for some paths (title, stripTags, markdown) if cdylib missing.

## When adding new Rust functionality
1. Add or extend a crate under rust-bridge/crates/
2. Export via the main cdylib lib.rs (re-export or thin wrapper)
3. Add TS declarations in rust-bridge/src/ or the consuming package
4. Update build scripts and CLAUDE.md / plugin docs
5. Add tests (cargo test in the crate + Bun test that exercises the FFI path)
6. Document in the skill or references/

See existing crates/x-client and x-algorithm for patterns (the x-algorithm was split out of x-client for clean separation).

Use the bxc-rust-ffi-reviewer agent for reviews.
