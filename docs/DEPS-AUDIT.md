# DEPS-AUDIT — Bunlight dependency audit

Audit complet des dépendances de `@bunmium/bunlight@0.1.0-alpha.0` au **2026-05-10**.

Owner : `agent-deps-audit` (vague 5).
Tooling : `bun audit` / `bun outdated` / `bun pm ls` / `bun pm view` / Bun.Glob import scan.
Bun version : `1.3.14` (engines requires `>=1.3.0`).
Lockfile : `bun.lock` v1, 269 packages au total dans `node_modules/`.

---

## 1. Vulnerabilities

`bun audit` output :

```
bun audit v1.3.14-canary.1 (def56767)
No vulnerabilities found
```

**OK no CVEs found.** L'arbre transitif (269 packages) est clean au moment de l'audit. Aucune action requise.

| pkg | version | CVE | severity | fix version |
|---|---|---|---|---|
| n/a | n/a | n/a | n/a | n/a |

---

## 2. Outdated

`bun outdated` output :

| Package          | Current | Wanted | Latest | Type |
|------------------|---------|--------|--------|------|
| typescript (dev) | 5.9.3   | 5.9.3  | 6.0.3  | major |

Notes :

- `typescript 5.9.3 → 6.0.3` : bump **majeur** (semver risky). TS 6 introduit un nouveau résolver et durcit certains checks. À tester sur une branche dédiée — ne pas bumper aveuglément.
- Direct deps `browserforge@0.1.1`, `patchright@1.59.4`, `puppeteer-core@24.43.0`, `@biomejs/biome@2.4.15`, `@types/bun@1.3.13` : tous à la dernière version stable (patchright `latest=1.59.4`, browserforge `latest=0.1.1`).
- Aucun outdated mineur sur les directs.

Counts :

- Major outdated : **1** (typescript)
- Minor outdated : **0**
- Patch outdated : **0**

---

## 3. Deprecated

`bun install --dry-run` flagge un seul deprecated transitif :

