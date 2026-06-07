# bxc Gemini TTS

Extension Chrome (Manifest V3, design **Material 3 aphrody**) qui :

1. **Lit à voix haute** les réponses de **Gemini** (`gemini.google.com`) avec le
   TTS natif du navigateur (Web Speech API), **voix françaises uniquement** ;
2. **Synchronise la session Google** (cookies en clair, httpOnly inclus, **sans
   App-Bound Encryption ni CDP**) vers `bxc` et le VPS ;
3. **Assistant IA** : interroge Gemini / résume la page active via le module
   `google` de bxc, et lit la réponse à voix haute.

UI 100 % française. Couleur signature aphrody (#984061 → rose `#ffa5c9` en sombre).

## Architecture

```
Extension (Chrome)                         bxc-bridge (bun, 127.0.0.1:8765)        bxc natif + VPS
─────────────────                          ──────────────────────────────         ───────────────
content/gemini-tts.js  ── TTS local
service-worker.js      ── chrome.cookies ──► POST /google-cookies ──► ~/.bxc/cookies/google.json
                          (auto-refresh)                              + ~/.aphrody/google-cookies.json
                                                                      + scp + `bxc cookies save` (VPS)
popup (Assistant IA)   ──────────────────► POST /ai/ask        ──► `bxc google chat` (Gemini, IP résidentielle)
                       ──────────────────► POST /google/search ──► `bxc google search --json`
```

Le **pont** `~/.bxc/bxc-bridge.ts` est indispensable pour la session et l'IA
(une extension ne peut pas écrire sur le disque ni exécuter bxc). Il est maintenu
par la tâche planifiée Windows **`bxc-bridge`** (au logon, relance auto).

## Synchronisation de la session Google

Le service worker lit les cookies `google.com` via `chrome.cookies.getAll`
(valeurs **déchiffrées**, httpOnly compris — l'API cookies des extensions n'est
pas soumise à l'ABE qui bloque la lecture directe de la base). Déclencheurs :

- au démarrage et à l'installation ;
- **toutes les 30 min** (alarme) ;
- **à chaque rotation** de `__Secure-1PSIDTS` / `__Secure-1PSID` (debounce 1 min) ;
- bouton **Synchroniser maintenant** dans le popup.

→ remplace définitivement le bricolage manuel Cookie-Editor : la session du VPS
reste fraîche automatiquement, tant que tu es connecté à Google dans Chrome.

## Installation

1. `chrome://extensions` → **Mode développeur**.
2. **Charger l'extension non empaquetée** → `bxc/extensions/bxc-gemini-tts`.
3. Vérifier que la tâche `bxc-bridge` tourne (`Get-ScheduledTask bxc-bridge`) ;
   sinon `Start-ScheduledTask bxc-bridge`.
4. Ouvrir `gemini.google.com/app`.

## Permissions

| Permission | Usage |
|------------|-------|
| `storage` | réglages voix |
| `cookies` + `host_permissions: *.google.com` | lire la session Google en clair |
| `alarms` | auto-refresh périodique |
| `activeTab` + `scripting` | « Résumer la page » (texte de l'onglet actif) |
| `host_permissions: 127.0.0.1:8765` | parler au bxc-bridge local |

Aucune donnée n'est envoyée à un tiers : cookies → disque local + VPS (SSH
chiffré via WireGuard) ; prompts IA → Gemini via ta propre session.

## Fichiers

```
manifest.json            MV3 (action + content script + SW + permissions)
service-worker.js        sync cookies (chrome.cookies + alarms) + messages
content/gemini-tts.*     TTS sur Gemini + barre flottante M3
popup/*                  3 sections M3 : Lecture vocale, Session Google, Assistant IA
styles/aphrody-m3.css    tokens Material 3 (thème aphrody sombre)
```

Pont côté système : `~/.bxc/bxc-bridge.ts` (+ `run-bridge.ps1`, tâche `bxc-bridge`).
