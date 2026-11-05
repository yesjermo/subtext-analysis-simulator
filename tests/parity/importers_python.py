"""Dump what subtext/importers.py reads from each sample export, for tests/parity/importers_js.js."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from subtext.importers import read_export  # noqa: E402

files = sorted(p for p in (ROOT / "examples").rglob("*") if p.suffix in (".json", ".xml", ".txt", ".csv") and p.name != "demos.json")
out = [{"file": str(f.relative_to(ROOT)), "name": f.name, "raw": f.read_text(encoding="utf-8"),
        "py": [c.to_dict() for c in read_export(f)]} for f in files]
Path(sys.argv[1]).write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
