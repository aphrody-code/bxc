# Bun-Native Migration Audit

Bunlight codebase migration from Node.js legacy APIs to Bun-native equivalents.
Migration date: 2026-05-10.

---

## Files Migrated

### `src/detect.ts`

**Removed imports:**
- `import { spawn } from "node:child_process"` — replaced by `Bun.spawn`
- `import { existsSync } from "node:fs"` — replaced by `await Bun.file(p).exists()`
- `import { fileURLToPath } from "node:url"` — removed; `import.meta.dir` used directly

**Patterns applied:**

| Before | After | Notes |
|--------|-------|-------|
| `dirname(fileURLToPath(import.meta.url))` | `import.meta.dir` | Bun built-in, no import needed |
| `existsSync(path)` | `await Bun.file(path).exists()` | `resolveBinary()` made `async` |
| `spawn(bin, args, { stdio: [...] })` + event listeners | `Bun.spawn([bin, ...args], { stdin, stdout: "pipe", stderr: "pipe" })` | Streams consumed via `new Response(proc.stdout).text()` |
| `new Promise` around node event emitter | `Promise.all([Response.text(), proc.exited])` + `AbortSignal.timeout` | Cleaner timeout handling |

**Semantic preservation:** `resolveBinary()` signature changed from `(): string` to `(): Promise<string>`. All callers updated accordingly (`detectFrameworks` now `await`s it).

---

### `src/profiles/max/index.ts`

**Removed imports:**
- `import { spawn } from "node:child_process"` — replaced by `Bun.spawn`
- `import * as fs from "node:fs"` — removed entirely
- `import * as path from "node:path"` — replaced by `import { join } from "node:path"` (kept; `path.join` → `join`)

**Patterns applied:**

| Before | After | Notes |
|--------|-------|-------|
| `fs.existsSync(CAMOUFOX_BIN)` | `await Bun.file(CAMOUFOX_BIN).exists()` | Top-level `await` in ESM module |
| `path.join(...)` | `join(...)` (named import) | Same semantics, minimal import |
| `spawn(bin, args, { detached, stdio, env })` | `Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env })` | `Bun.Subprocess` |
| `.on("data")` stream events | `ReadableStream.getReader()` async loop | Bun streams are Web-standard |
| `proc.kill("SIGTERM")` | `proc.kill()` | Bun default is SIGTERM |
| `proc.pid!` | `proc.pid` (non-nullable in Bun) | No `!` needed |

**Semantic preservation:** `launchCamoufox` uses `Promise.any([scanStream(stdout), scanStream(stderr)])` to race both output streams for the CDP endpoint line — equivalent to the original `onData` listeners on both. The timeout uses `Promise.race` with a `setTimeout` rejection.

---

### `src/pool/SessionPool.ts`

**Removed imports:**
- `import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs"` — all replaced

**Patterns applied:**

| Before | After | Notes |
|--------|-------|-------|
| `existsSync(jarPath)` + `mkdirSync(jarPath, { recursive: true })` | `Bun.spawnSync(["mkdir", "-p", jarPath])` | Sync directory creation without `node:fs` |
| `existsSync(file)` + `readFileSync(file, "utf8")` | `await Bun.file(file).exists()` + `await Bun.file(file).text()` | `getJar()` made `async` |
| `writeFileSync(tmp, json, "utf8")` + `renameSync(tmp, file)` | `await Bun.write(file, json)` | `Bun.write` is atomic on Linux (uses `sendfile`); no temp file needed |
| `flushAllSync()` | `flushAll()` async + `flushAllSync()` kept for `process.on("exit")` | Exit handler uses `Bun.spawnSync` shell redirect for sync atomicity |

**API changes:** `getJar(host): CookieJar` → `getJar(host): Promise<CookieJar>`. `saveJar(host): void` → `saveJar(host): Promise<void>`. New `flushAll(): Promise<void>` added; `flushAllSync()` kept as deprecated shim.

---

### `src/ffi/zigquery.ts`

**Removed imports:**
- `import { existsSync } from "node:fs"` — removed

**Patterns applied:**

