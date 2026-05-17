---
name: bxc
description: Orchestre le rebrand "bunlight" → "bxc" (Bun × Chrome) sur le monorepo. Re-scan, backup, apply, validate, commit. À invoquer quand l'utilisateur demande "rebrand", "rename bxc", "/bxc apply", "passe en bxc", ou tout cutover vers le nom court. Lit reports/scan-v1-bash.json + reports/scan-v2-bun.json. Refuse de tourner si le worktree est dirty.
disable-model-invocation: true
---

# bxc — rebrand bunlight → bxc

`bxc` = **B**un × **C**hrome. Court, prononçable ("box"), libre sur npm. Cette skill
orchestre le rebrand complet sur le monorepo `bunlight` vers `bxc`.

## Pré-requis

- Worktree propre (`git diff --quiet HEAD`).
- Backup local créé (`scripts/backup-bunlight.sh` → tarball + bundle git hors repo).
- `reports/scan-v2-bun.json` à jour (relancer si plus vieux que 1h).
- Branche dédiée : toujours sur `rebrand/bxc`, jamais sur `main`.

## Axes du rebrand (référence rapide)

| Axe | Source | Cible | Exemples typiques |
|---|---|---|---|
| `npm_scope` | `@aphrody-code/bunlight` | `@aphrody-code/bxc` | `package.json`, imports TS |
| `ffi` | `libbunlight`, `libbunlight_rust_bridge` | `libbxc`, `libbxc_rust_bridge` | `src/rust/bridge.ts`, `Cargo.toml` |
| `path` | `.bunlight/` | `.bxc/` | cache dirs, `.gitignore` |
| `SCREAMING` | `BUNLIGHT_` | `BXC_` | env vars, constants |
| `Pascal` | `Bunlight` | `Bxc` | doc, class/type names |
| `snake` | `bunlight_` | `bxc_` | Rust symbols, FFI |
| `kebab` | `bunlight` | `bxc` | tout le reste (1097 hits) |

L'ordre dans `scripts/scan-bunlight-refs.ts` `AXES` est strict — `npm_scope` / `ffi` /
`path` doivent matcher AVANT `kebab`, sinon collisions.

## Risk tiers (issus du scan v2)

- **`safe`** (239 fichiers, 1131 matches) : substitution texte directe.
- **`manual_review`** (8 fichiers, 78 matches) : Rust crate (`Cargo.toml` + `lib.rs`),
  installers (`install.sh`, `install.ps1`), `package.json` workspaces (le rename ripple
  sur `bun.lock`). Toujours valider à la main.
- **`keep`** (6 fichiers, 394 matches) : benchmarks historiques, CHANGELOG, lockfile
  régénéré. **Ne pas toucher.**

## Workflow

### 1. Refresh scan (toujours)

```bash
bash scripts/scan-bunlight-refs.sh
bun scripts/scan-bunlight-refs.ts
```

Vérifier que `summary.by_risk.safe.file_count` n'a pas explosé. Si > 250 fichiers safe,
investiguer (probable nouveau code à scope, ou regex à corriger).

### 2. Backup obligatoire

```bash
scripts/backup-bunlight.sh   # crée ~/bunlight-backup-<UTC>.tar.zst + .gitbundle
```

Ne PAS continuer si ce script échoue.

### 3. Branche dédiée

```bash
git switch -c rebrand/bxc
```

### 4. Apply renames safe (texte)

Pour chaque fichier `risk: safe` du JSON v2, dans l'ordre d'axe (npm_scope → ffi →
path → SCREAMING → Pascal → snake → kebab) :

```bash
# Pseudo-code — `scripts/apply-bxc-rebrand.ts` à écrire après checkpoint utilisateur.
# Pour chaque axe, pour chaque file safe :
#   sed -i "s/<from>/<to>/g" "$file"
# Vérifier après chaque axe : bun run typecheck && bun run lint
```

### 5. Apply manual_review (un par un)

Pour les 8 fichiers `manual_review`, vérifier chaque diff. Cas spécifiques :

