# Publishing `@aphrody/bxc` to npm

End-to-end checklist for cutting a release. Bxc ships as a Bun-native package; the standalone executable is distributed via GitHub Releases (not npm) to keep tarball size reasonable.

Publishing is automated: pushing a `v*` tag triggers `.github/workflows/publish.yml`, which installs, lints, and runs `bun publish --access public --registry https://registry.npmjs.org`. The steps below document the equivalent manual flow and the pre-flight checks.

## Pre-flight

- [ ] All tests green: `bun test test/ packages/ src/` — **never bare `bun test`**, it walks `vendor/` and dies.
- [ ] No staged secrets: `git status` clean of `cookies/private/`, `*.env`, `*.key`.
- [ ] `package.json` `version` bumped (semver — current line is `0.8.x`).
- [ ] `CHANGELOG.md` updated (or release notes drafted).
- [ ] Cross-check `package.json#files` against `.npmignore` — defense in depth.
- [ ] `bun outdated` reviewed for security advisories.

## Build the runtime artifacts

Nothing binary ships on npm: the tarball is TypeScript only. The native
libraries are resolved at runtime and are optional — `src/rust/bridge.ts`
`dlopen`s them lazily and the text paths fall back to pure JS when they are
missing. Build them for local testing with:

```bash
cargo build -p bxc-rust-bridge --release   # libbxc_rust_bridge.{so,dylib,dll}
bun run build:linux                        # cargo + standalone binaries
```

## Build the standalone executable (separate channel — GitHub Release)

```bash
BXC_TARGETS=linux-x64 bun scripts/build-standalone.ts   # TypeScript only, no cargo
bun run build:mcp                                       # dist/standalone/bxc-mcp
ls -lh dist/standalone/
```

`bxc-linux-x64` weighs ~275 MB (Bun runtime included). Upload it to the GitHub
Release; it is deliberately not on npm.

## Pack and audit

```bash
cd /home/ubuntu/bxc
rm -f aphrody-bxc-*.tgz
bun pm pack --dry-run          # liste sans écrire
bun pm pack
```

Measured on 0.8.0 — **313 files, 2.71 MB unpacked**:

- `src/` (181 files) and `packages/*/src/` (138) — `package.json#files` excludes
  every `*.test.ts` from both;
- `packages/*/package.json` — required, the root `exports` map points into them;
- the three launchers `bin/bxc`, `bin/bxc.mjs`, `bin/bxc.cmd`;
- `scripts/postinstall.ts`, `types/`, `patches/`, `README.md`, `LICENSE`.

No `.so`, no `dist/`, no `vendor/`, no test file. Check with:

```bash
tar tzf aphrody-bxc-0.8.0.tgz | grep -c "test.ts"    # expect 0
tar tzf aphrody-bxc-0.8.0.tgz | sort | head -30
```

## Smoke-test in a clean project

```bash
rm -rf /tmp/bxc-install-test
mkdir -p /tmp/bxc-install-test && cd /tmp/bxc-install-test
bun init -y
bun add file:/home/ubuntu/bxc/aphrody-bxc-0.8.0.tgz
bun -e 'import { Browser } from "@aphrody/bxc"; console.log(typeof Browser)'
```

Expected stdout: `object`.

Optional CDP smoke-test:

```bash
bxc serve --cdp-port 19222 --profile static &
sleep 2
curl -s http://localhost:19222/json/version | jq .
kill %1
```

## npm login (one-time per machine)

```bash
bun pm whoami                      # confirm if already logged in
# If not:
npm login --registry=https://registry.npmjs.org/
# Two-factor auth strongly recommended for the @aphrody scope.
```

## Publish

CI publishes automatically on a `v*` tag push
(`.github/workflows/publish.yml`), which runs:

```bash
bun scripts/publish-workspaces.ts
```

That script publishes **every** workspace package, then the root — in
dependency order (`@aphrody/x` before `@aphrody/xai`, `@aphrody/ietv` before
`@aphrody/wonderbot`), skipping versions already on the registry. This matters:
the root pins all its `@aphrody/*` dependencies to exact versions, so publishing
the root alone ships a package that cannot be installed. Preview the order
without publishing anything:

```bash
bun scripts/publish-workspaces.ts --dry-run
```

For a single manual publish (scoped packages need `--access public`, already set
via `publishConfig.access`):

```bash
bun publish --access public --registry https://registry.npmjs.org
```

For pre-release channels (alpha/beta/rc), add `--tag`:

```bash
bun publish --access public --tag next --registry https://registry.npmjs.org
```

### postinstall

The package declares `postinstall: bun scripts/postinstall.ts`, which downloads
the Lightpanda browser for the consumer's platform. It never blocks an install
(any failure warns and exits 0) and it **skips inside this repository** — a
`.git` directory next to the script is the signal, so `bun install` here stays
inert. Opt out with `BXC_NO_AUTOINSTALL=1`; force it with
`LIGHTPANDA_AUTOINSTALL=1`.

## Post-publish verification

```bash
bun pm view @aphrody/bxc versions
bun pm view @aphrody/bxc dist-tags
```

Then re-run the smoke-test from the public registry:

```bash
rm -rf /tmp/bxc-prod-test && mkdir -p /tmp/bxc-prod-test
cd /tmp/bxc-prod-test && bun init -y
bun add @aphrody/bxc
bun -e 'import { Browser } from "@aphrody/bxc"; console.log(typeof Browser)'
```

## GitHub Release (separate distribution for the standalone binary)

```bash
cd /home/ubuntu/bxc
gh release create v0.8.0 \
  dist/standalone/bxc-linux-x64 \
  --title "v0.8.0" \
  --notes-file RELEASE-NOTES.md
```

Verify:

```bash
gh release view v0.8.0
```

## Yank (only if necessary)

If a tarball ships secrets or broken artefacts, yank within 72 hours:

```bash
bun pm unpublish @aphrody/bxc@0.8.0
# Or deprecate (preferred for cosmetic/release-note errors):
npm deprecate @aphrody/bxc@0.8.0 "Use 0.8.1 — fixes X"
```

## Rollback checklist

- Bump patch version (`0.8.0` to `0.8.1`) rather than re-publishing the same version (immutable).
- Update `CHANGELOG.md` to reflect the rollback.
- Document the cause in the release notes.

## Versioning policy

- Patch: `0.6.N` (bug fixes, no breaking changes).
- Minor: `0.N.0` (additive features).
- Stable `1.0.0` requires the fork-Bun + `bun:browser` builtin path (`forks/bun/`) green E2E.
