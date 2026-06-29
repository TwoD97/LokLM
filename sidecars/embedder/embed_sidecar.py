#!/usr/bin/env python3
"""
loklm-embedder sidecar — high-throughput batched text embedding for the Pro tier
on NVIDIA GPUs, using PyTorch + sentence-transformers. Replaces node-llama-cpp
ONLY for embedding (chat LLM + reranker stay on llama.cpp).

Why this exists: node-llama-cpp/llama.cpp embed one sequence per decode and cap
at ~6-11k tok/s on a 5090 (GPU idles at ~175W) — measured 2026-06-29. PyTorch
fp16 with true batched matmuls hits ~74k tok/s on the same model/GPU (~12x).

Protocol — newline-delimited JSON (NDJSON) over stdin/stdout, mirroring the
translator sidecar (see sidecars/translator/README.md and TranslatorSidecar.ts):
  * On successful model load the sidecar emits:           {"ev":"ready"}
  * On a fatal load error it emits and exits:             {"ev":"fatal","error":"..."}
  * Requests (one JSON object per line):                  {"id":N,"op":"...",...}
  * Responses carry the same id:                          {"id":N,"ok":true,...}
                                                          {"id":N,"ok":false,"error":"..."}
Ops:
  embed    {"id":N,"op":"embed","texts":[...],"batch_size":64,"normalize":true}
           -> {"id":N,"ok":true,"vectors":[[...]|null, ...]}   (null for empty input)
  ping     {"id":N,"op":"ping"}      -> {"id":N,"ok":true}
  shutdown {"id":N,"op":"shutdown"}  -> {"id":N,"ok":true} then exit

The process exits when stdin closes, so a dead parent can't leave a torch process
holding VRAM (same orphan-safety contract as the translator sidecar).
"""

import argparse
import json
import sys


def _emit(obj: dict) -> None:
    """Write one NDJSON frame to stdout and flush (stdout is block-buffered when
    piped, so an unflushed `ready`/response would hang the parent's handshake)."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _log(line: str) -> None:
    """Free-form log text goes to stderr (the parent forwards it to onLog)."""
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-Embedding-0.6B",
                    help="HF model id or local path to the embedding model")
    ap.add_argument("--device", default="cuda", help="cuda | cpu")
    ap.add_argument("--dtype", default="float16", help="float16 | bfloat16 | float32")
    ap.add_argument("--max-seq", type=int, default=512,
                    help="max tokens per sequence (caps padding/VRAM; chunks are ~400 tok)")
    ap.add_argument("--default-batch", type=int, default=64)
    args = ap.parse_args()

    # Heavy imports happen AFTER arg parsing so --help is instant and an import
    # failure is reported as a clean fatal rather than a stack trace on spawn.
    try:
        import torch  # noqa: F401
        from sentence_transformers import SentenceTransformer
    except Exception as e:  # pragma: no cover - import-time environment issue
        _emit({"ev": "fatal", "error": f"import failed: {e}"})
        return 1

    try:
        import torch
        dtype = {"float16": torch.float16, "bfloat16": torch.bfloat16,
                 "float32": torch.float32}.get(args.dtype, torch.float16)
        device = args.device
        if device == "cuda" and not torch.cuda.is_available():
            # No usable CUDA inside the (possibly device-pinned) sidecar — fail
            # cleanly so the parent falls back to the node-llama-cpp embedder
            # instead of silently embedding on a slow CPU torch path.
            _emit({"ev": "fatal", "error": "cuda requested but torch.cuda.is_available() is False"})
            return 1
        model = SentenceTransformer(
            args.model,
            device=device,
            model_kwargs={"torch_dtype": dtype, "attn_implementation": "sdpa"},
        )
        model.max_seq_length = args.max_seq
        dev_name = torch.cuda.get_device_name(0) if device == "cuda" else "cpu"
        _log(f"[embed-sidecar] loaded {args.model} on {device} ({dev_name}) "
             f"dtype={args.dtype} max_seq={args.max_seq}")
    except Exception as e:
        _emit({"ev": "fatal", "error": f"model load failed: {e}"})
        return 1

    _emit({"ev": "ready"})

    def handle_embed(req: dict) -> dict:
        texts = req.get("texts") or []
        batch_size = int(req.get("batch_size") or args.default_batch)
        normalize = bool(req.get("normalize", True))
        # Preserve the parent's Array<vec|null> contract: empty/whitespace inputs
        # map to null WITHOUT being sent through the model (encode would waste a
        # row and the parent treats null as "skip this chunk").
        idx_nonempty = [i for i, t in enumerate(texts) if isinstance(t, str) and t.strip()]
        out: list = [None] * len(texts)
        if idx_nonempty:
            payload = [texts[i] for i in idx_nonempty]
            vecs = model.encode(
                payload,
                batch_size=batch_size,
                normalize_embeddings=normalize,
                convert_to_numpy=True,
                show_progress_bar=False,
            )
            for k, i in enumerate(idx_nonempty):
                out[i] = vecs[k].tolist()
        return {"id": req["id"], "ok": True, "vectors": out}

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception:
            _log(f"dropped unparseable line: {line[:200]}")
            continue
        rid = req.get("id")
        op = req.get("op")
        try:
            if op == "embed":
                _emit(handle_embed(req))
            elif op == "ping":
                _emit({"id": rid, "ok": True})
            elif op == "shutdown":
                _emit({"id": rid, "ok": True})
                break
            else:
                _emit({"id": rid, "ok": False, "error": f"unknown op: {op}"})
        except Exception as e:
            _emit({"id": rid, "ok": False, "error": str(e)})

    return 0


if __name__ == "__main__":
    sys.exit(main())
