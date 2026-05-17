# MIGRATION_PLAN.md — Node.js → Bun Native

Project: Bxc
Status: 🟢 Phase 1 (APIs) Completed | 🟢 Phase 2 (Execution) Completed | 🟡 Phase 3 (Advanced) In Progress

## Matrix: Migrate vs Keep

| Feature / Module | Status | Strategy | Reason |
| --- | --- | --- | --- |
| `path` -> `node:path` | ✅ Done | Auto-fix | Bun best practice |
| `fs` -> `node:fs` | ✅ Done | Auto-fix | Bun best practice |
| `process.env` | ⚠️ Skip | Keep | SSR/Next.js compatibility |
| `performance.now()` | ✅ Done | `Bun.nanoseconds()` | Precision & Performance |
| `child_process.spawn` | ✅ Done | `Bun.spawn()` | Native Bun IPC & Speed |
| `he.escape` | ✅ Done | `Bun.escapeHTML()` | 3x faster, native UTF-8 |
| `setTimeout` (poll) | ✅ Done | `Bun.sleep()` | Event loop efficiency |

## Phases

### Phase 1: Pure Native APIs (Completed)
- [x] `api/escape-html` -> `Bun.escapeHTML()`
- [x] `api/performance-now` -> `Bun.nanoseconds()` / 1e6
- [x] `imports/node-prefix` -> `node:*`

### Phase 2: Native Execution (Completed)
- [x] `api/child-process-spawn` -> `Bun.spawn()`
- [x] `api/process-stderr-write` -> `Bun.stderr.write()`
- [x] `api/buffer-from-base64` -> `Uint8Array.fromBase64()`
- [x] `api/sleep-promise` -> `Bun.sleep()` (Applied to hot paths in `serve.ts` and `capsolver.ts`)

### Phase 3: Advanced Optimization (In Progress)
- [x] `api/file-based-routing` -> `Bun.FileSystemRouter` (Implemented in `scanPagesDir`)
- [ ] Native Build Plugins (`n2b bin plugin`)

## Validation Gate
- `bun install`
- `bun tsc --noEmit`
- `bun test`
