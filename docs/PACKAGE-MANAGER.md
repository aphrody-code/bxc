<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contrat d'installation pour les gestionnaires de paquets

Ce document est le contrat stable entre BXC et un gestionnaire externe tel que
`aphrody package`. Le canal de distribution canonique est le dépôt GitHub
`aphrody-code/bxc`; la version installée est celle de `package.json` et le tag
de release correspondant est `v<version>`.

Le manifeste machine-readable correspondant est `aphrody-package.json`. Il ne
duplique pas la version : `versionSource` désigne `package.json`, qui reste la
source unique. Son avantage distinctif réutilisable par Aphrody est la
distribution autonome Bun Compile : un même routeur TypeScript produit des
exécutables natifs pour toutes les cibles publiées, sans runtime Bun chez
l'utilisateur. Le gestionnaire peut donc installer le binaire nu sans résoudre
un graphe npm; les ponts Rust et moteurs facultatifs restent dans les archives
complètes pour les fonctions avancées.

Le contrat minimal exposé par le manifeste comprend : l'identité et le dépôt,
la source de version et le modèle de tag, l'asset de checksums, le nom du
binaire, la commande et le motif de vérification de version, la matrice
OS/architecture, les dépendances d'exécution et la politique de conservation
des données utilisateur. Ces champs suffisent pour `install`, `update`,
`uninstall` et `doctor` sans logique spéciale propre à BXC.

## Matrice des artefacts

| Système | Architecture | Binaire nu | Archive complète |
| --- | --- | --- | --- |
| Linux | x86_64 | `bxc-linux-x64` | `bxc-linux-x64.tar.gz` |
| Linux | aarch64 | `bxc-linux-arm64` | `bxc-linux-arm64.tar.gz` |
| macOS | x86_64 | `bxc-darwin-x64` | `bxc-darwin-x64.tar.gz` |
| macOS | arm64 | `bxc-darwin-arm64` | `bxc-darwin-arm64.tar.gz` |
| Windows | x86_64 | `bxc-windows-x64.exe` | `bxc-windows-x64.zip` |

Le binaire installé s'appelle toujours `bxc` sur Linux/macOS et `bxc.exe` sur
Windows. Les archives complètes peuvent aussi contenir `bxc-mcp`, le pont Rust
(`libbxc_rust_bridge.so`, `.dylib` ou `bxc_rust_bridge.dll`) et les moteurs
optionnels disponibles pour la cible. Le binaire nu reste fonctionnel sans ces
composants, mais les opérations qui exigent le pont natif signalent clairement
la dépendance absente.

## Emplacements

| Système | Binaire utilisateur | Configuration |
| --- | --- | --- |
| Linux/macOS | `$HOME/.local/bin/bxc` | `${XDG_CONFIG_HOME:-$HOME/.config}/bxc/config.json` |
| Windows | `%LOCALAPPDATA%\bxc\bin\bxc.exe` | `%APPDATA%\bxc\config.json` |

`BXC_INSTALL_DIR` et `BXC_CONFIG_DIR` remplacent ces valeurs. L'installation
doit être atomique et préserver un `config.json` existant.

## Opérations

- Installation : sélectionner l'artefact exact selon OS et architecture,
  vérifier son checksum dans `SHA256SUMS.txt`, l'écrire sous le nom canonique,
  puis exécuter `bxc --version`.
- Mise à jour : comparer `bxc --version` à la dernière release, télécharger et
  vérifier le nouvel artefact avant remplacement atomique. `bxc self-update
  --check` et `bxc self-update` sont les implémentations intégrées de référence.
- Désinstallation : supprimer uniquement le binaire géré. La configuration,
  le cache et les données utilisateur sont conservés par défaut. Une purge
  explicite peut ensuite supprimer les répertoires retournés par la table
  ci-dessus.

Codes de sortie attendus : `bxc --version` retourne `0` et imprime
`bxc <version>`; une cible ou architecture non prise en charge doit échouer
avant toute écriture.

## Dépendances et construction

Le binaire CLI est compilé avec Bun depuis `src/cli/index.ts`. Les sources
requièrent Bun, tandis que le pont natif requiert Rust/Cargo. Les builds Windows
complets requièrent en plus Zig et `cargo-xwin`; les artefacts de release sont
construits nativement par `.github/workflows/release.yml`.

Commandes reproductibles ciblées :

```bash
BXC_TARGETS=linux-x64 bun scripts/build-standalone.ts
BXC_TARGETS=darwin-arm64 bun scripts/build-standalone.ts
bun scripts/build-windows.ts --arch x64
```

Sur Windows natif, utiliser :

```powershell
.\scripts\build-windows.ps1 -Arch x64
```

Ne pas minifier le routeur CLI : certains programmes CDP incorporés réfèrent à
des noms de fonctions dans des chaînes et seraient invalidés par le renommage.
