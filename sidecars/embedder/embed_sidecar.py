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
import re
import sys

# Lone UTF-16 surrogates (a split astral char — Gothic, Linear B, emoji, …, left
# half-paired by a caller's char-slice). Python's json.loads already folds valid
# surrogate PAIRS into single astral code points, so this class only ever matches
# UNPAIRED halves. The Rust tokenizer rejects them ("TextEncodeInput must be
# Union[...]") and fails the WHOLE batch, so we strip them before encoding.
_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


def _strip_surrogates(t: str) -> str:
    return _LONE_SURROGATE.sub("", t) if isinstance(t, str) else ""


def _emit(obj: dict) -> None:
    """Write one NDJSON frame to stdout and flush (stdout is block-buffered when
    piped, so an unflushed `ready`/response would hang the parent's handshake)."""
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _log(line: str) -> None:
    """Free-form log text goes to stderr (the parent forwards it to onLog)."""
    sys.stderr.write(line + "\n")
    sys.stderr.flush()


_DIAG_BUDGET = [10]  # mutable cell: cap diagnostic dumps so logs don't flood


def _diag(tag: str, t: str) -> None:
    """Dump a passage that broke the tokenizer: its length, whether it carries
    unpaired surrogates, the non-ASCII code points (hex), and a short repr — so
    the exact trigger is visible in one run. Budget-limited per process."""
    if _DIAG_BUDGET[0] <= 0:
        return
    _DIAG_BUDGET[0] -= 1
    has_sur = any(0xD800 <= ord(c) <= 0xDFFF for c in t)
    nonascii = [(i, hex(ord(c))) for i, c in enumerate(t) if ord(c) > 0x7F][:40]
    _log(f"DIAG {tag}: len={len(t)} unpaired_surrogate={has_sur} "
         f"nonascii[:40]={nonascii} repr={t[:120]!r}")


def _force_utf8_io() -> None:
    """The parent speaks UTF-8 NDJSON, but on Windows a child's piped stdin/stdout
    default to the locale code page (e.g. cp1252). Reading UTF-8 as cp1252 mangles
    every non-ASCII passage into mojibake AND turns multi-byte chars into lone
    surrogates that the tokenizer rejects — so multilingual text embeds as garbage
    or fails outright. Force UTF-8 on both directions. errors='replace' on input
    maps any genuinely invalid byte to U+FFFD instead of a surrogate/crash."""
    for stream, errs in ((sys.stdin, "replace"), (sys.stdout, "strict"),
                         (sys.stderr, "replace")):
        try:
            stream.reconfigure(encoding="utf-8", errors=errs)  # type: ignore[attr-defined]
        except Exception:
            pass


def _is_oom(e: BaseException) -> bool:
    """True for a CUDA out-of-memory error. torch raises torch.cuda.OutOfMemoryError
    (a RuntimeError subclass), but some paths surface a plain RuntimeError carrying
    the text — so match the message rather than the type."""
    return "out of memory" in str(e).lower()


def _free_cuda() -> None:
    """Return PyTorch's cached-but-unused VRAM to the driver. Matters because the
    embedder shares the GPU with the llama.cpp chat LLM + reranker: after an OOM the
    caching allocator can hold freed blocks that neither the retry nor the other
    process can use until they are released."""
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def main() -> int:
    _force_utf8_io()
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
        # Strip lone surrogates up front (see _LONE_SURROGATE): a caller's
        # char-slice can split an astral char across a chunk boundary, and one
        # such half anywhere in the batch makes the tokenizer reject the WHOLE
        # batch — forcing the slow per-item path and killing the ~12x throughput.
        # Cleaning here keeps batches intact regardless of how the caller sliced.
        clean = [_strip_surrogates(t) for t in texts]
        # Preserve the parent's Array<vec|null> contract: empty/whitespace inputs
        # map to null WITHOUT being sent through the model (encode would waste a
        # row and the parent treats null as "skip this chunk").
        idx_nonempty = [i for i, t in enumerate(clean) if t.strip()]
        out: list = [None] * len(texts)

        def _encode(items: list, bs: int) -> list:
            return list(model.encode(
                items,
                batch_size=bs,
                normalize_embeddings=normalize,
                convert_to_numpy=True,
                show_progress_bar=False,
            ))

        def _encode_adaptive(items: list, bs: int) -> list:
            # On a CUDA OOM, free the cache, halve the batch, and recurse on each
            # half — so a momentary VRAM spike (the shared llama.cpp chat LLM /
            # reranker growing on the same GPU) costs a few extra forward passes
            # instead of collapsing to the per-item path, which is ~batch_size×
            # slower. Bottoms out at a single item; one sequence that still won't
            # fit re-raises and is handled per-item (nulled, deferred to backfill).
            try:
                return _encode(items, bs)
            except Exception as e:
                if not _is_oom(e):
                    raise
                _free_cuda()
                if len(items) <= 1:
                    raise
                mid = len(items) // 2
                nbs = max(1, bs // 2)
                _log(f"CUDA OOM on {len(items)} texts @ batch={bs}; "
                     f"splitting {mid}/{len(items) - mid} @ batch={nbs}")
                return (_encode_adaptive(items[:mid], nbs)
                        + _encode_adaptive(items[mid:], nbs))

        if idx_nonempty:
            payload = [clean[i] for i in idx_nonempty]
            try:
                vecs = _encode_adaptive(payload, batch_size)
                for k, i in enumerate(idx_nonempty):
                    out[i] = vecs[k].tolist()
            except Exception as e:
                # Adaptive splitting bottomed out on a single oversized sequence, or
                # this is a non-OOM tokenizer/encoder fault. Isolate per item so one
                # bad passage never nulls the whole batch — and the request NEVER
                # fails, or the parent would tear down the sidecar and drop the rest
                # of the corpus onto the slow embedder. Null items defer to backfill.
                _log(f"batch encode failed ({e}); retrying per-item")
                _free_cuda()
                for i in idx_nonempty:
                    try:
                        out[i] = _encode([clean[i]], 1)[0].tolist()
                    except Exception as e_single:
                        _diag(f"passage#{i} single-encode failed "
                              f"({type(e_single).__name__})", clean[i])
                        out[i] = None
                        if _is_oom(e_single):
                            _free_cuda()
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