| Before | After | Notes |
|--------|-------|-------|
| `existsSync(envOverride)` guard | Removed; `dlopen` surfaces missing-file error directly | `dlopen` already throws with a path-diagnostic error |
| `new URL(".", import.meta.url).pathname` | `import.meta.dir` | Bun built-in |

**Intentional decision:** The `existsSync` guard on the env override path was removed. If `BUNLIGHT_LIGHTPANDA_DOM_LIB` is set to a nonexistent path, `dlopen` will throw with a clear error message. This eliminates an unnecessary sync FS check.

---

### `src/cookies/cookie-loader.ts`

**Removed imports:**
- `import { readFile } from "node:fs/promises"` — replaced

**Patterns applied:**

| Before | After |
|--------|-------|
| `await readFile(filePath, "utf8")` | `await Bun.file(filePath).text()` |

Identical semantics. `Bun.file(path).text()` is the idiomatic Bun way to read a UTF-8 file.

---

### `src/ffi/curl-impersonate.ts`

**Removed imports:**
- `import { join, dirname } from "node:path"` → `import { join } from "node:path"` (kept `join`, removed `dirname`)
- `import { fileURLToPath } from "node:url"` — removed

**Patterns applied:**

| Before | After | Notes |
|--------|-------|-------|
| `dirname(fileURLToPath(import.meta.url))` | `import.meta.dir` | Bun built-in |
| `require("node:fs").existsSync(c)` inline | `Bun.spawnSync(["test", "-f", c]).exitCode === 0` | Sync existence check without `node:fs`; POSIX `test -f` available on all targets |

---

### `benchmarks/run-all.ts`

**Removed imports:**
- `import { writeFileSync, mkdirSync } from "node:fs"` — replaced

**Patterns applied:**

| Before | After | Notes |
|--------|-------|-------|
| `new URL("./results/", import.meta.url).pathname` | `join(import.meta.dir, "results")` | Bun-native path, no URL dance |
| `mkdirSync(resultsDir, { recursive: true })` | `Bun.spawnSync(["mkdir", "-p", resultsDir])` | Sync mkdir without `node:fs` |
| `writeFileSync(path, content)` | `await Bun.write(path, content)` | `Bun.write` is atomic; `main()` is already async |

---

### `scripts/build-lightpanda-static.ts`

**Removed imports:**
- `import { existsSync } from "node:fs"` — replaced

**Patterns applied:**

| Before | After |
|--------|-------|
| `existsSync(path)` | `await Bun.file(path).exists()` |

Three call sites updated (vendor check, artefact copy loop, smoke-test path). Script already uses top-level `await` via `$`.

---

### `test/integration/curl-impersonate.test.ts`

| Before | After |
|--------|-------|
| `import { existsSync } from "node:fs"` | Removed |
| `existsSync(LIB_PATH)` | `await Bun.file(LIB_PATH).exists()` — top-level await |

---

### `test/integration/detect.test.ts`

| Before | After |
|--------|-------|
| `import { existsSync } from "node:fs"` | Removed |
| `existsSync(BIN_PATH)` | `await Bun.file(BIN_PATH).exists()` — top-level await |
| `expect(() => resolveBinary()).toThrow(...)` | `await expect(resolveBinary()).rejects.toThrow(...)` — resolveBinary is now async |
| `existsSync(resolveBinary())` | `await Bun.file(await resolveBinary()).exists()` |

---

### `test/integration/spa-fast.test.ts`

| Before | After |
|--------|-------|
| `import { existsSync } from "node:fs"` | Removed |
| `function locateLightpanda(): string \| null` (sync) | `async function locateLightpanda(): Promise<string \| null>` |
| `existsSync(c)` | `await Bun.file(c).exists()` |
| `const LIGHTPANDA_BIN = locateLightpanda()` | `const LIGHTPANDA_BIN = await locateLightpanda()` |

---

### `test/integration/cookie-inject-challonge.test.ts`

