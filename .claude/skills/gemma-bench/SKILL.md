---
name: gemma-bench
description: Lance le bench Gemma 4 E2B local (packages/llm-extract), parse p50/p95/pages-per-min, et compare au baseline stocké dans `vendor/gemma/bench/`. À utiliser quand l'utilisateur demande "bench Gemma", "perf llm-extract", ou après un tune llama-server (`-t`, ctx, slot, quant).
disable-model-invocation: true
---

# Gemma 4 bench runner

## Prereq

Avant tout, vérifier que le service tourne :

```bash
systemctl --user is-active gemma || systemctl --user start gemma
curl -sf http://127.0.0.1:8080/health || { echo "gemma down"; exit 1; }
```

Si down : ne pas relancer aveuglément. Probe `journalctl --user -u gemma -n 50` pour comprendre.

## Workflow

1. **Capture l'état actuel** :
   - Flags llama.cpp : `systemctl --user cat gemma | grep -E 'ExecStart|-t|--ctx-size|--n-gpu-layers'`
   - Quantization du modèle utilisé : lire `~/bxc/vendor/gemma/models/` ou la config service
   - CPU load avant : `uptime`

2. **Lance le bench** :
   ```bash
   cd /home/ubuntu/bxc/packages/llm-extract && bun run bench
   ```
   Bench officiel = 10 samples, sortie p50/p95 + tokens.

3. **Parse la sortie** et extrait :
   - `extractStructured` p50, p95, pages/min
   - `classify` p50, p95, pages/min
   - `summarize` p50, p95, pages/min
   - `extractFromImage` p50, p95, pages/min (si applicable)

4. **Compare au baseline** :
   - Cherche `vendor/gemma/bench/baseline-*.json` le plus récent
   - Diff colonne par colonne
   - Flag toute régression > 10% en rouge, amélioration > 10% en vert

5. **Sauve le run** :
   ```
   vendor/gemma/bench/run-YYYY-MM-DD-HHMM.json
   ```
   Format : `{ timestamp, flags, results: { extract: {p50, p95, pagesPerMin}, ... }, baselineDiff: {...} }`

6. **Recommandation** :
   - Régression → identifier la cause probable (flag changé, CPU contention, modèle swap)
   - Sur ce hardware (Haswell 12 vCPU AVX2), `-t 8` est le sweet spot — `-t 12` fait CHUTER les perfs (bandwidth DRAM saturée). Si l'utilisateur a poussé `-t > 8`, le signaler.
   - Targets attendus sur Q8_0 + ctx 8K + slot 1 :
     - extractStructured : 12-18 pages/min
     - classify : 30-40 pages/min
     - summarize : 20-25 pages/min
     - extractFromImage : 6-10 pages/min

## Output format

```
Gemma bench — <YYYY-MM-DD HH:MM>
Service : <flags actuels>
Modèle : <quant>

Operation         | p50 (ms) | p95 (ms) | pages/min | vs baseline
extractStructured | 4200     | 5100     | 14.3      | -2% (stable)
classify          | 1800     | 2100     | 33.3      | +8% (improved)
...

Verdict : <stable | regression | improvement>
Next : <action recommandée ou "rien à faire">
```

## Anti-patterns

- **Ne pas paralléliser** : Gemma sur CPU est memory-bandwidth bound. Le bench officiel passe par `globalLlmQueue` (single-stream). Le respecter.
- **Ne pas bench juste après un boot du service** : laisser le mmap warm (30s d'idle suffisent).
- **Ne pas régresser le seed** : le bench utilise un seed fixe pour reproductibilité. Si tu changes le seed, signale-le.
