<!-- SPDX-License-Identifier: Apache-2.0 -->
# bxc — stack Rust 2026 (branche `win32`)

Audit de la stack bxc contre la policy canonique aphrody `best-stack-2026`
(awesome-rust top-200, Apache-2.0, Linux #1 / Windows / wasm). Verdict par
domaine : ✅ déjà optimal · 🔧 corrigé sur cette branche · 💡 amélioration
optionnelle restante.

## Corrigé sur win32

| Domaine | Avant | Après | Pourquoi |
|---------|-------|-------|----------|
| 🔧 TLS client | `reqwest 0.13` + **`native-tls-vendored`** | `reqwest 0.13` + **`rustls` + `rustls-native-certs`** | native-tls tire OpenSSL (dérive système Linux + historique CVE). rustls = pur Rust, pas de dep système. `openssl-sys` éliminé du lock (vérifié : 0). |
| 🔧 Logging | `tracing-subscriber = "0.3"` → résolu **0.3.23** | **`=0.3.22`** | 0.3.23+ a un bug de packaging (module `filter/env` manquant) — déjà visible en diagnostic rustc. Identique au pin workspace aphrody (CLAUDE.md §7). |
| 🔧 Parser HTML | `html2md 0.2.15` (2e pile html5ever 0.27) | sérialiseur natif sur `obscura-dom` | éliminait une pile parser dupliquée entière (`cargo tree --duplicates` = vide). |
| 🔧 Empreinte stealth | UA + `EmulationOS` Linux codés en dur | `cfg(target_os)` cohérent hôte | un JA3 Linux + `navigator` Windows est un signal de détection. |

## Déjà optimal (✅ conforme à la table 2026)

- **Async runtime** : `tokio 1.52` ✅ (pick canonique). Channels/sync via `tokio::sync` + `parking_lot` implicite.
- **DOM/CSS** : `html5ever 0.39` / `markup5ever 0.39` / `selectors 0.38` / `cssparser 0.37` ✅ — la pile servo courante, désormais unique (dédupée).
- **WebSocket** : `tokio-tungstenite 0.26` ✅ (> 0.24 de la table — plus récent, OK pour le serveur CDP).
- **Sérialisation** : `serde 1` + `serde_json 1` ✅.
- **Erreurs** : `anyhow 1` (apps/bins) + `thiserror 2` (libs) ✅ — pile canonique exacte.
- **CLI** : `clap 4.6` derive ✅.
- **URL/UUID/base64** : `url 2.5` / `uuid 1.23` / `base64 0.22` ✅.
- **Moteur JS** : `deno_core 0.400` → `v8 147.4.0` via `deno_core::v8` ✅ — le bon choix pour un V8 embarqué (vs câbler `rusty_v8` à la main). Pas de dep `v8` directe (évite le double-link).
- **Stealth HTTP** : `wreq 6.0-rc.28` + `wreq-util 3.0-rc.10` (émulation Chrome145) ✅ — la crate de référence 2026 pour l'empreinte navigateur (TLS/JA3/HTTP2), successeur de `rquest`/`impersonate`. `prefix-symbols` gated Linux/Android (sinon link BoringSSL cassé ailleurs).

## Améliorations optionnelles restantes (💡 non appliquées)

| Domaine | Actuel | Suggestion 2026 | Gain / risque |
|---------|--------|-----------------|---------------|
| 💡 Édition Rust | `edition = "2021"` | **Edition 2024** | débloque `async fn` natif en trait → permet de retirer `async-trait 0.1` (obscura-net). Risque : revue idiomes (cf. skill `rust-best-practices-2026`). |
| 💡 async trait | `async-trait 0.1` (obscura-net) | natif (avec edition 2024) | une proc-macro de moins. |
| 💡 features tokio | `features = ["full"]` | features sélectives (`rt-multi-thread`, `net`, `io-util`, `macros`, `sync`, `time`) | compile-time + binaire plus légers ; `full` reste acceptable pour un binaire non-wasm. |
| 💡 `futures-util 0.3` direct (obscura-cdp) | dep séparée | `tokio-stream` si seul `StreamExt` est utilisé | une dep de moins (mineur). |
| 💡 Tests | runner par défaut | **`cargo-nextest`** + **`insta`** pour les snapshots DOM→markdown | parallélisme + revue inline. |

## Anti-patterns : aucun restant

Après corrections : pas d'`openssl`/`native-tls`, pas de GPL (capstone/iced-x86 non utilisés ici), pas de crate archivée (`serde_yaml`/`async-std`/`failure`), `tracing-subscriber` pinné. La stack bxc est conforme à la policy aphrody 2026.
