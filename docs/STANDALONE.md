# Standalone executable — `bun build --compile`

Bunlight ships a standalone executable produced by `bun build --compile`. The
binary embeds the Bun runtime plus the bundled CLI (`src/cli/serve.ts`) into a
single self-contained file — no `bun` required at runtime, no `node_modules`.

## Quick build

```bash
# Host arch only (default — fast)
bun run build:exe

# All supported targets (linux x64 + linux arm64 if available)
BUNLIGHT_ALL_TARGETS=1 bun run build:exe
```

Output goes to `dist/standalone/bunlight-<platform>-<arch>`.

## Verified output (2026-05-10, Bun 1.3.14, host = linux x64)

| Target            | Status | Size      | Cold start `--help` | Notes                                  |
| ----------------- | ------ | --------- | ------------------- | -------------------------------------- |
| `bun-linux-x64`   | ok     | 96.2 MB   | ~50 ms              | Built and smoke-tested                 |
| `bun-linux-arm64` | FAIL   | n/a       | n/a                 | Cross-compile binary not yet shipped by Bun 1.3.14 — see Limitations |

Smoke tests run after the build:

- `bunlight-linux-x64 --help` prints the synopsis (subset shown):
  ```
  bunlight serve --cdp-port <N> [options]

  Options:
    --cdp-port <N>           TCP port for the CDP server (required)
    --host <addr>            Bind address (default 127.0.0.1)
    --profile <p>            static | fast | stealth | max (default static)
    ...
  ```
- `bunlight-linux-x64 serve --cdp-port 19222 --profile static` then
  `curl -s http://127.0.0.1:19222/json/version` returns valid CDP JSON :
  ```json
  {
    "Browser": "Bunlight/0.1.0 (static)",
    "Protocol-Version": "1.3",
    "webSocketDebuggerUrl": "ws://127.0.0.1:19222/devtools/browser/bunlight-..."
  }
  ```

## What is — and is not — embedded

Embedded into the standalone binary:

- The Bun runtime (~95 MB of the 96 MB total)
- All TypeScript source bundled from `src/cli/serve.ts` (entry) and its
  transitive imports — `src/transport/*`, `src/api/browser.ts`, helpers
- All static assets resolved via bundler `import` (currently none — the CLI
  is pure code)

NOT embedded — these remain external runtime dependencies that the binary
loads at startup if the relevant profile is selected:

| File                                                                | Loaded by                         | Required for                |
| ------------------------------------------------------------------- | --------------------------------- | --------------------------- |
| `vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so` (1.7 MB) | `bun:ffi` in `src/ffi/zigquery.ts` | `--profile static`          |
| `vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0` (2.5 MB) | `bun:ffi` in `src/ffi/curl-impersonate.ts` | http profile (TLS fingerprint) |
| `lightpanda` binary in PATH or env                                  | `Bun.spawn` in `SocketPairTransport.ts` | `--profile fast`            |
| Patchright Chromium / Camoufox Firefox 135                          | profile drivers                   | `--profile stealth` / `max` |

This is intentional — `bun build --compile` does not currently bundle native
shared libraries (`*.so`), and embedding multi-hundred-MB browser binaries
would balloon the executable. Distribute the standalone binary alongside the
`vendor/` tree (or a slimmer subset matching your target profiles).

A future improvement (tracked separately): embed `liblightpanda_dom.so` via
`Bun.embeddedFiles` once Bun's `--compile` exposes that API for FFI loaders.

## Cold start

Measured on the host machine that built it (linux x64):

- `--help` invocation : ~50 ms wall-clock, max RSS ~42 MB
- `serve --cdp-port` ready-to-accept-connections : ~150 ms (within the 2 s
  smoke-test sleep, never observed > 500 ms)

For comparison, `bun src/cli/serve.ts --help` on the same host runs in ~30 ms
— the standalone adds ~20 ms of binary unpack overhead, negligible for a
long-running CDP server.

## Limitations

1. **arm64 cross-compile blocked** — Bun 1.3.14 errors with
   `Target platform 'bun-linux-aarch64-v1.3.14' is not available for download`.
   To produce an arm64 build, run `bun scripts/build-standalone.ts` natively on
   an arm64 host (or use QEMU `aarch64`). Track upstream Bun release notes for
   prebuilt cross-compile binaries — once shipped, `BUNLIGHT_ALL_TARGETS=1`
   will pick it up automatically.
2. **Native `.so` libraries are not embedded** — see table above. Ship the
   `vendor/` directory next to the binary, or set explicit env vars
   (`BUNLIGHT_ZIGQUERY_LIB`, `BUNLIGHT_CURL_IMPERSONATE_LIB`) pointing to the
   resolved paths.
3. **`--profile stealth` / `--profile max` exit with status 2** in CLI mode —
   the patchright / camoufox drivers are wired through the JS API only. The
   CLI surface is currently usable for `static` and `fast` profiles.
4. **Binary is not stripped** — `bun build --compile --minify` strips the JS
   bundle but the embedded Bun runtime ships with its own debug info. Expect
   ~95-100 MB regardless of the size of your TS code.

## Cross-compile workaround

If you really need an arm64 build right now, run the same script on an arm64
machine (or in an arm64 Docker container) :

```bash
docker run --rm --platform linux/arm64 -v "$PWD":/app -w /app oven/bun:1.3.14 \
  bun scripts/build-standalone.ts
```

The output `dist/standalone/bunlight-linux-arm64` will then be a native arm64
binary.

## Reproducing the build

```bash
cd ~/bunmium/bunlight
bun run build:exe                                  # current host arch only
BUNLIGHT_ALL_TARGETS=1 bun run build:exe           # all linux targets

# Smoke
./dist/standalone/bunlight-linux-x64 --help
./dist/standalone/bunlight-linux-x64 serve --cdp-port 19222 --profile static &
curl -s http://127.0.0.1:19222/json/version
kill %1
```