- `util-deprecate@1.0.2` — package marqueur (utilitaire pour signaler des deprecations dans d'autres modules), pas réellement deprecated en tant que tel. Pulled transitivement par `puppeteer-core` ou un sous-dep. Aucune action requise (pas une vulnérabilité, le nom prête à confusion).

Aucun direct dep deprecated.

| dep | replacement |
|---|---|
| util-deprecate (transitive only) | n/a (faux positif sémantique) |

---

## 4. Unused

Scan via `Bun.Glob("**/*.{ts,js,tsx,mjs}")` excluant `node_modules`, `dist`, `vendor`, `forks`, `.git` :

| pkg | references | status |
|---|---|---|
| `browserforge` | 2 fichiers (commentaires uniquement) | **UNUSED — candidat à remove** |
| `patchright` | 13 imports réels | used |
| `puppeteer-core` | 5 imports/refs (benchmarks/runners + JSDoc) | used |
| `@biomejs/biome` | 0 imports (CLI tool, OK) | used via `biome.json` + scripts |
| `typescript` | 0 imports (compiler, OK) | used via `tsconfig.json` |
| `@types/bun` | 0 imports (ambient types, OK) | used implicitement |

### 4.1 `browserforge@0.1.1` — strong remove candidate

Vérifié 2× via Bun.Glob + grep pattern `^import|require\(` :

- `src/profiles/fingerprint.ts` : seule mention dans un **bloc commentaire** documentant l'origine de la logique (`fingerprint-generation logic originally provided by daijro/browserforge`).
- `src/profiles/max/index.ts` : seule mention dans un **bloc commentaire** (`Profile max — Camoufox v135 + browserforge fingerprinting + CapSolver Turnstile`).

Le commentaire de `src/profiles/fingerprint.ts` est explicite :

> The `browserforge` npm package on npm (v0.1.1) is an unrelated browser-session recorder tool; this module provides the actual fingerprint generation that the stealth/max profiles require.

`bun pm view browserforge@0.1.1` confirme :

- Description : "Browser session recorder and live viewer for AI agents" (par `hodlthedoor`).
- Pulls 7 deps lourdes : `@modelcontextprotocol/sdk`, `archiver`, `chrome-remote-interface`, `hono`, `sharp`, `stripe`, `ws`.
- C'est probablement `sharp` qui tire toute la famille `@img/sharp-*` visible dans le lockfile (libvips libs, ~10 plateformes).

Conclusion : `browserforge` est **squatté/homonyme** — le package npm n'est pas le projet daijro/browserforge dont la logique a été reimplémentée localement dans `src/profiles/fingerprint.ts`. La dep gonfle inutilement le tree (Stripe SDK, image processing, MCP runtime…) sans servir à rien.

Suggestion (à appliquer hors de cet audit, le user décide) :

```bash
# Suggestion only — le user décide
bun remove browserforge
# ou éditer package.json pour retirer "browserforge": "^0.1.1" puis bun install
```

Attendu : tree node_modules drastiquement réduit (drop sharp + libvips + stripe + hono + archiver + MCP SDK).

---

## 5. Recommendations (priorisées)

1. **(P1, low risk, high reward)** Retirer `browserforge@0.1.1` du `dependencies` — package homonyme non utilisé, pulls 7 deps lourdes (sharp/stripe/hono/MCP SDK) inutilement. Le code utilise sa propre implémentation locale dans `src/profiles/fingerprint.ts`. Gain : install ~×2 plus rapide, lockfile plus simple, surface CVE réduite.
2. **(P2, medium risk)** Ne **pas** bump `typescript 5.9 → 6.0` immédiatement. Attendre un cycle de stabilisation (≥1 mois post-release). Quand ready : créer branche `chore/ts6-bump`, lancer `bun test`, vérifier que `tsconfig.json strict` reste OK avec le nouveau résolver TS 6.
3. **(P3, recurring)** Mettre en place un check `bun audit` dans CI (e.g., GitHub Actions step) qui fail le build si `--audit-level=moderate`. Actuellement aucun CVE ; cette policy garantit qu'un futur CVE soit détecté avant merge.
4. **(P3, hygiene)** Pin les `devDependencies` `@biomejs/biome ^2.0.0` et `typescript ^5.9.0` avec un range plus serré (e.g., `~2.4.15` / `~5.9.3`) pour éviter qu'un `bun install` après suppression du lockfile ne pull TS 6 prématurément.
5. **(P4, optional)** Documenter l'usage de `puppeteer-core` (seulement référence type + runners de benchmark) — il est `peerDependency` `optional`, donc OK, mais le README pourrait clarifier qu'il n'est pas requis runtime sauf si l'utilisateur active certains chemins.

---

## 6. Bun version pinning

Actuel : `engines.bun` = `>=1.3.0`.

| version | raison du minimum |
|---|---|
| `>=1.3.0` | Requis pour `Bun.zstdDecompressSync` (HTTP profile decompression), `Bun.Cookie`/`Bun.CookieMap` API stable, `Bun.serve()` websocket avec `accept-ws` headers, `using` declarations dans `bun:sqlite`. Bun 1.2.x manque plusieurs de ces APIs ou les expose sous des shapes différentes. |

Recommandé : **garder** `>=1.3.0`. Ne pas baisser. Considérer `>=1.3.14` (current dev version) seulement si une feature 1.3.10+ devient critique — pour l'instant le minimum 1.3.0 est correct et maximise la compat.

Note : `bun audit v1.3.14-canary.1` indique que la machine actuelle utilise un canary, alors que `bun --version` reporte `1.3.14`. Ce delta est cosmétique (la version mineure de l'audit subcommand suit son propre cycle).

---

## Annexe A — Commandes exécutées

```bash
cd ~/bunmium/bunlight
bun audit                # No vulnerabilities found
bun outdated             # 1 major (typescript)
bun pm ls                # 269 packages, 6 directs
bun --version            # 1.3.14
bun pm view browserforge # confirmed homonym package
bun install --dry-run    # 1 deprecation warning (util-deprecate, transitive)
```

Scan imports :

```ts
const g = new Bun.Glob("**/*.{ts,js,tsx,mjs}");
const ignored = ["node_modules", "dist", "vendor", "forks", ".git"];
for await (const f of g.scan({ cwd: "." })) { /* grep deps */ }
```

Counts par dep direct : `browserforge=2 (comments only)`, `patchright=13`, `puppeteer-core=5`.

---

## Annexe B — Direct deps snapshot

```json
{
  "dependencies": {
    "browserforge": "^0.1.1",   // UNUSED — remove candidate
    "patchright": "^1.59.4"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "@types/bun": "latest",
    "puppeteer-core": "^24.43.0",
    "typescript": "^5.9.0"
  },
  "peerDependencies": {
    "puppeteer-core": ">=24.0.0"
  }
}
```
