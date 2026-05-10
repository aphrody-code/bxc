# Licensing

## TL;DR

- **Bunlight glue code** (this repo, all files except `vendor/`) : MIT
- **Lightpanda** (vendored as submodule + linked statically) : AGPL-3.0
- **Combined distributed binary** : AGPL-3.0
- **Library use in your own code without distribution** : MIT terms apply to your usage

## Détail

### Code dans ce repo

Tout le code dans `src/`, `scripts/`, `test/`, `examples/`, `benchmarks/`, `docs/` est sous licence **MIT** (voir `LICENSE`). Tu peux le réutiliser, le forker, le redistribuer librement.

### Lightpanda

Lightpanda (`vendor/lightpanda/`, lien vers `lightpanda-io/browser`) est sous **AGPL-3.0**. Cette licence est "copyleft fort" :
- Toute distribution d'un binaire qui inclut Lightpanda doit fournir le code source
- Si tu fournis Bunlight comme service réseau, tes utilisateurs ont droit au code source

### Combined binary

Quand `bun bd` produit un binaire qui inclut Lightpanda statiquement (Phase 3+), ce binaire est dérivé de Lightpanda et donc **AGPL-3.0**. Si tu distribues ce binaire (release GitHub, déploiement à un client externe), tu dois :
1. Publier le code source modifié (de Bunlight et de Lightpanda)
2. Inclure la licence AGPL-3.0 avec le binaire
3. Si le binaire est utilisé pour fournir un service réseau, tes utilisateurs réseau ont droit au code source

### Library use

Si tu utilises Bunlight comme library dans ton propre projet **sans distribuer le binaire** (par exemple : tu l'utilises pour scraper en interne, ou pour un service que tu opères toi-même sans externaliser le binaire), aucune obligation de partage. C'est le cas standard d'utilisation.

### Compat AGPL avec MIT

Le code MIT de Bunlight est compatible avec AGPL-3.0 (MIT est plus permissif). Le binaire combiné prend la licence la plus restrictive — AGPL-3.0.

### Alternative pour usage commercial fermé

Si tu veux distribuer un produit propriétaire qui inclut Bunlight, contacte Lightpanda (https://lightpanda.io) pour obtenir une licence commerciale. Ils proposent une **dual license** : AGPL-3.0 par défaut, ou licence commerciale moyennant paiement.

### Licences des autres dépendances

- **Bun** (`oven-sh/bun`) : MIT
- **V8** (vendored par Lightpanda dans `lightpanda-io/zig-v8-fork`) : BSD-3-Clause
- **html5ever** (vendored par Lightpanda) : MIT/Apache-2.0
- **Puppeteer** (peer dep optionnelle) : Apache-2.0
- **JavaScriptCore** (vendored dans Bun via WebKit) : LGPL-2.1 (avec exception pour link statique)

Aucun conflit ; tous compatibles avec AGPL-3.0 ou MIT.
