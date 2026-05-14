# Contributing to Bunlight

Thank you for your interest in contributing to Bunlight. This document explains how to set up the development environment, follow code style conventions, run tests, and submit changes.

---

## Table of contents

1. [Prerequisites](#prerequisites)
2. [Development environment setup](#development-environment-setup)
3. [Code style](#code-style)
4. [Tests](#tests)
5. [Commit conventions](#commit-conventions)
6. [Pull request workflow](#pull-request-workflow)
7. [Issue reporting](#issue-reporting)
8. [Security](#security)

---

## Prerequisites

- **Bun** >= 1.3.0 — install from https://bun.sh
- **Biome** >= 2.0.0 (installed as devDependency, no global install needed)
- **Zig** >= 0.13 — required only if rebuilding `liblightpanda_dom.so`
- **curl-impersonate** vendor binary — downloaded automatically by postinstall

Optional, needed for stealth/max profiles:

- Chromium (via `bunx patchright install chromium`)
- Firefox (via `bunx patchright install firefox`)

---

## Development environment setup

```bash
git clone https://github.com/bunmium/bunlight.git
cd bunlight

# Install dependencies and run postinstall (downloads vendor binaries)
bun install

# Verify the vendor binaries are present
ls vendor/zigquery-wrapper/zig-out/lib/liblightpanda_dom.so
ls vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0

# Run the full test suite
bun test
```

The `postinstall` script (`scripts/postinstall.ts`) downloads platform-specific vendor binaries (Linux x64/arm64, macOS x64/arm64). It is idempotent and CI-aware: it skips when binaries are already present and never blocks `bun install` on failure.

### Rebuilding vendor binaries (advanced)

If you need to rebuild the zigquery cdylib from source:

```bash
bun run build:cdylib
```

To rebuild the standalone CLI executable:

```bash
bun run build:exe
```

---

## Code style

All code in this repository follows strict rules enforced by Biome and the workspace hooks.

### TypeScript

- `strict: true` in `tsconfig.json`. No `any` — use `unknown` with narrowing.
- Explicit return types on public API functions.
- Explicit file extensions in imports: `import { x } from "./module.ts"` not `"./module"`.
- No `node:fs`, `node:child_process`, `node:http`. Use Bun-native equivalents:

| Instead of | Use |
|---|---|
| `fs.readFileSync` | `await Bun.file(p).text()` |
| `fs.writeFileSync` | `await Bun.write(p, data)` |
| `child_process.spawn` | `Bun.spawn([cmd, ...args])` |
| `child_process.exec` | `` Bun.$`cmd ${arg}` `` |
| `http.createServer` | `Bun.serve({ fetch })` |
| `node:crypto` simple hash | `Bun.hash` or `Bun.CryptoHasher` |
| `glob` npm package | `Bun.Glob(pat).scan({ cwd })` |
| `sqlite3` npm package | `bun:sqlite` |

Exception: `node:zlib.brotliDecompressSync` is permitted because Bun does not expose brotli decompression yet. Document such exceptions with an inline comment referencing the Bun issue.

### Formatting

Run Biome before committing:

```bash
bun run format
bun run lint
```

Biome is configured in `biome.json`. The pre-commit hook will reject files that fail linting.

### Naming conventions

- `kebab-case` for file names and CLI flags.
- `camelCase` for TypeScript variables and functions.
- `PascalCase` for classes and types.
- No emojis in code, documentation, or CLI output.
- No double-dash `--` in prose — use an emdash `—` or rewrite the sentence.

---

## Tests

The project uses `bun:test` exclusively. Never use jest, vitest, or mocha.

```bash
# Run all tests
bun test

# Run a single file
bun test test/integration/spa-fast.test.ts

# Run tests matching a pattern
bun test --test-name-pattern "curl"
```

### Rules

- At least one test per new feature or bug fix.
- Tests that require network access must check connectivity first and skip cleanly if offline:

  ```typescript
  import { test, describe, expect } from "bun:test";

  const isOnline = await fetch("https://example.com", { method: "HEAD" })
    .then(() => true)
    .catch(() => false);

  describe.skipIf(!isOnline)("network tests", () => {
    test("...", async () => { ... });
  });
  ```

- Tests that require vendor binaries must skip if the binary is absent:

  ```typescript
  const hasBinary = await Bun.file("vendor/curl-impersonate/libcurl-impersonate-chrome.so.4.8.0").exists();
  test.skipIf(!hasBinary)("curl-impersonate test", () => { ... });
  ```

- Never skip silently. Always pass a reason string to `skipIf` or log with `console.warn`.
- Integration tests go under `test/integration/<name>.test.ts`.
- Unit tests go under `test/unit/<name>.test.ts`.

---

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>
```

Types:

| Type | When to use |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `chore` | Build, tooling, dependency update |
| `docs` | Documentation only |
| `test` | Tests only, no production code change |
| `refactor` | Code restructure without behavior change |
| `perf` | Performance improvement |
| `ci` | CI/CD configuration |

Examples:

```
feat(profile): add http/2 fingerprint support to curl-impersonate profile
fix(zigquery): handle null pointer in getAttribute binding
chore: update Biome to 2.1.0
docs(profiles): document stealth profile retry strategy
test(pool): add concurrent page eviction tests
```

Scope examples: `profile`, `zigquery`, `pool`, `queue`, `cookie`, `cli`, `mcp`, `detect`, `transport`, `ffi`, `docs`.

**Never commit:**

- `cookies/private/*` — contains session tokens and cf_clearance values
- `*.env`, `*.key`, credentials of any kind
- `node_modules/`, `forks/bun/build/`, `vendor/*` without documented justification
- Binary artifacts that should be downloaded by `postinstall`

---

## Pull request workflow

1. Fork the repository on GitHub.
2. Create a branch from `main`:
   ```bash
   git checkout -b feat/my-feature
   ```
3. Make changes following the code style and test rules above.
4. Run the full test suite and linter before pushing:
   ```bash
   bun test && bun run lint
   ```
5. Push your branch and open a pull request against `main`.
6. Fill in the pull request template completely.
7. Address review comments. Maintainers may request changes before merging.

Branch naming: `feat/<area>-<short>` or `fix/<area>-<short>`. Examples: `feat/pool-backpressure`, `fix/zigquery-null-deref`.

---

## Issue reporting

Use the issue templates in `.github/ISSUE_TEMPLATE/`:

- **Bug report** — for unexpected behavior or errors
- **Feature request** — for new capabilities
- **Profile issue** — for profile-specific bypass or detection failures

See [SECURITY.md](./SECURITY.md) for vulnerability disclosure.
