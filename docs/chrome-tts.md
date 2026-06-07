<!-- SPDX-License-Identifier: Apache-2.0 -->

# bxc Gemini TTS — extension Chrome

Extension Chrome (Manifest V3, design **Material 3 aphrody**) qui apporte trois
capacités, toutes en français :

1. **Lecture vocale** des réponses de **Gemini** (`gemini.google.com`) via le TTS
   natif du navigateur (Web Speech API `speechSynthesis`), **voix françaises** ;
2. **Synchronisation de la session Google** (cookies en clair, httpOnly inclus,
   **sans App-Bound Encryption ni CDP**) vers `bxc` local et le VPS ;
3. **Assistant IA** branché sur le module `google` de bxc (Gemini chat, résumé de
   page, recherche), avec restitution vocale.

Code : [`extensions/bxc-gemini-tts/`](../extensions/bxc-gemini-tts/).

## Pourquoi un pont local

Une extension Chrome est sandboxée : elle ne peut ni écrire sur le disque
(`~/.bxc/cookies/google.json`) ni exécuter `bxc`. Un **pont HTTP local** fait le
lien — `~/.bxc/bxc-bridge.ts` (bun, `127.0.0.1:8765`), maintenu par la tâche
planifiée Windows `bxc-bridge` (au logon, relance auto).

```
Extension (Chrome)                       bxc-bridge (bun :8765)            bxc natif + VPS
─────────────────                        ─────────────────────            ───────────────
content/gemini-tts.js  ── TTS local
service-worker.js  ── chrome.cookies ──► POST /google-cookies ──► ~/.bxc/cookies/google.json
                       (auto-refresh)                            + ~/.aphrody/google-cookies.json
                                                                 + scp + `bxc cookies save` (VPS)
popup (Assistant IA) ──────────────────► POST /ai/ask        ──► `bxc google chat` (Gemini, IP résidentielle)
                     ──────────────────► POST /google/search ──► `bxc google search --json`
```

## Synchronisation de la session Google

Le problème : Chrome 149 chiffre les cookies en **App-Bound Encryption** (`v20`),
illisibles par lecture directe de la base ; et Chrome 136+ neutralise
`Network.getAllCookies` / `Storage.getCookies` via **CDP** sur le profil par
défaut. Ni la copie de profil ni une jonction NTFS ne contournent ça.

La solution : l'**API `chrome.cookies` des extensions** retourne les valeurs
**déchiffrées** (httpOnly compris) — elle n'est pas soumise à l'ABE. Le service
worker appelle `chrome.cookies.getAll({ domain: "google.com" })` puis POST le jar
au bridge. Déclencheurs :

- au démarrage et à l'installation ;
- alarme **toutes les 30 min** ;
- **rotation** de `__Secure-1PSIDTS` / `__Secure-1PSID` (debounce 1 min) ;
- bouton **Synchroniser maintenant** dans le popup.

→ remplace le bricolage manuel Cookie-Editor : la session du VPS reste fraîche
tant que tu es connecté à Google dans Chrome. Cookies requis :
`__Secure-1PSID` + `__Secure-1PSIDTS`.

## Endpoints du bridge

| Méthode | Route | Effet |
|---------|-------|-------|
| `GET` | `/health` | `{ ok: true }` |
| `POST` | `/google-cookies` | écrit les jars local + `bxc cookies save google` sur le VPS |
| `POST` | `/ai/ask` `{prompt}` | `bxc google chat` → `{ text }` (Gemini, IP résidentielle) |
| `POST` | `/google/search` `{q}` | `bxc google search --json` → `{ results }` |

CORS `*`, écoute **uniquement** `127.0.0.1`. Aucune exposition réseau.

## Installation

1. `chrome://extensions` → activer **Mode développeur**.
2. **Charger l'extension non empaquetée** → `extensions/bxc-gemini-tts`.
3. S'assurer que la tâche `bxc-bridge` tourne :
   `Get-ScheduledTask bxc-bridge` (sinon `Start-ScheduledTask bxc-bridge`).
4. Ouvrir `https://gemini.google.com/app`.

## Permissions et confidentialité

| Permission | Usage |
|------------|-------|
| `storage` | réglages voix |
| `cookies` + `*.google.com` | lire la session Google en clair |
| `alarms` | auto-refresh périodique |
| `activeTab` + `scripting` | « Résumer la page » (texte de l'onglet actif) |
| `127.0.0.1:8765` | parler au bxc-bridge local |

Aucune donnée envoyée à un tiers : cookies → disque local + VPS (SSH chiffré via
WireGuard) ; prompts IA → Gemini via ta propre session.

## Design

Tokens **Material 3** repris de `aphrody/packages/m3-theme` (couleur signature
aphrody `#984061` → rose `#ffa5c9` en thème sombre) : switch, slider, boutons
filled/tonal/text avec state layers, surfaces container, elevation, corners,
motion. Voir [`styles/aphrody-m3.css`](../extensions/bxc-gemini-tts/styles/aphrody-m3.css).

## Dépannage

- **« Bridge injoignable »** dans le popup → la tâche `bxc-bridge` ne tourne pas
  (`Start-ScheduledTask bxc-bridge`) ; log : `~/.bxc/bridge.log`.
- **IA « not signed in »** → la session Google a expiré ; clique
  « Synchroniser maintenant », ou attends le prochain auto-refresh.
- **Pas de lecture vocale** → aucune voix `fr-*` installée (Paramètres Windows ›
  Heure et langue › Voix), ou Gemini a refondu son DOM (ajuster
  `RESPONSE_SELECTOR` dans `content/gemini-tts.js`).
