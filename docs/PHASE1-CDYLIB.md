# Phase 1 — liblightpanda_dom cdylib (zigquery backend, static mode)

> Goal: a shared/static library exposing a C ABI for HTML parsing and CSS
> selector queries, with **zero dependency on Lightpanda, V8, or any Rust
> toolchain**.  This is the **L1 fast path** for Bunlight's `static` mode.

---

## Why zigquery, not Lightpanda?

| Concern | Lightpanda extraction | zigquery |
|---|---|---|
| V8/JSC coupling | 541 `js.*` references across DOM code | zero |
| Build deps | Rust (html5ever), BoringSSL, curl, sqlite | none |
| Binary size | ~25 MB stripped | ~300 KB stripped |
| Parse correctness | html5ever (spec-complete) | custom recursive-descent |
| JS execution | Yes (full SPA support) | No |
| API simplicity | complex frame/session/app hierarchy | `Document.initFromSlice` + `doc.find` |

**Conclusion**: for the `static` mode (server-rendered HTML, no in-page JS),
zigquery is the correct tool.  For `full` mode (SPAs requiring JS execution),
Lightpanda is invoked as a **sub-process** communicating over CDP via Unix
socketpair — see MEGA-PLAN.md.

---

## 1. Build

```bash
cd /path/to/bunmium/bunlight/vendor/zigquery-wrapper
zig build -Doptimize=ReleaseFast
```

No network access required: zigquery source is vendored in `zigquery-src/`
(a patched fork of OrlovEvgeny/zigquery@d48bf11, render.zig ported to Zig 0.16).

**Output**:

```
zig-out/lib/liblightpanda_dom.so   # shared library (Linux)
zig-out/lib/liblightpanda_dom.a    # static library
```

**Sizes** (ReleaseFast, unstripped, x86-64 Linux):
- `.so`: ~3.8 MB
- `.a`: ~4.9 MB

### Build options

| Option | Type | Default | Description |
|---|---|---|---|
| `-Doptimize=ReleaseFast` | enum | Debug | Optimization level |
| `-Dtarget=aarch64-linux` | string | native | Cross-compile target |

### Run inline tests

```bash
zig build test
```

---

## 2. Architecture

```
bl_doc_from_html(html, len)
    │
    ▼
BlDocumentImpl (gpa)
  └─ doc: zigquery.Document
       └─ arena: ArenaAllocator   ← all DOM nodes live here
            └─ root_node: *Node

bl_doc_find(doc, selector, len)
    │
    ▼
BlSelectionImpl (gpa)
  ├─ sel: zigquery.Selection   ← []*Node slice into doc arena
  └─ owner: *BlDocumentImpl

bl_sel_text / bl_sel_attr / bl_sel_html / ...
    │
    ▼
BlString { data: [*]const u8, len: usize, cap: usize }
  └─ data points into doc arena (cap == 0 → arena-owned)
```

Destroying a `BlDocument` via `bl_doc_destroy()` resets the arena, freeing all
DOM nodes **and** all `BlString` data in one call.  Any live `BlSelection`
handles derived from that document become invalid immediately after.

---

## 3. Exported C symbols

Library prefix: `bl_`

### Library lifecycle

| Symbol | Signature | Description |
|---|---|---|
| `bl_init` | `() → c_int` | Initialize library. Returns 0. Safe to call multiple times. |
| `bl_deinit` | `() → void` | Release global DebugAllocator. Call before unloading. |

### Document lifecycle

| Symbol | Signature | Description |
|---|---|---|
| `bl_doc_from_html` | `([*]u8, usize) → ?*BlDocument` | Parse HTML. Returns null on error. |
| `bl_doc_destroy` | `(*BlDocument) → void` | Free document and all DOM memory. Invalidates all BlSelection handles. |

### Selection queries

| Symbol | Signature | Description |
|---|---|---|
| `bl_doc_find` | `(*BlDocument, [*]u8, usize) → ?*BlSelection` | Run CSS selector; returns all matches. |
| `bl_sel_count` | `(*BlSelection) → usize` | Number of matched elements. |
| `bl_sel_at` | `(*BlSelection, usize) → ?*BlSelection` | Single-element sub-selection at index. |
| `bl_sel_destroy` | `(*BlSelection) → void` | Free selection wrapper (not the DOM nodes). |

### Element accessors (first element in selection)

