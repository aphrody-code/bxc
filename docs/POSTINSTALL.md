# POSTINSTALL — auto-install Lightpanda binary

When you run `bun install` (or `npm install`) on `@bunmium/bunlight`, the package's
`postinstall` script automatically downloads the **Lightpanda browser binary** matching
your platform into `vendor/lightpanda-bin/<platform>/lightpanda`.

This binary powers the `fast` profile (Lightpanda CDP sub-process) — without it, the
`fast` profile cannot start a browser and tests/integration code falls back to skip.

> The Chromium / Firefox binaries used by the `stealth` (Patchright) and `max`
> (Camoufox v135) profiles are **not** auto-downloaded by this hook — those are
> managed by the upstream tooling (`bunx patchright install chromium firefox`,
> `npx camoufox-js fetch`). See PROFILE-STEALTH-RESULTS.md and PROFILE-MAX-RESULTS.md.

---

## Supported platforms

| `process.platform` | `process.arch` | Lightpanda asset            | Vendor dir                    |
|--------------------|----------------|------------------------------|--------------------------------|
| `linux`            | `x64`          | `lightpanda-x86_64-linux`   | `vendor/lightpanda-bin/linux-x64`   |
| `linux`            | `arm64`        | `lightpanda-aarch64-linux`  | `vendor/lightpanda-bin/linux-arm64` |
| `darwin`           | `x64`          | `lightpanda-x86_64-macos`   | `vendor/lightpanda-bin/darwin-x64`  |
| `darwin`           | `arm64`        | `lightpanda-aarch64-macos`  | `vendor/lightpanda-bin/darwin-arm64`|

Other platforms (Windows, FreeBSD, etc.) are not currently published by upstream.
The script logs a warning and exits 0 — the install completes without a browser.

---

## Behavior

| Condition                                                              | Outcome                                                                                                  |
|------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| Binary already on disk (non-zero size)                                 | Logs "already present" and skips download (idempotent re-runs, fast).                                    |
| Binary missing                                                         | Resolves the GitHub release tag (default `nightly`), streams the matching asset to disk, `chmod +x`.     |
| Network failure / GitHub API error / size mismatch                      | Logs a warning with manual-install URL and **exits 0** so `bun install` keeps going.                     |
| Unsupported platform                                                   | Logs a warning, exits 0.                                                                                  |
| `BUNLIGHT_NO_AUTOINSTALL=1`                                            | Skips entirely (silent opt-out for users who manage their own binaries).                                 |
| `CI=1` and `LIGHTPANDA_AUTOINSTALL` not set                            | Skips (most CI providers cache `node_modules`/`vendor` separately).                                      |
| `CI=1` and `LIGHTPANDA_AUTOINSTALL=1`                                  | Forces download even in CI.                                                                              |

The script writes via `Bun.file().writer()` (streaming, no full buffer in RAM) into a
`<target>.partial` file, then atomically renames once the bytes-written count matches
the asset's `size` field. A failed/aborted download leaves a `.partial` file that gets
overwritten on the next run.

---

## Environment variables

| Variable                    | Default      | Effect                                                                                  |
|-----------------------------|--------------|-----------------------------------------------------------------------------------------|
| `BUNLIGHT_NO_AUTOINSTALL`   | unset        | When `1`, skip the download entirely.                                                   |
| `LIGHTPANDA_AUTOINSTALL`    | unset        | When `1`, forces download even with `CI=1`.                                             |
| `LIGHTPANDA_RELEASE_TAG`    | `nightly`    | GitHub release tag to fetch from `lightpanda-io/browser`.                               |
| `LIGHTPANDA_DOWNLOAD_URL`   | unset        | Skip the GitHub API lookup and stream from this URL directly (advanced / mirror use).   |
| `BUNLIGHT_VENDOR_DIR`       | `vendor/lightpanda-bin` (relative to package) | Override the install root (e.g., shared cache).                  |

---

## Manual install fallback

If the hook fails (corporate firewall, GitHub API rate limit, custom platform), grab
the binary directly :

```sh
# Detect your platform
ASSET="lightpanda-$(uname -m | sed 's/x86_64/x86_64/;s/aarch64/aarch64/')-$(uname -s | tr '[:upper:]' '[:lower:]' | sed 's/darwin/macos/')"

# Download
mkdir -p vendor/lightpanda-bin/linux-x64
curl -L -o vendor/lightpanda-bin/linux-x64/lightpanda \
     "https://github.com/lightpanda-io/browser/releases/download/nightly/${ASSET}"

chmod +x vendor/lightpanda-bin/linux-x64/lightpanda
```

You can also point Bunlight at a system-wide install via the `LIGHTPANDA_BIN` env var
consumed by `src/profiles/fast/`.

---

## Running the script manually

```sh
# Install or re-install the binary
bun scripts/postinstall.ts

# Force re-download (delete first, the script is idempotent)
rm -f vendor/lightpanda-bin/linux-x64/lightpanda
bun scripts/postinstall.ts

# Test the opt-out path
BUNLIGHT_NO_AUTOINSTALL=1 bun scripts/postinstall.ts

# Pin a specific release
LIGHTPANDA_RELEASE_TAG=v0.5.0 bun scripts/postinstall.ts
```

---

## Why this design

- **Bun-native** : `Bun.file().writer()` streams the response body chunk-by-chunk,
  avoiding the ~130 MB memory spike a `Buffer` round-trip would cause. `Bun.$` shells
  out for `mkdir -p`, `mv`, `chmod +x` (atomic file ops without `node:fs`).
- **Never blocks `bun install`** : every error path returns `exit 0`. A broken
  network is an annoyance, not an install failure.
- **Idempotent** : re-running is a fast `Bun.file(...).exists()` + size check.
- **CI-friendly** : default is to skip in CI (cached vendor dirs), but `LIGHTPANDA_AUTOINSTALL=1`
  flips it back on for cold caches.
