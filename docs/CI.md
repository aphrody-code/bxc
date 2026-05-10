# CI / GitHub Actions

Bunlight uses GitHub Actions for continuous integration and release automation. All workflows are Bun-native and rely on `oven-sh/setup-bun@v2`. No `nodejs/setup-node` is used except for npm registry auth in the publish job.

---

## Workflows

| File | Trigger | Purpose |
|---|---|---|
| `.github/workflows/test.yml` | push, pull_request on main/master | Run `bun test` across an OS / Bun-version matrix. |
| `.github/workflows/lint.yml` | push, pull_request on main/master | Run `bun run lint` (biome) plus `bun --bun tsc --noEmit` typecheck. |
| `.github/workflows/release.yml` | tag push matching `v*` | Build standalone executables for 4 targets, publish a GitHub release, and (optionally) publish to npm. |
| `.github/dependabot.yml` | weekly schedule | Auto-PR Bun and GitHub Actions dependency bumps. |

---

## test.yml

Matrix:

| OS | Bun version |
|---|---|
| ubuntu-latest | latest |
| ubuntu-latest | 1.3.x |
| macos-latest | latest |
| macos-latest | 1.3.x |

Steps:

1. `actions/checkout@v4`
2. `actions/cache@v4` for `~/.bun/install/cache` and `node_modules`, keyed on lockfile hash.
3. `oven-sh/setup-bun@v2` with the matrix-selected Bun version.
4. `bun install --frozen-lockfile` (falls back to `bun install` if no lockfile).
5. `bun test`.

`fail-fast: false` so one cell failing does not cancel the rest. Timeout: 20 minutes per job.

---

## lint.yml

Single ubuntu-latest job. Steps:

1. Checkout, cache, setup Bun (latest).
2. `bun install`.
3. `bun run lint` — invokes the `lint` script in `package.json`, which is `biome check .`.
4. `bun --bun tsc --noEmit` — type-only check using the Bun-bundled TypeScript path.

Timeout: 10 minutes.

---

## release.yml

Trigger: pushing a tag matching `v*` (e.g., `v0.1.0`, `v0.2.0-alpha.1`).

### Build matrix

| Runner | Target | Suffix |
|---|---|---|
| ubuntu-latest | `bun-linux-x64` | linux-x64 |
| ubuntu-latest | `bun-linux-arm64` | linux-arm64 |
| macos-latest | `bun-darwin-x64` | darwin-x64 |
| macos-latest | `bun-darwin-arm64` | darwin-arm64 |

Each cell runs:

```sh
bun build --compile --target=<bun-target> ./bin/bunlight \
  --outfile dist/standalone/bunlight-<suffix>
```

Artifacts are uploaded individually with `actions/upload-artifact@v4` (retention 7 days).

### Release job

- Downloads all build artifacts.
- Flattens them into `release-assets/`.
- Calls `softprops/action-gh-release@v2` to create the GitHub release with auto-generated notes and uploads every binary as a release asset.

### npm publish job

- Runs only if the tag has no pre-release dash (`v0.1.0` yes, `v0.1.0-alpha.1` no).
- Uses `actions/setup-node@v4` purely for npm registry auth (`NODE_AUTH_TOKEN`).
- `npm publish --access public --provenance`.
- Skipped at runtime if the `NPM_TOKEN` secret is empty.

---

## Required secrets

| Secret | Used by | Required? |
|---|---|---|
| `GITHUB_TOKEN` | release.yml (auto-provided) | Always present, no action needed. |
| `NPM_TOKEN` | release.yml `npm` job | Optional. If missing, the npm job no-ops; the GitHub release still goes out. Create a granular npm automation token at npmjs.com and add it under repository Settings -> Secrets -> Actions. |

No other secrets are required. CapSolver / proxies / cookies are never used in CI — those tests skip cleanly when their environment variables are absent (see `docs/PROFILES.md`).

---

## Caching strategy

Both `test.yml` and `lint.yml` cache:

- `~/.bun/install/cache` — Bun's package store.
- `node_modules` — resolved tree.

Cache key: `{os}-bun-{version}-{hash of package.json + lockfile}`. Restore-keys allow partial hits when only a transitive dep moved.

`release.yml` does not cache because each tag should produce a clean build.

---

## Dependabot

`/.github/dependabot.yml` watches:

- `bun` ecosystem at repo root, weekly Monday 06:00 UTC.
- `github-actions` ecosystem at repo root, weekly Monday 06:00 UTC.

Each ecosystem caps PRs at 5 and uses commit-message prefixes `chore(deps)` and `chore(ci)` respectively, so semantic-release / changelog tooling can group them later.

---

## Local validation

To validate workflow YAML before pushing:

```sh
python3 -c "import yaml; [yaml.safe_load(open(f)) for f in ['.github/workflows/test.yml','.github/workflows/lint.yml','.github/workflows/release.yml','.github/dependabot.yml']]" \
  && echo OK
```

For deeper validation (job graph, expressions), use `act` or push to a throwaway branch.

---

## Future improvements

- Add a Windows runner once Bun's Windows support stabilizes for the `bun:ffi` paths Bunlight uses.
- Cross-build linux-arm64 with QEMU smoke testing rather than skipping the smoke step.
- Integrate `bunx patchright install chromium firefox` cache for stealth/max profile tests on CI (currently skipped).
- Publish a Docker image alongside the GitHub release.
