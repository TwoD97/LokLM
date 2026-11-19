#!/bin/sh
set -eu
# Never autodiscover or change a running user model. Only this dedicated mount.
case "${LOKLM_MODEL_PROFILE:-standard}" in
  lite) file=bge-m3-Q4_K_M.gguf; hash=e251234fcb7d050991a6be491952f485bf5c641dd10c3272dc1301fd281ad50f; pooling=mean; mode=--embedding ;;
  standard|pro) file=Qwen3-Embedding-0.6B-Q8_0.gguf; hash=06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439; pooling=last; mode=--embedding ;;
  reranker) file=bge-reranker-v2-m3-Q4_K_M.gguf; hash=e186a244ed455b4ab66ec64339ce7427a6ae13f5c0b5e544de96e50f0f8b3673; pooling=rank; mode=--reranking ;;
  answer) file=Qwen3.5-4B-Q4_K_M.gguf; hash=00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4; pooling=none; mode=answer ;;
  *) echo 'Unsupported LokLM profile' >&2; exit 1 ;;
esac
test -n "${LOKLM_MODEL_ALIAS:-}" || { echo 'LOKLM_MODEL_ALIAS required' >&2; exit 1; }
printf '%s  %s\n' "$hash" "/models/$file" | sha256sum -c - >/dev/null
if [ "$mode" = answer ]; then
  exec /opt/llama/llama-server --model "/models/$file" --alias "$LOKLM_MODEL_ALIAS" \
    --host 0.0.0.0 --port 8080 --ctx-size 4096 --parallel 1 --threads 2 --threads-batch 2 \
    --gpu-layers "${LOKLM_GPU_LAYERS:-0}" --jinja --no-warmup
fi
exec /opt/llama/llama-server --model "/models/$file" --alias "$LOKLM_MODEL_ALIAS" \
  "$mode" --pooling "$pooling" --host 0.0.0.0 --port 8080 --ctx-size 2048 \
  --parallel 1 --threads 2 --threads-batch 2 --batch-size 2048 --ubatch-size 2048 --gpu-layers "${LOKLM_GPU_LAYERS:-0}" --no-warmup