| Symbol | Signature | Description |
|---|---|---|
| `bl_sel_text` | `(*BlSelection) → BlString` | Combined text of all descendant text nodes. |
| `bl_sel_html` | `(*BlSelection) → BlString` | Inner HTML (serialized children). |
| `bl_sel_outer_html` | `(*BlSelection) → BlString` | Outer HTML (element + children). |
| `bl_sel_attr` | `(*BlSelection, [*]u8, usize) → BlString` | Attribute value; empty if absent. |
| `bl_sel_tag_name` | `(*BlSelection) → BlString` | Tag name, lowercase (e.g. "div"). |

### Memory management

| Symbol | Signature | Description |
|---|---|---|
| `bl_string_free` | `(BlString) → void` | No-op for arena strings (cap==0). Must still be called for forward compatibility. |

### Error reporting

| Symbol | Signature | Description |
|---|---|---|
| `bl_last_error` | `() → [*:0]const u8` | Last error as null-terminated C string. Valid until next bl_* call. Do NOT free. |

### BlString layout (C)

```c
typedef struct {
    const uint8_t *data;   // UTF-8 bytes; never null (empty → points to "")
    size_t         len;    // byte count (not including any null terminator)
    size_t         cap;    // 0 = arena-owned (free is no-op); >0 = GPA-owned
} BlString;
```

---

## 4. Limitations

- **No JavaScript execution.**  Script tags are parsed as DOM nodes but not
  evaluated.  For SPAs requiring JS execution, use Bunlight `full` mode which
  invokes Lightpanda as a subprocess over CDP.

- **No event listeners.**  `on*` attributes are stored as DOM attributes but no
  callbacks fire.

- **Static HTML parsing only.**  `bl_doc_from_html` operates synchronously on
  the provided bytes.  There is no event loop, network stack, or timers.

- **No CSS cascade or layout.**  `getComputedStyle`, `getBoundingClientRect`,
  and scroll positions are not available.

- **No navigation.**  Provide pre-fetched HTML bytes; use Bun's `fetch()` to
  retrieve them if needed.

- **BlString lifetime.**  `BlString.data` is valid only until `bl_doc_destroy()`
  is called.  Copy the bytes if you need them to outlive the document.

- **Thread safety: none.**  Serialize document access externally or use one
  document per thread.

- **Zig version.**  zigquery-src/ targets Zig 0.15.2.  This vendor copy is
  patched to compile on Zig 0.16.x (render.zig ported from `std.io.AnyWriter`
  to an `ArrayList`-based writer; GPA renamed to `DebugAllocator`).

---

## 5. Smoke test — Bun FFI

The test at `test/zigbridge-smoke.test.ts` can be run after building:

```bash
# Build first
cd vendor/zigquery-wrapper && zig build -Doptimize=ReleaseFast && cd ../..

# Run smoke test
bun test test/zigbridge-smoke.test.ts
```

Expected output:

```
bun test v...
zigbridge smoke test — liblightpanda_dom
  [pass] bl_init returns 0
  [pass] parse HTML document — returns non-null handle
  [pass] find h1 selector — count == 1
  [pass] bl_sel_text returns 'Hi'
  [pass] bl_sel_attr returns id value
  [pass] bl_sel_tag_name returns lowercase tag
  [pass] empty selector result — count == 0, bl_sel_at returns null
  [pass] cleanup correct — no crash after destroy sequence
```

---

## 6. Vendor patch notes

`zigquery-src/` is a vendored copy of OrlovEvgeny/zigquery at commit d48bf11
(tag v0.1.1) with the following changes:

### `zigquery-src/dom/render.zig`
- Removed `std.io.AnyWriter` (removed in Zig 0.16)
- Removed `ArrayList.writer(allocator).any()` calls (writer adapter removed)
- Replaced with an internal `Buf` struct wrapping `*ArrayList(u8)` + allocator
- Public API (`renderToString`, `renderChildrenToString`, `escapeString`) unchanged

### `src/exports.zig`
- Uses `std.heap.DebugAllocator` (renamed from `GeneralPurposeAllocator` in 0.16)

---

## 7. Next steps (Phase 2)

1. **TypeScript wrapper**: `src/ffi/static-dom.ts` — expose `BlDocument` and
   `BlSelection` as GC-managed objects using `FinalizationRegistry`.

2. **Benchmark**: target < 0.5 ms per `parse + querySelector` on a 10 KB
   HTML document.

3. **Packaging**: `packages/bunlight-native/` — NPM package shipping prebuilt
   `.so` for Linux x64 and ARM64.

4. **Phase 3 (full mode)**: Lightpanda sub-process bridge via CDP over Unix
   socketpair for SPA rendering.
