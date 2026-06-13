#!/usr/bin/env python3
"""score_comet , referenz-basiertes COMET-scoring für einen translation-run.

läuft NACH pnpm evals:translation über den run-dir und schreibt pro config
ein comet-scores.json (+ comet-segments.jsonl für die fehleranalyse) neben
das result.json. danach: pnpm evals:translation:report -- --run-dir <dir>
und die summary hat COMET-matrizen + COMET-basierte verdicts.

modell ist Unbabel/wmt22-comet-da (apache-2.0 , XLM-R-basiert , deckt alle
eval-sprachen ab). erster lauf lädt ~2.3 GB von HF , kein token nötig.

setup (einmalig , siehe auch README):
    py -3.12 -m venv .venv-comet
    .venv-comet\\Scripts\\pip install torch --index-url https://download.pytorch.org/whl/cu128
    .venv-comet\\Scripts\\pip install -r tests/evals/translation/comet/requirements.txt

usage:
    .venv-comet\\Scripts\\python tests/evals/translation/comet/score_comet.py --run-dir <dir>
        [--model Unbabel/wmt22-comet-da] [--batch-size 64] [--cpu]
"""

import argparse
import json
import sys
from pathlib import Path


def read_segments(per_question: Path) -> list[dict]:
    segments = []
    with per_question.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                segments.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # halbe zeile von einem crash , vom worker eh neu übersetzt
    return segments


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--model", default="Unbabel/wmt22-comet-da")
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--cpu", action="store_true", help="ohne GPU scoren (langsam aber geht)")
    args = ap.parse_args()

    configs_root = Path(args.run_dir) / "configs"
    if not configs_root.is_dir():
        print(f"kein configs/ unter {args.run_dir}", file=sys.stderr)
        return 2

    config_dirs = sorted(
        d for d in configs_root.iterdir() if d.is_dir() and (d / "per-question.jsonl").exists()
    )
    if not config_dirs:
        print(f"keine per-question.jsonl unter {configs_root}", file=sys.stderr)
        return 2

    # import erst hier — argparse-fehler sollen nicht erst nach dem 30s-torch-import kommen.
    from comet import download_model, load_from_checkpoint  # noqa: PLC0415

    print(f"[comet] lade {args.model} …", file=sys.stderr)
    ckpt = download_model(args.model)
    model = load_from_checkpoint(ckpt)
    gpus = 0 if args.cpu else 1

    for config_dir in config_dirs:
        out_path = config_dir / "comet-scores.json"
        if out_path.exists():
            print(f"[comet] {config_dir.name} — comet-scores.json schon da , skip", file=sys.stderr)
            continue
        segments = read_segments(config_dir / "per-question.jsonl")
        if not segments:
            print(f"[comet] {config_dir.name} — leer , skip", file=sys.stderr)
            continue

        data = [{"src": s["src"], "mt": s["hyp"], "ref": s["ref"]} for s in segments]
        print(f"[comet] {config_dir.name}: {len(data)} segmente …", file=sys.stderr)
        prediction = model.predict(data, batch_size=args.batch_size, gpus=gpus)
        scores = prediction["scores"]

        directions: dict[str, dict] = {}
        seg_lines = []
        for seg, score in zip(segments, scores):
            d = directions.setdefault(seg["direction"], {"sum": 0.0, "n": 0})
            d["sum"] += score
            d["n"] += 1
            seg_lines.append(
                json.dumps(
                    {"direction": seg["direction"], "ix": seg["ix"], "comet": round(score, 5)},
                    ensure_ascii=False,
                )
            )

        result = {
            "model": args.model,
            "directions": {
                k: {"mean": round(v["sum"] / v["n"], 5), "n": v["n"]}
                for k, v in sorted(directions.items())
            },
        }
        out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        (config_dir / "comet-segments.jsonl").write_text(
            "\n".join(seg_lines) + "\n", encoding="utf-8"
        )
        print(f"[comet] {config_dir.name} → {out_path}", file=sys.stderr)

    print(
        "[comet] fertig. report neu bauen: pnpm evals:translation:report -- "
        f'--run-dir "{args.run_dir}"',
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
