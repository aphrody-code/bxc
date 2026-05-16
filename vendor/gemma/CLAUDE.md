# gemma — runtime inference Gemma 4 E2B (CPU AVX2)

Runtime local de **gemma-4-E2B-it** via llama.cpp natif, sous `bunlight/vendor/gemma/`.
Consommé par `packages/llm-extract/` (scraping intensif Bunlight) et par n'importe quel
client OpenAI-compat pointant sur `127.0.0.1:8080`.

> **Hôte** : VPS KVM `vps-203bea89` · 12 vCPU Haswell · 46 GiB RAM · AVX2 / pas d'AVX-512 / pas de GPU.
> **Release** : Gemma 4 publié 2 avril 2026 · build llama.cpp natif AVX2+OpenBLAS · model card HF du 16 mai 2026.

## TL;DR

```bash
systemctl --user status gemma                          # service user-level
curl -sf http://127.0.0.1:8080/health                  # 200 quand prêt
journalctl --user -u gemma -f                          # logs live
```

## Layout

```
bunlight/vendor/gemma/
├── CLAUDE.md                  ← ce fichier
├── pyproject.toml             ← env Python uv (transformers + torch CPU + gemma JAX)
├── uv.lock                    (gitignored, lock du venv)
├── .venv/                     (gitignored — uv venv Python 3.12)
├── sources/                   ← submodules git
│   ├── upstream/              git submodule  google-deepmind/gemma (lib JAX v4.0.0)
│   └── llama.cpp/             git submodule  ggml-org/llama.cpp + build/ (gitignored)
├── models/                    (gitignored, .gguf téléchargés via hf)
│   ├── gemma-4-E2B-it-Q8_0.gguf       4.7 GB
│   └── mmproj-gemma-4-E2B-it-Q8_0.gguf 532 MB
├── scripts/
│   └── start-server.sh        ← lance llama-server avec les bons flags
├── bench/                     (gitignored)
└── logs/                      (gitignored — journalctl reste la source de logs)
```

## Hardware → contrainte dominante

CPU inference Gemma 4 = **memory-bandwidth bound**, pas compute-bound. Sur ce VPS la
BW DRAM agrégée est estimée 20–40 GB/s (KVM vDIMM QEMU sur DDR4 partagé hyperviseur).
**Au-delà de ~8 threads, gain négatif** — le BLAS sature les canaux avant de saturer
les cores.

Bench mesurés (`llama-bench -p 128 -n 64`) :

| `-t` | pp (prompt tok/s) | tg (gen tok/s) | Verdict |
|---:|---:|---:|---|
| 4 | 42.11 | 8.80 | OK petit prompt |
| **6** | **46.27** | 10.99 | best PP (RAG / long prompt) |
| **8** | 37.10 | **12.35** | sweet spot interactif (default service) |
| 12 | 14.76 | 7.42 | NON — BW DRAM saturée |

En live (service prod, thinking=off, json_schema strict) : **~13.97 tok/s gen**.
(+60 % vs Ollama 0.24 qui faisait 8.74 sur le même modèle — voir bas de page.)

## Service systemd (user-level)

Fichier : `~/.config/systemd/user/gemma.service`

```ini
[Service]
Environment=THREADS=8
Environment=CONTEXT=8192      # 32K en E2B reste possible, mais 8K = KV cache chaud → +perf
Environment=PARALLEL=1
Environment=PORT=8080
Environment=HOST=127.0.0.1
ExecStart=%h/bunlight/vendor/gemma/scripts/start-server.sh
MemoryHigh=8G  MemoryMax=12G  CPUQuota=800%  Nice=5
```

`HOST=127.0.0.1` est volontaire — pour exposer en LAN/Internet, soit SSH tunnel, soit
reverse-proxy nginx avec auth, soit bind direct + UFW restreint à ton IP (voir bas).

