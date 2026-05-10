# Publishing Bunlight

This document covers the dual-registry publication process for `@aphrody-code/bunlight`.

The package is published to two registries simultaneously:

- **GitHub Packages** (primary, scoped) at `https://npm.pkg.github.com`
- **npm public registry** at `https://registry.npmjs.org`

CI handles publication automatically on tag push. This document explains manual publication and the token setup required.

---

## Package identity

| Field | Value |
|---|---|
| npm name | `@aphrody-code/bunlight` |
| GitHub org | `aphrody-code` |
| Repository | `https://github.com/aphrody-code/bunlight` |
| License | 0BSD |

---

## Token setup

### GitHub token (GH_TOKEN)

1. Go to `https://github.com/settings/tokens/new` (classic token).
2. Select scopes: `repo`, `write:packages`, `read:packages`.
3. Set expiration to a reasonable period (90 days recommended).
4. Copy the token value.

For CI: add as repository secret named `GITHUB_TOKEN` (already available in Actions) or as `GH_TOKEN` for the publish script.

### npm token (NPM_TOKEN)

1. Log in at `https://www.npmjs.com`.
2. Go to `https://www.npmjs.com/settings/<username>/tokens/new`.
3. Token type: **Automation**.
4. Access: **Read and Publish**.
5. Copy the token value.

For CI: add as repository secret named `NPM_TOKEN`.

### Local .npmrc

Copy `.npmrc.example` from the workspace root and fill in your tokens:

```bash
cp ~/bunmium/.npmrc.example ~/bunmium/bunlight/.npmrc
# edit .npmrc and replace ${GH_TOKEN} / ${NPM_TOKEN} with real values
```

The `.npmrc` file is gitignored. Never commit it.

---

## Manual publish (from your machine)

Use `scripts/publish.ts` for a guided release:

```bash
cd ~/bunmium/bunlight

# Set tokens
export GH_TOKEN=ghp_...
export NPM_TOKEN=npm_...

# Bump patch version (0.1.0 -> 0.1.1), run tests, tag, publish both registries
bun scripts/publish.ts patch

# Bump minor (0.1.0 -> 0.2.0)
bun scripts/publish.ts minor

# Bump major (0.1.0 -> 1.0.0)
bun scripts/publish.ts major

# Publish current version without bumping (re-publish / fix a botched release)
bun scripts/publish.ts
```

The script:

1. Verifies `GH_TOKEN` and `NPM_TOKEN` are set.
2. Asserts the git working tree is clean.
3. Bumps `package.json` version (when a bump kind is given).
4. Runs `bun test` and aborts on failure.
5. Commits `package.json` and creates a `vX.Y.Z` git tag.
6. Publishes to GitHub Packages with up to 3 retries.
7. Publishes to npm with up to 3 retries.
8. Pushes the tag to `origin`.

---

## CI publish (GitHub Actions)

The workflow at `.github/workflows/publish.yml` runs on every `v*` tag push and on `workflow_dispatch`.

Jobs:

1. `publish-github-packages` - installs deps, runs tests, writes an ephemeral `.npmrc`, calls `bun publish --access public`. Uses the built-in `GITHUB_TOKEN` secret (no setup needed).
2. `publish-npm` - depends on job 1, writes an ephemeral `.npmrc` with `NPM_TOKEN`, calls `bun publish --access public --registry https://registry.npmjs.org`.

The `NPM_TOKEN` secret must be added manually in the repository settings under **Settings > Secrets and variables > Actions**.

To trigger a release from CI:

```bash
# From a clean, tagged commit
git tag v0.2.0
git push origin v0.2.0
```

---

## Verifying a published release

```bash
# From GitHub Packages
npm view @aphrody-code/bunlight --registry https://npm.pkg.github.com

# From npm public
npm view @aphrody-code/bunlight

# Install from GitHub Packages (requires GH_TOKEN in .npmrc)
npm install @aphrody-code/bunlight --registry https://npm.pkg.github.com

# Install from npm (public, no token needed)
npm install @aphrody-code/bunlight
```

---

## Plugin Claude (not a separate npm package)

The Claude Code plugin lives inside the `bunlight` package under `.claude/` and `.claude-plugin/`. It is not published as a separate npm package.

To use it:

```bash
# Option 1: load from the installed package path
claude --plugin-dir $(npm root -g)/@aphrody-code/bunlight

# Option 2: copy skills/agents to your ~/.claude directory
cp -r node_modules/@aphrody-code/bunlight/.claude/skills/bunlight ~/.claude/skills/
cp -r node_modules/@aphrody-code/bunlight/.claude/agents/*.md ~/.claude/agents/
```

---

## agent-browser (Rust crate)

The `~/bunmium/agent-browser/` directory is a fork of `vercel-labs/agent-browser`. Its root `package.json` has `name: "agent-browser"` and no `@aphrody-code` scope configured because:

- The package is a monorepo wrapper over a Rust CLI binary (`cli/Cargo.toml`).
- The CLI binary is distributed as a platform-specific native executable, not a scoped npm package.
- Publishing scope configuration is deferred until the PR to upstream `vercel-labs/agent-browser` is accepted and the fork is stabilised under a permanent GitHub org.

When ready to publish `agent-browser` under `@aphrody-code`, add the following to `~/bunmium/agent-browser/package.json`:

```json
"name": "@aphrody-code/agent-browser",
"publishConfig": {
  "access": "public",
  "registry": "https://npm.pkg.github.com"
},
"repository": {
  "type": "git",
  "url": "git+https://github.com/aphrody-code/agent-browser.git"
}
```

---

## Troubleshooting

### 401 Unauthorized on GitHub Packages

Verify `GH_TOKEN` has `write:packages` scope. The token must belong to an account that is a member of the `aphrody-code` GitHub organisation (or is the owner).

### 403 Forbidden on npm

Verify `NPM_TOKEN` is an **Automation** token with **Publish** access. If the package was never published before, you may need to run `npm publish` manually the first time with `--access public`.

### `bun publish` exits with "tag already exists"

The version in `package.json` is already published. Bump the version before publishing:

```bash
bun scripts/publish.ts patch
```

### Tests fail during publish

Fix the failing tests before publishing. The publish script will not proceed past a test failure. To skip tests in an emergency (not recommended):

```bash
# Manually: skip the publish script and run bun publish directly
echo "@aphrody-code:registry=https://npm.pkg.github.com" > .npmrc
echo "//npm.pkg.github.com/:_authToken=${GH_TOKEN}" >> .npmrc
bun publish --access public
rm .npmrc
```

### .npmrc accidentally committed

Rotate your tokens immediately at:

- `https://github.com/settings/tokens` (GH_TOKEN)
- `https://www.npmjs.com/settings/<username>/tokens` (NPM_TOKEN)

Then remove the file from git history using `git filter-repo` or `BFG Repo Cleaner`.
