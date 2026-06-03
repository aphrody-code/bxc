# Publishing `@aphrody/bxc` to npm

End-to-end checklist for cutting a release. Bxc ships as a Bun-native package; the standalone executable is distributed via GitHub Releases (not npm) to keep tarball size reasonable.

Publishing is automated: pushing a `v*` tag triggers `.github/workflows/publish.yml`, which installs, lints, and runs `bun publish --access public --registry https://registry.npmjs.org`. The steps below document the equivalent manual flow and the pre-flight checks.

## Pre-flight

- [ ] All tests green: `bun test` in the repo (`/home/ubuntu/bxc/`).
- [ ] No staged secrets: `git status` clean of `cookies/private/`, `*.env`, `*.key`.
- [ ] `package.json` `version` bumped (semver — current line is `0.6.x`).
- [ ] `CHANGELOG.md` updated (or release notes drafted).
- [ ] Cross-check `package.json#files` against `.npmignore` — defense in depth.
- [ ] `bun outdated` reviewed for security advisories.

## Build the runtime artifacts

The package ships these binaries (must exist before pack):

```
vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so   # 1.7 MB cdylib (DOM)
vendor/curl-impersonate/libcurl-impersonate.so.4.8.0       # 25 MB TLS fingerprint
vendor/curl-impersonate/libcurl-impersonate.so             # symlink
vendor/curl-impersonate/libcurl-impersonate.so.4           # symlink
```

If absent, rebuild:

```bash
cd /home/ubuntu/bxc
bun run build:cdylib                       # rebuilds liblightpanda_dom.so
# curl-impersonate is a vendored binary; download via scripts/postinstall.ts logic
```

## Build the standalone executable (separate channel — GitHub Release)

```bash
bun run build:exe
ls -lh dist/standalone/
```

Expected output: `bxc-linux-x64` ~96 MB. Upload this artifact to the GitHub Release after `npm publish` lands.

## Pack and audit

```bash
cd /home/ubuntu/bxc
rm -f aphrody-bxc-*.tgz
bun pm pack
```

Expected:
- Packed size under 15 MB.
- Unpacked size under 30 MB.
- Tarball includes `src/`, two runtime `.so` files, `bin/bxc`, `README.md`, `LICENSE`, `scripts/postinstall.ts`.
- Tarball does NOT include `cookies/`, `forks/`, `test/`, `benchmarks/`, `vendor/camoufox/`, `vendor/wappalyzergo/`, `dist/`, `.gemini/`, or any `*.test.ts`.

Inspect the contents:

```bash
tar tzf aphrody-bxc-0.6.4.tgz | sort
```

## Smoke-test in a clean project

```bash
rm -rf /tmp/bxc-install-test
mkdir -p /tmp/bxc-install-test && cd /tmp/bxc-install-test
bun init -y
bun add file:/home/ubuntu/bxc/aphrody-bxc-0.6.4.tgz
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

CI publishes automatically on a `v*` tag push (`.github/workflows/publish.yml`). For a manual publish, scoped packages need `--access public` (already set via `publishConfig.access` in `package.json`):

```bash
cd /home/ubuntu/bxc
bun publish --access public --registry https://registry.npmjs.org
```

For pre-release channels (alpha/beta/rc), add `--tag`:

```bash
bun publish --access public --tag next --registry https://registry.npmjs.org
```

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
gh release create v0.6.4 \
  dist/standalone/bxc-linux-x64 \
  --title "v0.6.4" \
  --notes-file RELEASE-NOTES.md
```

Verify:

```bash
gh release view v0.6.4
```

## Yank (only if necessary)

If a tarball ships secrets or broken artefacts, yank within 72 hours:

```bash
bun pm unpublish @aphrody/bxc@0.6.4
# Or deprecate (preferred for cosmetic/release-note errors):
npm deprecate @aphrody/bxc@0.6.4 "Use 0.6.5 — fixes X"
```

## Rollback checklist

- Bump patch version (`0.6.4` to `0.6.5`) rather than re-publishing the same version (immutable).
- Update `CHANGELOG.md` to reflect the rollback.
- Document the cause in the release notes.

## Versioning policy

- Patch: `0.6.N` (bug fixes, no breaking changes).
- Minor: `0.N.0` (additive features).
- Stable `1.0.0` requires the fork-Bun + `bun:browser` builtin path (`forks/bun/`) green E2E.
