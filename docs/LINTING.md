# Linting & Formatting — Bunlight

Bunlight uses **Biome 2.x** (Rust-native, single binary) as the unified linter and formatter, replacing the legacy ESLint + Prettier combo. Biome is shipped as a dev dependency (`@biomejs/biome ^2.0.0`) and runs in well under one second across the whole codebase.

## Synopsis

| Tool | Role |
|---|---|
| **Biome `check`** | Lint + format + import-organize in one pass |
| **Biome `format`** | Format only (no lint diagnostics) |
| **Biome `lint`** | Lint only |

Configuration files:

- `biome.json` — schema-validated config (rules, formatter, overrides)
- `.biomeignore` — path globs excluded from all Biome operations

## How to run

```bash
# Lint + format check (no writes) — what CI runs
bun run lint

# Lint + format AND auto-apply safe fixes
bun run lint:fix

# Format only (rewrites files in place)
bun run format
```

The `lint` script targets `src test examples scripts`. The `benchmarks` tree is part of `biome.json` `files.includes` but is excluded from the npm scripts to keep iteration loops short. Run `bunx biome check benchmarks` if you want to sweep it explicitly.

## Configuration highlights

### Formatter

- `indentStyle: tab` (matches the rest of the workspace)
- `lineWidth: 100`
- `quoteStyle: double`, `semicolons: always`, `trailingCommas: all`

### Linter — recommended rules + custom overrides

| Rule | Severity | Rationale |
|---|---|---|
| `suspicious/noExplicitAny` | error | Workspace rule: TypeScript strict, no `any` (use `unknown` + narrowing) |
| `suspicious/noConsole` | warn (with `warn`/`error`/`info` allowed) | Plain `console.log` is forbidden in `src/` and `test/`; opt-in for ops/diagnostic levels |
| `style/useNodejsImportProtocol` | error | Force `node:fs` style imports — aligns with the workspace Bun-native rule that flags any `node:*` use for review |
| `style/useImportType` | error | Avoid runtime side-effects from type-only imports |

### Overrides

`scripts/`, `benchmarks/`, and `examples/` disable `noConsole` — these are CLI tools and demos where `console.log` output is the product.

### Ignored paths

`vendor/`, `dist/`, `node_modules/`, `storage/`, `cookies/private/`, `benchmarks/results/`, `forks/`, `.claude/`. Note that `cookies/private/*` contains live `cf_clearance`/`session_production` tokens and must never be linted, formatted, or committed.

## Auto-fix workflow

Biome distinguishes **safe** fixes (semantically equivalent) from **unsafe** fixes (may change behaviour, e.g. `noConsole`).

```bash
# Apply only safe fixes
bun run lint:fix

# Apply unsafe fixes too (review the diff carefully)
bunx biome check --write --unsafe src test examples scripts
```

Recommended flow on a fresh branch:

1. `bun run lint:fix` — Biome rewrites imports, formats, and applies safe rule fixes.
2. Review the diff (`git diff`).
3. `bun test` — confirm nothing regressed.
4. Commit `chore(lint): apply biome safe fixes`.

## Current baseline (snapshot 2026-05-10)

Run on the codebase as-shipped (no auto-fix yet applied):

```
Checked 65 files in 79ms
46 errors, 98 warnings, 39 infos
```

Top issue categories:

| Category | Count | Notes |
|---|---|---|
| `style/noNonNullAssertion` | 48 | `x!` non-null assertions — replace with explicit narrowing or `??` |
| `suspicious/noConsole` | 40 | `console.log` in `src/`/`test/` — switch to `console.warn`/`info` or remove |
| `complexity/useLiteralKeys` | 26 | `obj["key"]` where `obj.key` is preferred |
| `style/useTemplate` | 12 | String concat where a template literal is clearer |
| `correctness/noUnusedVariables` | 5 | Dead bindings |

These are the existing baseline; this configuration setup task did **not** auto-fix code. Run `bun run lint:fix` in a dedicated cleanup PR to apply safe fixes.

## Editor integration

- **VS Code** — install the `biomejs.biome` extension; it auto-discovers `biome.json`.
- **Neovim** — `nvim-lspconfig` ships a `biome` server config.
- **Bun watch** — `bunx biome check --watch src` while iterating.

## Why Biome (vs ESLint + Prettier)

- One binary, one config, zero plugin dependency tree.
- 10x to 100x faster than ESLint on the same ruleset.
- Built-in import organization (no `eslint-plugin-import`).
- Native TypeScript awareness (no `@typescript-eslint/parser`).

## References

- Biome configuration: https://biomejs.dev/configuration/
- Biome rule index: https://biomejs.dev/linter/rules/
- Bun-native API rules in this workspace: `~/bunmium/CLAUDE.md` section 3.1
