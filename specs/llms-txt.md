# llms.txt

> Source canonique: https://llmstxt.org/  
> Auteur: Jeremy Howard / Answer.AI  
> Digest fixé: 2026-05-10

## 1. Pourquoi

> Les large language models s'appuient de plus en plus sur l'information des sites web, mais font face à une limite critique: les fenêtres de contexte sont trop petites pour ingérer la plupart des sites en entier.

`/llms.txt` est un index curé, court, lisible par un LLM, qui pointe vers les pages clés du site (et idéalement leurs versions markdown). Il complète `robots.txt` (permissions) et `sitemap.xml` (exhaustivité) en se focalisant sur ce qu'un LLM devrait lire en premier.

## 2. Emplacement

> Le format llms.txt cible des fichiers situés à la racine `/llms.txt` d'un site web (optionnellement dans un sous-chemin).

Convention identique à `/robots.txt` et `/sitemap.xml`.

## 3. Format strict

Sections markdown, dans cet ordre exact:

1. **H1** = nom du projet ou du site. Seule section requise.
2. **Blockquote** avec un résumé court contenant l'information clé.
3. Zéro ou plus sections markdown (paragraphes, listes — **pas de heading**) avec des détails.
4. Zéro ou plus sections délimitées par des **H2**, contenant des "file lists" de URLs.

### Mock canonique (verbatim)

```markdown
# Title

> Optional description goes here

Optional details go here

## Section name

- [Link title](https://link_url): Optional link details

## Optional

- [Link title](https://link_url)
```

### Format d'un item de liste

```
- [name](url)               # minimal — hyperlien requis
- [name](url): notes        # hyperlien + notes (séparées par ": ")
```

## 4. La section `## Optional`

> Si elle est présente, les URLs qu'elle contient peuvent être skippées si un contexte plus court est nécessaire. À utiliser pour les informations secondaires qui peuvent souvent être ignorées.

Bunlight y range automatiquement: changelog, releases, blog, news, archives, legal, privacy, terms, license.

## 5. Linking aux versions `.md`

> Il est recommandé que les pages contenant de l'information utile aux LLMs fournissent une version markdown propre à la même URL que l'original, mais avec `.md` ajouté.

Exemple: `https://example.com/docs/install` → `https://example.com/docs/install.md`. Pour les URLs sans nom de fichier, ajouter `index.html.md`.

## 6. Variantes de processing (FastHTML convention)

| Fichier | Contenu |
|---|---|
| `llms.txt` | Index seul, conforme spec |
| `llms-ctx.txt` | Index + contenu, **sans** la section `## Optional` |
| `llms-ctx-full.txt` | Index + contenu, **avec** la section `## Optional` |

Bunlight produit `llms.txt` (index) et `llms-full.txt` (concat de tous les markdowns), équivalent ctx-full.

## 7. Compliance checklist côté `scripts/url-to-docs.ts`

- [x] H1 obligatoire — `# ${siteTitle}`
- [x] Blockquote `>` immédiatement après le H1
- [x] Paragraphe détail (date de génération, pointeur vers `pages/` et `plaintext/`) avant les H2
- [x] Sections H2 avec listes `- [title](url): description`
- [x] Section `## Optional` détectée par regex sur le pathname (changelog, releases, blog, etc.)
- [x] Émission de `llms-full.txt` (concat équivalent ctx-full)
- [x] Émission d'un miroir markdown sous `pages/<slug>.md`, miroir text sous `plaintext/<slug>.txt`
- [ ] Génération automatique des versions `.md` aux URLs originales (côté serveur — hors scope du crawler)

## 8. Exemple produit par bunlight

```markdown
# agent-browser

> Browser automation CLI designed for AI agents. Compact text output minimizes context usage. 100% native Rust.

This index was generated on 2026-05-10 from `https://agent-browser.dev`. A clean markdown mirror of every linked page is available alongside this file under `pages/` (rendered) and `plaintext/` (text-only).

## Pages

- [Installation](https://agent-browser.dev/installation): Installs the native Rust binary for maximum performance:
- [Quick Start](https://agent-browser.dev/quick-start): Every browser automation follows this pattern:
- ...

## Engines

- [Chrome](https://agent-browser.dev/engines/chrome): ...
- [Lightpanda](https://agent-browser.dev/engines/lightpanda): ...

## Providers

- [AgentCore](https://agent-browser.dev/providers/agentcore): ...
- ...

## Optional

- [Changelog](https://agent-browser.dev/changelog): ...
```