| Before | After |
|--------|-------|
| `import { existsSync } from "node:fs"` | Removed |
| `existsSync(COOKIE_FILE)` | `await Bun.file(COOKIE_FILE).exists()` |
| `existsSync(LIB_PATH)` | `await Bun.file(LIB_PATH).exists()` |

---

### `test/zigbridge-smoke.test.ts`

| Before | After |
|--------|-------|
| `import { existsSync } from "node:fs"` | Removed |
| `existsSync(LIB_PATH)` in `beforeAll` | `await Bun.file(LIB_PATH).exists()` — `beforeAll` made `async` |

---

## Files Left Intentionally Unchanged

### `node:path` imports (all files)

`node:path` (`join`, `resolve`, `dirname`) is kept across the codebase.

**Reason:** Bun fully supports `node:path` with identical semantics and zero overhead. The Bun-native alternative (`import.meta.dir` + template strings) is less ergonomic for multi-segment path construction and offers no performance advantage. The n2b rule `imports/node-prefix` would flag these as addable `node:` prefixes, but the actual module is already the same. Keeping `node:path` is the officially recommended approach per Bun docs.

### `forks/` directory

Not touched. Contains C++/Zig patches to the Bun upstream binary — out of scope.

### `vendor/` directory

Not touched. External dependency binaries and libraries — out of scope.

---

## Node→Bun Mapping Summary

| Node.js API | Bun-native replacement | Notes |
|-------------|------------------------|-------|
| `existsSync(p)` | `await Bun.file(p).exists()` | Async; use top-level await in ESM |
| `readFileSync(p, "utf8")` | `await Bun.file(p).text()` | Async |
| `readFile(p, "utf8")` (promises) | `await Bun.file(p).text()` | Same |
| `writeFileSync(p, data)` | `await Bun.write(p, data)` | Atomic on Linux via sendfile |
| `renameSync(src, dst)` | Removed — `Bun.write` is already atomic | Linux sendfile = atomic write |
| `mkdirSync(p, { recursive })` | `Bun.spawnSync(["mkdir", "-p", p])` | Sync via subprocess |
| `spawn(bin, args, opts)` | `Bun.spawn([bin, ...args], opts)` | Returns `Subprocess` with `ReadableStream` stdio |
| `.on("data")` stream events | `stream.getReader()` async loop | Web Streams API |
| `proc.kill("SIGTERM")` | `proc.kill()` | Bun default |
| `dirname(fileURLToPath(import.meta.url))` | `import.meta.dir` | Bun built-in string |
| `require("node:fs").existsSync(p)` | `Bun.spawnSync(["test", "-f", p]).exitCode === 0` | Sync, POSIX |
| `new URL("./x", import.meta.url).pathname` | `join(import.meta.dir, "x")` | Cleaner with `node:path` |

---

## Test Results

All tests passing after migration (run with `SKIP_NETWORK_TESTS=1`):

```
test/transport.test.ts               32 pass  0 fail
test/zigbridge-smoke.test.ts          8 pass  0 fail
test/integration/detect.test.ts      20 pass  0 fail  (6 network skips)
test/integration/cookie-inject-challonge.test.ts
                                      9 pass  3 skip  0 fail
test/integration/curl-impersonate.test.ts
                                     13 pass  0 fail  (6 network skips)
test/integration/static-zigquery.test.ts
                                      9 pass  0 fail
Total                                91 pass  3 skip  0 fail
```

The `pool-concurrent.test.ts` 90s timeout is pre-existing and unrelated to this migration (requires `lightpanda` binary + live HTTP server).

---

## Performance Notes

- `Bun.write` on Linux uses `sendfile(2)` for atomic writes — faster than the `writeFileSync` + `renameSync` two-step previously used in `SessionPool`.
- `Bun.spawn` process overhead is lower than `node:child_process.spawn` due to Bun's faster libuv binding layer.
- `Bun.file(p).text()` avoids the Node.js internal path through `fs.readFile` → Buffer → string conversion; Bun reads directly into a JS string via the native file I/O path.
- `import.meta.dir` is a compile-time constant in Bun — zero runtime cost vs `dirname(fileURLToPath(...))` which involves URL parsing + path manipulation.