```bash
systemctl --user start | stop | restart | status gemma
loginctl enable-linger ubuntu     # garantit que le service tourne hors session
```

## Spécifications Gemma 4 E2B-it (model card HF officielle, 2026-05-16)

Source : `https://huggingface.co/google/gemma-4-E2B-it`

### Roles
`system` · `user` · `assistant` — standardisés (changé vs Gemma 3 qui utilisait
`user` + tool flow propriétaire).

### Thinking mode
- **Trigger** : préfixer le `system` prompt avec `<|think|>`.
- **Output** : le modèle émet `<|channel>thought\n…<channel|>` AVANT la réponse finale.
- **Disable** : sans le préfixe `<|think|>`, le modèle génère un bloc vide
  `<|channel>thought\n<channel|>` puis la réponse — coût quelques tokens seulement.
- Via Transformers / llama.cpp `--jinja` : `enable_thinking=true|false` côté template.

### Sampling officiel (verbatim model card)
```
temperature = 1.0
top_p       = 0.95
top_k       = 64
```
Le package `@aphrody-code/llm-extract` utilise ces valeurs par défaut.

### Multimodal — ordre strict
> *"For optimal performance with multimodal inputs, place image and/or audio content
> **before** the text in your prompt."*

`extractFromImage()` côté llm-extract respecte automatiquement cet ordre.

### Function calling
Supporté nativement. Pas exposé dans le package par défaut — utiliser `response_format`
JSON-schema pour l'extraction structurée (déjà bien adapté à 99 % du scraping).

## Architecture du modèle

- **PLE (Per-Layer Embeddings)** : embeddings offloadés CPU → footprint d'un 2B alors
  que ~6B paramètres réels.
- **MatFormer** : E2B est sub-model de E4B (mix-and-match possible côté lib JAX).
- **Hybrid attention** : sliding window local + full global (final layer toujours globale).
- **Proportional RoPE (p-RoPE)** + **KV Cache Sharing** middle layers.
- **Vision** : MobileNet-V5-300M.
- **Audio** : USM (Universal Speech Model), ~160 ms par token.
- Training : 11T tokens, cutoff juin 2024, 140+ langues.
- License : **Apache 2.0** + Gemma Use Policy.

## Flags llama-server expliqués

Voir `scripts/start-server.sh`. Pièges :

```
-m       sources/llama.cpp absent → modèle (path absolu via $ROOT)
--mmproj                          → multimodal projector (image), nécessaire pour image_url
-t 8 -tb 8                        → matcher le sweet-spot bench
-c 8192                           → KV cache stays in cache hierarchy
-np 1                             → 1 slot, no contention (CPU bw-bound)
-b 2048 -ub 512                   → defaults llama.cpp
-fa on                            → flash attention
--cache-type-k q8_0               → KV quantizé → BW économisée
--cache-type-v q8_0
--no-mmap                         → load full RAM, évite page-fault stalls
--jinja                           → chat template Gemma natif (sinon metadata du GGUF)
--metrics                         → expose /metrics (Prometheus-style)
```

⚠ NE PAS passer `--image-min-tokens` à llama-server — bug avec l'attention non-causale
de Gemma 4 (cf model card discussions HF).

## API endpoints (OpenAI-compatible)

| Endpoint | Usage |
|---|---|
| `POST /v1/chat/completions` | chat avec `messages[]`, `response_format`, `chat_template_kwargs` |
| `POST /v1/completions` | complétion brute |
| `GET  /v1/models` | liste modèles chargés |
| `GET  /health` | 200 OK quand prêt, 503 pendant load |
| `GET  /props` | metadata modèle + flags actifs + chat template |
| `GET  /metrics` | Prometheus : `llamacpp:tokens_predicted_total`, `llamacpp:prompt_tokens_total`, etc. |
| `GET  /slots` | état des slots (avec `-np 1` : 1 entrée) |

## Exposer en remote

