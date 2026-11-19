"""Exercise PDF/DOCX pipe modes in an explicit normal Windows executable.

Only committed synthetic fixtures are read. No personal vault or GUI is opened.
Usage: python native/scripts/normal-workers.py path/to/loklm-native.exe
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Expected an explicit normal executable path")
    executable = Path(sys.argv[1]).resolve(strict=True)
    fixtures = Path(__file__).resolve().parents[1] / "crates/documents/tests/fixtures"
    cases = [
        ("synthetic.pdf", True), ("broken-page.pdf", False),
        ("synthetic.docx", True), ("table.docx", True),
        ("header-reference.docx", False), ("uppercase-media.docx", False),
        ("inherited-list.docx", False), ("default-list.docx", False),
        ("style-linked-list.docx", False),
    ]
    results = []
    for name, success in cases:
        kind = "pdf" if name.endswith(".pdf") else "docx"
        process = subprocess.run(
            [str(executable), f"--loklm-{kind}-worker-v1"],
            input=(fixtures / name).read_bytes(), capture_output=True,
            timeout=45, check=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        value = json.loads(process.stdout)
        assert ("Ok" in value) == success, name
        if not success:
            assert isinstance(value.get("Err"), str), name
        elif kind == "pdf":
            pages = value["Ok"]["pages"]
            assert [p[0] for p in pages] == [1, 2], name
            assert "Grüße aus Köln" in pages[0][1] and "ALPHA-47" in pages[1][1], name
        else:
            assert value["Ok"]["markdown"].strip(), name
        results.append({"fixture": name, "imported": success, "passed": True})
    with executable.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    print(json.dumps({
        "executable": str(executable), "bytes": executable.stat().st_size,
        "sha256": digest,
        "checks": results,
        "scope": "Normal executable private parser pipe modes; no GUI/model test or installer claim",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
