# CLAUDE.md — packages/llm-extract

Contexte identique à `@GEMINI.md`. Tout ce qui suit s'ajoute / précise pour Claude.

## Rappel critique

- **Single-stream queue obligatoire** : Gemma sur CPU = memory-bandwidth bound.
  Toujours passer par `globalLlmQueue`. Paralléliser dispute les canaux DRAM.
- **Defaults officiels Gemma 4** (HF model card) : `temp=1.0, top_p=0.95, top_k=64`.
  Ne pas changer sans bench — la skill `/gemma-bench` détecte les régressions.
- **Image AVANT texte** dans `content[]` multimodal (mandate model card).
  `extractFromImage()` respecte l'ordre.
- **Thinking mode** : génère 3-5x plus de tokens. OFF pour volume, ON pour ambigu.

## Commands

```bash
bun run typecheck    # bunx tsc --noEmit
bun test             # skip si gemma.service down
bun run bench        # 10 samples -> p50/p95 + pages/min
bun run lint         # bunx oxlint src test benchmarks
```

## Prereq runtime

```bash
systemctl --user status gemma         # service llama-server local
curl -sf http://127.0.0.1:8080/health # probe
```

Si down : tous les appels jettent. `LlmClient.health()` permet de prober explicitement.

## Pièges

- `response_format` strict : enum vide ou type non supporté → 400. Couverture
  `zodToJsonSchema` : object/string/number/boolean/enum/optional/array/literal.
  Pour unions tagged : swap à `zod-to-json-schema` upstream.
- `-t 12` régresse vs `-t 8` sur ce hardware (Haswell 12 vCPU AVX2).
