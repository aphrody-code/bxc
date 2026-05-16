#!/usr/bin/env bash
# llama-server prod — gemma-4-E2B-it Q4_0 sur VPS KVM Haswell 12c (AVX2, no GPU).
#
# Bench combos 2026-05-16 (-t 8 -p 256 -n 128, KV q4_0 supporté seulement avec -fa) :
#
#   KV f16 + no FA  (initial)  : 50.8 pp / 19.6 tg
#   KV f16 + FA on  (WINNER)   : 72.4 pp / 20.7 tg   ← prod : +43% pp, +6% gen
#   KV q8_0 + FA on            : 46.6 pp / 20.1 tg
#   KV q4_0 + FA on            : 47.8 pp / 19.7 tg
#
# Le KV en f16 + flash-attention domine — pas besoin de quantizer le KV cache.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$ROOT/sources/llama.cpp/build/bin/llama-server"
MODEL="$ROOT/models/google_gemma-4-E2B-it-Q4_0.gguf"
MMPROJ="$ROOT/models/mmproj-gemma-4-E2B-it-Q8_0.gguf"
LOOKUP="$ROOT/models/lookup-cache.bin"

THREADS="${THREADS:-8}"
CONTEXT="${CONTEXT:-8192}"
PARALLEL="${PARALLEL:-1}"
PORT="${PORT:-8080}"
HOST="${HOST:-127.0.0.1}"

[ -f "$LOOKUP" ] || : > "$LOOKUP"

exec "$BIN" \
  -m "$MODEL" \
  --mmproj "$MMPROJ" \
  -t "$THREADS" -tb "$THREADS" \
  --cpu-strict 1 --prio 2 \
  -c "$CONTEXT" \
  -np "$PARALLEL" \
  -b 2048 -ub 512 \
  -fa on \
  --no-mmap --mlock --no-warmup \
  --jinja --reasoning off --reasoning-budget 0 \
  --cache-prompt --cache-reuse 256 \
  --lookup-cache-dynamic "$LOOKUP" \
  --metrics \
  --host "$HOST" --port "$PORT"
