<!-- SPDX-License-Identifier: Apache-2.0 -->
# Instructions agents — site BXC

Toute évolution publique de BXC doit inclure une vitrine 100 % Rust pour
`bxc.aphrody.com`.

- Créer une crate workspace `bxc-site`, `publish = false`, sous `rust-bridge/crates/`.
- Utiliser Axum 0.8, Tokio 1.x, Tower et rustls ; aucun serveur Bun/Node pour la vitrine.
- Écouter uniquement sur `127.0.0.1:8084`, derrière nginx et TLS.
- La vitrine décrit uniquement les capacités publiques vérifiables de BXC et
  renvoie vers les releases publiques. Aucune donnée personnelle, session,
  cookie, credential, chemin machine ou donnée de crawl ne doit être publiée.
- Fournir `/healthz`, `/robots.txt` et `/.well-known/security.txt`.
- Le port CDP `9222`, les crawlers, profils, cookies et transports MCP internes
  restent privés. Une future API publique doit être versionnée sous `/api/v1/`,
  authentifiée et séparée de CDP.
- Ajouter tests de routes, Clippy sans avertissement, build release Linux et
  documentation de déploiement avant d'activer nginx.

Le DNS et le TLS de `bxc.aphrody.com` sont déjà réservés par le dépôt Aphrody ;
tant que `bxc-site` n'est pas déployé, le nom sert l'origine blanche commune.
La stratégie commune des vitrines, médias et composants Rust est définie dans
`../aphrody/docs/SITES-PLATFORM.md`; ne pas créer un design system
concurrent dans ce dépôt.
