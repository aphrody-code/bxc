# CLAUDE.md — vendor/gemma

Contexte identique à `@GEMINI.md`. Tout ce qui suit s'ajoute / précise pour Claude.

## Rappel critique

- **Hardware** : VPS Haswell 12 vCPU AVX2, 46 GiB RAM, pas d'AVX-512, pas de GPU.
- **Contrainte dominante** : memory-bandwidth bound, PAS compute-bound.
  `-t 8` est le sweet spot mesuré. `-t 12` régresse (dispute DRAM).
- **Service user-level** : `systemctl --user`, pas `sudo systemctl`.
- **Models gitignored** : `models/*.gguf` télécharger via `huggingface-cli` au setup.
  Q8_0 = 4.7 GB pour gemma-4-E2B-it + 532 MB pour mmproj (multimodal).

## Commands

```bash
systemctl --user status gemma                # statut
systemctl --user restart gemma               # après edit du service
journalctl --user -u gemma -f                # logs live
curl -sf http://127.0.0.1:8080/health        # probe API
bash scripts/start-server.sh                 # lancement manuel (debug)
```

## Pièges Gemma 4 (model card HF officielle)

- **Roles** : `system` / `user` / `assistant` (standardisés vs Gemma 3).
- **Thinking mode** : `<|think|>` en tête de system prompt active raisonnement.
  Émet un bloc `<|channel>thought…<channel|>` avant la réponse — strippé côté client.
- **Sampling officiel** : `temperature=1.0, top_p=0.95, top_k=64`. Ne pas changer
  sans bench (skill `/gemma-bench` détecte les régressions).
- **Multimodal** : image (ou audio) DOIT précéder le texte dans `content[]`.

## Skill associée

`/gemma-bench` (dans `.claude/skills/gemma-bench/`) lance le bench
`packages/llm-extract` + parse p50/p95 + diff baseline `vendor/gemma/bench/`.
