# @aphrody-code/llm-extract

Structured extraction over scraped HTML, powered by the local **Gemma 4 E2B-it**
llama.cpp server (sources et runtime sous `vendor/gemma/`). Bun-only, zero `node:*`.

Le `CLAUDE.md` parent (`bunlight/CLAUDE.md`) couvre la mission Bunlight et les règles
code (Bun-native, no emoji, strict TS). Ne pas dupliquer ici. La doc complète du runtime
(`llama-server`, modèles, perf) est dans `vendor/gemma/CLAUDE.md`.

## Mission

Bunlight produit du HTML (profils `static` / `fast` / `stealth` / `max`). Ce package
transforme ce HTML en JSON typé via génération contrainte par JSON-Schema sur Gemma 4.
Conçu pour scraping intensif :

- Single-stream queue : Gemma sur CPU est **memory-bandwidth bound** — paralléliser
  ne fait que disputer les mêmes canaux DRAM. Toujours passer par `globalLlmQueue`.
- Pre-clean HTML → minimise les tokens de prompt avant l'appel LLM.
- Zod schema → JSON-Schema → llama-server `response_format` strict : pas de champ
  halluciné, parsing garanti.
- Retry exponentiel sur 503 (modèle en chargement) ou erreurs réseau transitoires.
- Defaults officiels Gemma 4 (model card HF) : `temp=1.0, top_p=0.95, top_k=64`.

## Commandes

| Commande | Usage |
|---|---|
| `bun run typecheck` | `bunx tsc --noEmit` |
| `bun test` | tests `bun:test` — skip si `gemma.service` down |
| `bun run bench` | `bun benchmarks/extract.bench.ts` — 10 samples → p50/p95 + pages/min |
| `bun run lint` | `bunx oxlint src test benchmarks` |
| `bunx n2b . --fix` | codemod Node → Bun (depuis racine du package) |

## API publique

| Fonction | Rôle |
|---|---|
| `extractStructured(html, { schema })` | HTML → object typé (zod) |
| `extractFromImage(dataUrl, instruction, schema)` | multimodal — image AVANT texte (mandate Gemma 4 model card) |
| `classify(html, [...labels])` | HTML → enum label |
| `summarize(html, { sentences })` | HTML → résumé plain-text |
| `new LlmClient({...})` | client OpenAI-compat bas niveau, défauts Gemma 4 |
| `globalLlmQueue` | singleton `SerialQueue` — un appel à la fois |
| `preclean(html, maxTokens)` | strip script/style/comments + clamp tokens |
| `applyThinking(prompt, true)` | préfixe `<|think|>` (Gemma 4 thinking mode) |
| `stripThinkingChannel(text)` | retire le bloc `<|channel>thought…<channel|>` |

## Quick start

```typescript
import { z } from "zod";
import { extractStructured } from "@aphrody-code/llm-extract";

const product = await extractStructured(htmlString, {
  schema: z.object({
    title: z.string(),
    priceEur: z.number().optional(),
    inStock: z.boolean(),
  }),
});
// → object typé, garanti par json_schema strict côté llama-server
```

## Spécificités Gemma 4 (issues de la model card HF officielle)

Source : `https://huggingface.co/google/gemma-4-E2B-it` (fetched 2026-05-16).

- **Roles** : `system`, `user`, `assistant` (standardisés vs Gemma 3).
- **Thinking mode** : `<|think|>` au début du system prompt active le raisonnement.
  Le modèle émet alors un bloc `<|channel>thought\n…<channel|>` avant la réponse.
  Le client retire automatiquement ce bloc si `stripThinking: true`.
- **Sampling officiel** : `temperature=1.0, top_p=0.95, top_k=64`. Ne pas changer
  sans bench — les valeurs viennent du model card, pas d'un préset community.
- **Multimodal** : l'image (ou l'audio) DOIT précéder le texte dans `content[]`.
  `extractFromImage()` respecte cet ordre.
- **Function calling** : natif. Pas exposé dans cette version — utilise json_schema.

## Throughput sur ce hardware

Sur le VPS (Haswell 12 vCPU AVX2, gemma-4-E2B-it Q8_0, `-t 8`, ctx 8K, slot 1) :

| Opération | Pages / min | Notes |
|---|---:|---|
| `extractStructured` (~80 tok out) | 12–18 | usage type produit/article |
| `classify` (32 tok out) | 30–40 | output ultra court |
| `summarize` 3 phrases | 20–25 | tradeoff text|qualité |
| `extractFromImage` (image ~512 px) | 6–10 | overhead vision encoder |

Le bench officiel : `bun run bench` (10 samples, sortie p50/p95/tokens).

## Stratégies pour scraper "à grande échelle"

1. **Pré-filtre rule-based d'abord**. Si cheerio/regex donne 95 % de confiance, ne pas
   envoyer la page au LLM. Garder le LLM pour les cas ambigus.
2. **Schémas serrés → moins de tokens sortie → plus de pages/min**. Drop les optionnels
   dont tu n'as pas besoin.
3. **Input plus court** : `preclean(html, 1500)` si tes sources sont des fiches courtes.
4. **Batch off-hours** : cron 03:00 UTC traite le backlog pendant que les bots dorment.

## Mandates respectés

- Bun-only — `fetch`, `Bun.*`, Web APIs. Aucun import `node:*`.
- TypeScript strict, `noUncheckedIndexedAccess`, pas de `any`.
- Tests via `bun:test`.
- Pas d'emoji dans code/doc/CLI output.
- `feat(area):`, `fix(area):`, `chore:` pour les commits.

## Dépendance runtime

Le package suppose `~/bunlight/vendor/gemma/` setup et le service `gemma` user-level UP :

```bash
systemctl --user status gemma
curl -sf http://127.0.0.1:8080/health
```

Si down : tous les appels jettent. `LlmClient.health()` permet de prober explicitement.

## Pièges

- **`response_format` strict** : si ton schéma a un `enum` vide ou un type non supporté,
  llama-server renvoie 400. `zodToJsonSchema` couvre object/string/number/boolean/enum/
  optional/array/literal — pour des unions tagged, swap à `zod-to-json-schema` upstream.
- **Bandwidth, pas cores** : `-t 12` sur le service Gemma fait CHUTER les perfs (cf
  `vendor/gemma/GEMINI.md` — bench mesuré). Stick à `-t 8`.
- **Thinking ≠ qualité gratis** : génère 3-5× plus de tokens. À garder OFF pour
  scraping volume ; ON pour cas où l'extraction est ambiguë (rare).
- **Image first** : `extractFromImage` fixe l'ordre. Si tu fais tes propres messages,
  respecte le mandate model card.
