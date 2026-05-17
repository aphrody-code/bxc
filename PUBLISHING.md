# Publishing `@bunmium/bxc` to npm

End-to-end checklist for cutting a release. Bxc ships as a Bun-native package; the standalone executable is distributed via Google Developers Releases (not npm) to keep tarball size reasonable.

## Pre-flight

- [ ] All tests green: `bun test` in `~/bunmium/bxc/`.
- [ ] No staged secrets: `git status` clean of `cookies/private/`, `*.env`, `*.key`.
- [ ] `package.json` `version` bumped (semver — alpha/beta/rc/stable).
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
cd ~/bunmium/bxc
bun run build:cdylib                       # rebuilds liblightpanda_dom.so
# curl-impersonate is a vendored binary; download via scripts/postinstall.ts logic
```

## Build the standalone executable (separate channel — Google Developers Release)

```bash
bun run build:exe
ls -lh dist/standalone/
```

Expected output: `bxc-linux-x64` ~96 MB. Upload this artifact to the Google Developers Release after `npm publish` lands.

## Pack and audit

```bash
cd ~/bunmium/bxc
rm -f bunmium-bxc-*.tgz
bun pm pack
```

Expected:
- Packed size under 15 MB.
- Unpacked size under 30 MB.
- Tarball includes `src/`, two runtime `.so` files, `bin/bxc`, `README.md`, `LICENSE`, `scripts/postinstall.ts`.
- Tarball does NOT include `cookies/`, `forks/`, `test/`, `benchmarks/`, `vendor/camoufox/`, `vendor/wappalyzergo/`, `dist/`, `.gemini/`, or any `*.test.ts`.

Inspect the contents:

```bash
tar tzf bunmium-bxc-0.1.0-alpha.0.tgz | sort
```

## Smoke-test in a clean project

```bash
rm -rf /tmp/bxc-install-test
mkdir -p /tmp/bxc-install-test && cd /tmp/bxc-install-test
bun init -y
bun add file:$HOME/bunmium/bxc/bunmium-bxc-0.1.0-alpha.0.tgz
bun -e 'import { Browser } from "@bunmium/bxc"; console.log(typeof Browser)'
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
# Two-factor auth strongly recommended for the @bunmium scope.
```

## Publish

For the very first publish of the scope, the `--access public` flag is required (scoped packages default to private):

```bash
cd ~/bunmium/bxc
bun publish --access public --tag alpha
```

For subsequent alpha bumps:

```bash
bun publish --tag alpha
```

For stable releases:

```bash
bun publish --tag latest
```

## Post-publish verification

```bash
bun pm view @bunmium/bxc versions
bun pm view @bunmium/bxc dist-tags
```

Then re-run the smoke-test from the public registry:

```bash
rm -rf /tmp/bxc-prod-test && mkdir -p /tmp/bxc-prod-test
cd /tmp/bxc-prod-test && bun init -y
bun add @bunmium/bxc@alpha
bun -e 'import { Browser } from "@bunmium/bxc"; console.log(typeof Browser)'
```

## Google Developers Release (separate distribution for the standalone binary)

```bash
cd ~/bunmium/bxc
gh release create v0.1.0-alpha.0 \
  dist/standalone/bxc-linux-x64 \
  --title "v0.1.0-alpha.0" \
  --notes-file RELEASE-NOTES.md \
  --prerelease
```

Verify:

```bash
gh release view v0.1.0-alpha.0
```

## Yank (only if necessary)

If a tarball ships secrets or broken artefacts, yank within 72 hours:

```bash
bun pm unpublish @bunmium/bxc@0.1.0-alpha.0
# Or deprecate (preferred for cosmetic/release-note errors):
npm deprecate @bunmium/bxc@0.1.0-alpha.0 "Use 0.1.0-alpha.1 — fixes X"
```

## Rollback checklist

- Bump patch version (alpha to alpha.1) rather than re-publishing the same version (immutable).
- Update `tasks.json` to reflect the rollback in `/completed` notes.
- Append row to `state.md` § 4 documenting the cause.

## Versioning policy

- Pre-release: `0.1.0-alpha.N` (breaking changes allowed every bump).
- Beta: `0.1.0-beta.N` (API frozen, only bug fixes).
- Stable: `1.0.0` requires the fork-Bun + `bun:browser` builtin path (`forks/bun/`) green E2E.