- `rust-bridge/Cargo.toml` : rename `name = "bunlight_rust_bridge"` + cohérence `[lib]`.
- `rust-bridge/src/lib.rs` : exports C ABI `bunlight_*` → `bxc_*`. Vérifie que les
  appels FFI depuis `src/rust/bridge.ts` matchent.
- `install.sh` / `install.ps1` : chemins `~/.bunlight/` → `~/.bxc/`, binaire `bunlight`
  → `bxc`, URLs de release GitHub `bunlight` → `bxc`.
- `package.json` racine + workspaces : `@aphrody-code/bunlight` → `@aphrody-code/bxc`.
  Re-run `bun install` pour propager la lockfile.

### 6. File / directory renames (git mv)

12 cibles du JSON v2 (`rename_targets`), à appliquer après le texte :

```bash
git mv bin/bunlight bin/bxc
git mv bunlight-memory.sqlite bxc-memory.sqlite   # si tracké
git mv scripts/scan-bunlight-refs.sh scripts/scan-bxc-refs.sh
git mv scripts/scan-bunlight-refs.ts scripts/scan-bxc-refs.ts
git mv scripts/deploy/bunlight.service scripts/deploy/bxc.service
git mv benchmarks/runners/bunlight-static.ts benchmarks/runners/bxc-static.ts
git mv benchmarks/runners/bunlight-fast.ts benchmarks/runners/bxc-fast.ts
git mv .claude/agents/bunlight-scrape-debugger.md .claude/agents/bxc-scrape-debugger.md
# packages/bunlight-extension/ → packages/bxc-extension/ : git mv du dossier
```

### 7. Validation hard gate

```bash
bun install                # propage le rename npm
bun run lint               # 0 warning, 0 error
bun run typecheck          # 0 error
bun test test/unit/ test/cdp/ test/scrapers/   # subset stable
cd packages/bunlight-extension && bun run build   # smoke compile
```

Si un seul check échoue → `git restore .` et investiguer.

### 8. Commits atomiques (un par axe)

Préférer 7 commits (un par axe) à un seul commit massif — chaque commit doit faire
passer le CI tout seul, pour permettre `git bisect` plus tard :

```
feat(rebrand): axis npm_scope — @aphrody-code/bunlight → @aphrody-code/bxc
feat(rebrand): axis ffi — libbunlight → libbxc + Rust symbols
feat(rebrand): axis path — .bunlight/ → .bxc/
feat(rebrand): axis SCREAMING — BUNLIGHT_* → BXC_*
feat(rebrand): axis Pascal — Bunlight → Bxc
feat(rebrand): axis snake — bunlight_ → bxc_
feat(rebrand): axis kebab — bunlight → bxc (final sweep)
feat(rebrand): rename files + directories (git mv)
```

### 9. Push + nouveau repo GitHub

```bash
git push origin rebrand/bxc
gh repo create aphrody-code/bxc --private --source=. --remote=bxc-origin
git push bxc-origin rebrand/bxc:main
```

L'ancien `aphrody-code/bunlight` reste intact (read-only) pendant la transition.

### 10. Disque + VPS (out of scope skill)

Le rename sur disque (`/home/ubuntu/bunlight` → `/home/ubuntu/bxc`), les autres repos
GitHub qui référencent bunlight, et les services VPS (systemd unit, alias bash,
`~/.bunlight/`) sont gérés par `scripts/rename-disk-vps.sh` (à écrire après le repo
GitHub OK).

## Garde-fous

- **Jamais sur `main`** — toujours `rebrand/bxc`.
- **Jamais sans backup** — `scripts/backup-bunlight.sh` est non-négociable.
- **Jamais sur `vendor/`** — le scan v2 le skip déjà, mais vérifier qu'aucun `sed`
  manuel ne traverse `vendor/`.
- **Tests obligatoires entre chaque axe** — `bun test test/unit/` minimum.
- **Workflow Bun publish à figer** : tant que le rename n'est pas merge sur main, ne
  PAS pousser de tag `v*` (le workflow publish.yml publierait sous l'ancien nom).
