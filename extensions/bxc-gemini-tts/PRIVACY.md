# Politique de confidentialité — bxc Gemini TTS

_Dernière mise à jour : 2026-06-07_

bxc Gemini TTS est un outil personnel, sans serveur tiers, sans publicité et sans
télémétrie. Cette politique décrit exactement quelles données l'extension
manipule et où elles vont.

## Résumé

- **Aucune donnée n'est envoyée à un service tiers** ni revendue.
- Les seuls destinataires de données sont : **ton propre serveur** (le VPS que tu
  contrôles) et **Google** (via ta propre session Gemini, que tu utilises déjà).
- Tout transite par des canaux chiffrés.

## Données traitées

### 1. Cookies de session Google (information d'authentification)

- **Ce que c'est** : les cookies de `google.com` (dont `__Secure-1PSID`,
  `__Secure-1PSIDTS`, `SID`, `SAPISID`…), lus via l'API `chrome.cookies`.
- **Pourquoi** : pour réutiliser ta session Google dans tes propres outils `bxc`
  (par ex. interroger Gemini en ligne de commande).
- **Où ça va** : vers un agent local (`bxc-bridge`, `127.0.0.1`) qui écrit les
  cookies sur **ton disque** et les copie vers **ton VPS** via SSH chiffré
  (tunnel WireGuard). Ils ne sont **jamais** envoyés à un serveur tiers.
- **Conservation** : tu en es l'unique détenteur, sur tes machines. Supprime-les
  en effaçant `~/.bxc/cookies/google.json` et l'équivalent sur le VPS.

### 2. Contenu de page (à la demande)

- **Ce que c'est** : le texte de l'onglet actif, uniquement quand tu cliques
  « Résumer la page ».
- **Où ça va** : à **Gemini (Google)**, via ta propre session, pour produire le
  résumé. Aucune autre destination.

### 3. Réglages

- Voix, vitesse, tonalité, lecture automatique : stockés localement via
  `chrome.storage`. Jamais transmis.

## Ce que l'extension NE fait PAS

- Pas de serveur tiers, pas d'analytics, pas de pisteurs.
- Pas de revente ni de partage de données.
- Pas de collecte de localisation, d'historique de navigation, ni de données
  financières ou de santé.

## Contact

Questions : https://github.com/aphrody-code/bxc/issues
