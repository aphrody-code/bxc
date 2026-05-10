# Stack Zig de Bunlight

Choix de dépendances Zig pour les différents composants de Bunlight, audités le 2026-05-10 via `awesome-zig` + `gh api`.

## Décisions actées

### Mode static (DOM-only, no JS exec)

| Composant | Choix | Alternative écartée | Pourquoi |
|---|---|---|---|
| HTML parser + DOM tree | **[zigquery](https://github.com/OrlovEvgeny/zigquery)** (45 KB, push 2026-03) | Lightpanda DOM | Lightpanda DOM a 541 refs `js.*` à V8, refactor lourd. Zigquery est pur Zig, API jQuery-like, suffisant pour 70% des cas |
| CSS selector matcher | **zigquery** (intégré) | Lightpanda selector engine | Inclus dans zigquery, syntax CSS3 complète |
| URL parser | **`std.Uri`** (stdlib Zig) | `gernest/url` (push 2019, obsolete), `Vexu/zuri` | Stdlib suffit pour notre usage |

### Mode full (avec exec JS)

| Composant | Choix | Alternative écartée | Pourquoi |
|---|---|---|---|
| Browser engine | **Lightpanda sub-process** | Lightpanda statique linké | Cohabitation V8/JSC trop fragile (audit 8/10 difficulté), sub-process via Unix socketpair = pattern éprouvé |
| IPC transport | **`socketpair(AF_UNIX, SOCK_STREAM, 0)`** | TCP localhost, named pipes | Zero-conf, no port collision, pas serializable cross-host (volontaire) |
| CDP message parser | **`std.json`** (stdlib) | manual JSON | Suffisant pour CDP, JIT par JSC côté Bun |

### Backlog (pas immédiat, candidats futurs)

| Composant | Lib candidate | Use case | Statut |
|---|---|---|---|
| HTTP/2 server pour CDP server natif | [karlseguin/http.zig](https://github.com/karlseguin/http.zig) (1.5k ⭐) | Si on veut un mode "Bunlight CDP standalone" indépendant de Bun | Backlog Phase 5 |
| WebSocket lib pure Zig | [Thomvanoorschot/async_zocket](https://github.com/Thomvanoorschot/async_zocket) | Si on veut Phase 5 sans dépendre du WS de Bun | Backlog Phase 5 |
| QUIC / HTTP/3 | [zquic](https://github.com/ch4r10t33r/zquic) | Si CDP-over-QUIC un jour | Backlog Phase 7+ |
| TLS native Zig | [Geun-Oh/zigtls](https://github.com/Geun-Oh/zigtls) | Alternative à BoringSSL pour link plus léger | Backlog v1.0 |
| HTTP framework full-stack | [tardy-org/zzz](https://github.com/tardy-org/zzz) (729 ⭐) | Si on fait un dashboard Bunlight admin | Out of scope |
| Tree-sitter bindings | [tree-sitter/zig-tree-sitter](https://github.com/tree-sitter/zig-tree-sitter) (96 ⭐) | Parser CSS/JS incrémental, syntax highlighting in DevTools | Backlog v0.5+ |

## Critères d'évaluation

Pour qu'une lib Zig soit retenue dans Bunlight :
1. **Compat Zig 0.15.2** (Lightpanda en a besoin)
2. **Pushed dans les 18 derniers mois** (sinon stale)
3. **License compatible** : MIT, Apache-2.0, BSD-3, ou (en dernier) AGPL-3.0
4. **Surface API stable** : on ne veut pas tracker un projet qui rebuild son API tous les 3 mois
5. **Build via `b.dependency()`** : module Zig propre, pas un C bind via cmake

Pour les bibliothèques C/C++ existantes, on préfère les versions **"build with Zig"** (cf. section Build with Zig de awesome-zig) car elles cross-compile out-of-the-box.

## Références

- [zigcc/awesome-zig](https://github.com/zigcc/awesome-zig)
- Audit local : `/home/ubuntu/bunmium/awesome-zig.md` (pinned 2026-05-10)
