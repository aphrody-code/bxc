---
description: Import a cookie jar from a file or clipboard into cookies/private
argument-hint: [source-path-or-clipboard] [domain]
allowed-tools: ["Read", "Write", "Edit", "Bash"]
---

Import cookies from `$1` (a file path, or the literal word `clipboard`) for domain `$2`, store under `cookies/private/$2.json`.

Steps:

1. Validate `$2` is a bare domain (no scheme, no path, no `..`). Refuse if the domain contains `/` or `\`.
2. Resolve `$1`:
   - File path: read with `Bun.file($1).text()`.
   - `clipboard`: shell out to `xclip -o` (Linux), `pbpaste` (macOS), or `powershell.exe Get-Clipboard` (WSL/Windows). Pick whichever is available.
3. Delegate to the `bunlight-cookie-extractor` agent to:
   - Detect the format (Netscape, CDP, Playwright, Bunlight).
   - Convert losslessly to Bunlight format.
   - Validate: each cookie has `name`, `value`, `domain`. Warn on expired entries.
4. Write to `./cookies/private/$2.json`. Create the directory if missing.
5. Verify `.gitignore` covers `cookies/private/`. If missing, append `cookies/private/` to `.gitignore`.
6. `chmod 600` the resulting file.
7. Report: source format detected, target path, count of valid cookies, count of expired (warning), the loader snippet to paste into a scraper.

Refuse if the resolved file is empty or contains no recognizable cookie format.