### A — SSH tunnel (recommandé)
```powershell
ssh -L 11434:127.0.0.1:8080 ubuntu@<ip-vps>
```

### B — Bind direct + UFW restreint à ton IP
```bash
sed -i 's/HOST=127.0.0.1/HOST=0.0.0.0/' ~/.config/systemd/user/gemma.service
systemctl --user daemon-reload && systemctl --user restart gemma
sudo ufw allow from 81.64.138.142 to any port 8080 proto tcp
```

## Code source & weights

| Type | Source | Cloné où / fetched comment |
|---|---|---|
| Lib JAX Google | github.com/google-deepmind/gemma v4.0.0 | submodule `sources/upstream/` |
| Inference C++ | github.com/ggml-org/llama.cpp | submodule `sources/llama.cpp/` + cmake build |
| Weights GGUF | huggingface.co/ggml-org/gemma-4-E2B-it-GGUF | `hf download` → `models/` (gitignored) |
| Weights safetensors | huggingface.co/google/gemma-4-E2B-it | nécessite `hf auth login` + accept licence Gemma |

```bash
# Pull / update weights
hf download ggml-org/gemma-4-E2B-it-GGUF --include "*Q8_0*" --local-dir models
```

## Env Python uv (exploration)

```bash
cd bunlight/vendor/gemma
uv sync
uv run python -c "import gemma; print(gemma.__version__)"   # → 4.0.0
```

Packages : `gemma` (JAX lib), `transformers` (5.8.x), `torch` (CPU), `accelerate`,
`huggingface_hub[cli]`, `numpy`, `pillow`, `soundfile`.

> Pipeline Python = ~3-5× plus lent que llama.cpp natif sur ce hardware. Préférer
> l'API REST `127.0.0.1:8080`. Le venv sert à explorer / tester le code source JAX,
> pas à servir en prod.

## Quand reconsidérer le choix de modèle

| Besoin | Modèle alternatif | GGUF |
|---|---|---|
| Plus de qualité reasoning, accepte 4-6 tok/s | Qwen 3 14B Q4_K_M | `bartowski/Qwen_Qwen3-14B-GGUF` |
| Code | Qwen 2.5 Coder 14B Q4 | `bartowski/Qwen2.5-Coder-14B-Instruct-GGUF` |
| Multimodal qualité++ | **Gemma 4 E4B Q8** | `ggml-org/gemma-4-E4B-it-GGUF` (9.6 GB, ~6 tok/s estimé) |
| MoE | Gemma 4 26B MoE Q4 (3.8 B actifs) | `ggml-org/gemma-4-26B-it-GGUF` (18 GB — limite RAM) |

Toujours bench avec `sources/llama.cpp/build/bin/llama-bench` avant de switcher en prod.

## Mises à jour

```bash
# llama.cpp
cd ~/bunlight/vendor/gemma/sources/llama.cpp && git pull
cmake --build build -j 12 --config Release
systemctl --user restart gemma

# Gemma JAX lib (exploration)
cd ~/bunlight/vendor/gemma/sources/upstream && git pull
uv sync

# Modèle (rare)
hf download ggml-org/gemma-4-E2B-it-GGUF --include "*Q8_0*" --local-dir models
systemctl --user restart gemma
```

## Pourquoi pas Ollama

Mesuré sur ce VPS, Ollama 0.24 tournait à **8.74 tok/s** sur `gemma4:e2b` alors que
llama.cpp natif Q8_0 fait **13.97 tok/s** (+60 %). Raison :
- Ollama package un build llama.cpp générique (pas `-DGGML_NATIVE=ON`).
- Pas de tuning per-host (threads = auto, BLAS non activé).
- Sur ce hardware bandwidth-bound, ces 2 facteurs coûtent ~30-40 %.

Coût : on perd l'auto-management des modèles (pull/list/ps/run). Acceptable ici car on
tourne un seul modèle en service.
