# Plan Stratégique : Bxc > Playwright (Le "Playwright Killer Plan")

**Objectif** : Surpasser Playwright à 100% en comblant ses lacunes actuelles (DX, Observabilité) et en maximisant l'architecture unique de Bxc (Vitesse Zig, Stealth natif, Autoscaling).

---

## 🔍 Analyse de l'existant (Gap Analysis)

### Bxc (État actuel)
- **Points forts** : Transports polymorphes (`static`, `fast`, `http`), intégration native de `curl-impersonate` (JA4), système de pool autoscalé.
- **Faiblesses** : API `Page` implémente des méthodes atomiques (`click`, `type`) sans vérification d'actionnabilité (visibility, stability). Pas de support pour les `Frames` (iframes). Pas de `BrowserContext` (tout est au niveau du singleton Browser). `HttpPage` et `Page` ont des interfaces divergentes.

### Playwright (La référence)
- **Points forts** : Système de `Locator` avec auto-waiting strict, isolation parfaite via `BrowserContext`, support natif des signaux et du Tracing.
- **Faiblesses** : Lourd au démarrage, facile à détecter (CDP pur sans modification TLS), dépendance forte à Node.js.

---

## Phase 1 : Parité Fonctionnelle Absolue (Combler l'écart DX)

### 1.1. Unification de l'API Page
Fusionner le comportement de `Page` et `HttpPage` sous une interface unique. Si le profil est `http`, les méthodes DOM (`$`, `click`) doivent soit utiliser un parseur statique ultra-rapide (Zig/Rust) soit lever une erreur explicite invitant à un `upgradeProfile()`.

### 1.2. Système de "Locators" et Actionnabilité (Sprint Prioritaire)
- **Locator** : Créer `src/api/Locator.ts`. Un locator ne stocke pas un élément, mais une *requête* (`selector`).
- **Auto-Waiting** : Avant chaque action (`click`, `fill`), Bxc doit vérifier via CDP :
  1. `Attached` : Présent dans le DOM.
  2. `Visible` : Non `display: none` et `boundingBox` > 0.
  3. `Stable` : Les coordonnées ne changent pas pendant deux frames.
  4. `Enabled` : Pas d'attribut `disabled`.
  5. `Receives Events` : Non masqué par un autre élément (via `document.elementFromPoint`).

### 1.3. Support des Frames & Shadow DOM
- Implémenter `page.mainFrame()`, `page.frames()` et `frame.childFrames()`.
- Rendre la recherche de sélecteur "Shadow DOM piercing" par défaut (utilisation de `/deep/` ou équivalent CDP).

---

## Phase 2 : Observabilité et Outils Développeur

### 2.1. Bxc Trace Viewer (Zstd-native)
Utiliser les capacités de compression native de Bun pour générer des fichiers `.trace` minuscules. Créer un visualiseur léger injecté dans le dashboard de stats existant.

### 2.2. Codegen "Live"
Améliorer le mode recorder pour qu'il génère du code TypeScript idiomatique utilisant les nouveaux `Locators` (ex: `page.getByRole('button', { name: 'Payer' })`).

---

## Phase 3 : L'Avantage Déloyal (Dépasser Playwright)

### 3.1. Stealth & TLS Fingerprinting Natif
Contrairement à Playwright qui nécessite `playwright-stealth` (souvent obsolète), Bxc intègre le camouflage au niveau du transport (`curl-impersonate` + `Camoufox`).

### 3.2. Polymorphisme de Profil à Chaud
Permettre de changer de profil sans perdre l'état de la page :
`await page.upgradeProfile('stealth')` -> Migre les cookies et le session storage d'une requête HTTP vers une instance Lightpanda ou Patchright.

### 3.3. Zig-Powered DOM (Performance Maximale)
Utiliser `liblightpanda_dom.so` pour toutes les opérations de lecture en mode `static` ou `http`, permettant des scans de 1000 pages en quelques secondes sur un seul thread.

---

## Phase 4 : AI-Native Automation

### 4.1. Sélecteurs Sémantiques (Stagehand Integration)
Utiliser `python-bridge` pour appeler des modèles locaux (ex: GPT-4o-mini ou modèles locaux via Ollama) afin de résoudre des sélecteurs flous :
`await page.locator('@semantic:le bouton de connexion bleu').click()`

---

## 🎯 Roadmap Technique Immédiate

1.  **Semaine 1 (Terminée)** : Création de la classe `Locator` (auto-waiting sur visible/enabled) et refactorisation de `Page.click` pour utiliser l'auto-waiting. Initialisation de la structure des `Frames`.
2.  **Semaine 2 (Terminée)** : Implémentation de `BrowserContext` pour gérer l'isolation parfaite des sessions (cookies, pages) sans recréer le transport.
3.  **Semaine 3 (Terminée)** : Ajout du support complet des `Frames` dans l'API CDP (hiérarchie iframes, frameAttached/Detached).
4.  **Semaine 4 (Terminée)** : Unification `Page` / `HttpPage` via une interface commune et support du changement de profil à chaud (`upgradeProfile`).
5.  **Phase 2 (Terminée)** : Implémentation de `TraceRecorder` avec compression Zstd native, export HAR, et capture d'actions/snapshots.
6.  **Phase 3 (Terminée)** : Validation du polymorphisme `upgradeProfile('stealth')` testé.
7.  **Phase 4 (Terminée)** : Intégration de la `python-bridge` pour la résolution des locators `@semantic:` avec un LLM local.