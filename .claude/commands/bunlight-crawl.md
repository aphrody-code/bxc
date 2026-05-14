---
description: Start a massive crawl with RequestQueue auto-resume from a file with one URL per line
argument-hint: <urls-file> [concurrency] [profile]
allowed-tools: ["Read", "Write", "Edit", "Bash"]
---

# Crawl many URLs with Bunlight

The user invoked this with: `$ARGUMENTS`

Treat `$1` as the path to a text file with one URL per line, `$2` as the concurrency (default `50`), and `$3` as the profile (default `fast`).

Steps:

1. Validate `$1` exists and is readable. If missing, ask the user for a valid path and stop.
2. Resolve `$2` as an integer in `[1, 200]`; if missing or invalid, default to `50`.
3. Resolve `$3` as one of `static`, `fast`, `http`, `stealth`, `max`; default to `fast`.
4. Compute a slug from the input filename (e.g. `urls.txt` → `urls`) and a timestamp.
5. Generate a crawler at `./scripts/crawl-<slug>-<timestamp>.ts` using the `bunlight-crawler` agent's template:
   - `RequestQueue` backed by `./data/crawl-<slug>.db` (bun:sqlite).
   - Load URLs from `$1` into the queue (idempotent: skip already-known URLs).
   - `PagePool` with `concurrency: $2`, `profile: "$3"`, `maxPages: max(5, floor($2 / 2))`.
   - SIGINT handler that flushes the writer and closes the pool, then `process.exit(0)`.
   - Output JSONL at `./output/crawl-<slug>-<timestamp>.jsonl`.
   - Per-URL retry: `markFailed` with retries+1, retry up to 3 times.
   - Periodic log every 100 records: processed count, error count, throughput.
6. Run the script: `bun run ./scripts/crawl-<slug>-<timestamp>.ts`.
7. If the run is interrupted (Ctrl+C) and re-invoked, the same RequestQueue resumes — explain this to the user.
8. Print a summary at the end: total URLs, succeeded, failed, output path, suggested next steps.

Use only Bun-native APIs (`Bun.file`, `Bun.write`, `bun:sqlite`). No Node stdlib, no emojis.
