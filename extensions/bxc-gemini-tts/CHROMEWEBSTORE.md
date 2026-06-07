# Chrome Web Store Listing — bxc Gemini TTS

> Last Updated: 2026-06-07

> ⚠️ **Distribution recommandée : Non-listée (Unlisted) ou Privée.**
> Cette extension lit les cookies d'authentification Google et les transmet à un
> serveur auto-hébergé (le VPS de l'utilisateur). C'est un outil personnel du
> workflow bxc. En distribution **publique**, la review du CWS scrute fortement
> l'accès aux cookies d'auth et le rejetterait très probablement. Publier en
> Unlisted (lien direct) ou Privé (comptes autorisés) évite cet écueil tout en
> permettant l'installation hors « mode développeur ».

## Store Listing

**Extension Name**
bxc Gemini TTS

**Short Description**
Lecture vocale française des réponses de Gemini, synchronisation de session et assistant IA.

**Detailed Description**
bxc Gemini TTS lit à voix haute les réponses de Gemini avec une voix française et ajoute des outils autour de ta session Google.

Lecture vocale — sur gemini.google.com, chaque nouvelle réponse est lue automatiquement avec le moteur de synthèse vocale natif du navigateur, voix françaises uniquement. Une barre flottante (Auto, Lire, Pause, Stop) et un popup permettent de régler voix, vitesse et tonalité.

Session Google — l'extension garde ta session Google synchronisée vers ton propre outil bxc et ton serveur, sans aucun service tiers. Idéal si tu pilotes Gemini en ligne de commande.

Assistant IA — depuis le popup, pose une question à Gemini ou résume la page active, et écoute la réponse.

Confidentialité — aucune donnée n'est envoyée à un tiers. Les cookies restent sur ton appareil et ton propre serveur (connexion chiffrée). Les requêtes IA passent par ta propre session Gemini.

Support — https://github.com/aphrody-code/bxc

**Category**
Accessibility

**Single Purpose**
Lire à voix haute les réponses de Gemini et garder la session Google de l'utilisateur disponible pour ses propres outils.

**Primary Language**
Français

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | icons/icon-128.png |
| Screenshot 1 [REQUIRED] | 1280×800 | ⬜ Not created | (capturer le popup sur gemini.google.com) |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ⬜ Not created | (barre flottante en lecture) |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |

### Screenshot Notes
1. Onglet gemini.google.com avec une réponse, la barre flottante visible (Auto ON) et le popup ouvert montrant les 3 sections.
2. Section « Assistant IA » du popup avec une réponse affichée + bouton « Lire à voix haute ».

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| storage | permissions | Mémorise les réglages de lecture (voix, vitesse, tonalité, lecture auto) entre les sessions. |
| cookies | permissions | Lit les cookies de session Google de l'utilisateur pour les mettre à disposition de son propre outil bxc (fonction « Session Google »). |
| alarms | permissions | Replanifie la synchronisation périodique de la session (toutes les 30 min) sans maintenir le service worker actif. |
| activeTab | permissions | Récupère le texte de l'onglet courant uniquement quand l'utilisateur clique « Résumer la page ». |
| scripting | permissions | Exécute la lecture du texte de la page active pour la fonction « Résumer la page ». |
| https://*.google.com/* | host_permissions | Accès aux cookies Google et au contenu de gemini.google.com pour la lecture vocale et la session. |
| http://127.0.0.1:8765/* | host_permissions | Communique avec l'agent local de l'utilisateur (bxc-bridge) qui écrit la session et exécute les requêtes IA. Aucune connexion réseau externe. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Authentication info | Yes | Yes — vers le serveur auto-hébergé de l'utilisateur (VPS), via SSH chiffré | Réutiliser la session Google dans les outils bxc de l'utilisateur | No |
| Website content | Yes (à la demande) | Yes — vers Gemini (Google), via la session de l'utilisateur | Résumé de page / questions IA | No (Google = fournisseur, pas tiers revendeur) |
| Web history / Location / Financial / Health / Payment | No | No | — | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
https://github.com/aphrody-code/bxc/blob/main/extensions/bxc-gemini-tts/PRIVACY.md
(ou GitHub Pages équivalent — doit être publiquement accessible avant soumission)

## Distribution

**Visibility**: Unlisted (recommandé) / Private
**Regions**: All regions
**Pricing**: Free

## Developer Info

**Publisher Name**: aphrody-code
**Contact Email**: [à compléter — email public de contact du store]
**Support URL**: https://github.com/aphrody-code/bxc/issues
**Homepage URL**: https://github.com/aphrody-code/bxc

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.1.0 | 2026-06-07 | TTS FR + design M3 aphrody + synchro session Google + assistant IA | Draft |
| 1.0.0 | 2026-06-06 | Lecture vocale des réponses Gemini (version initiale) | Draft |

## Review Notes

### Known Issues / Limitations
- Nécessite un agent local (bxc-bridge) pour les fonctions Session et IA ; sans
  lui, seule la lecture vocale fonctionne.
- Les sélecteurs DOM de Gemini peuvent évoluer (constante `RESPONSE_SELECTOR`).
- Voix dépendantes du système (voix `fr-*` installées).
