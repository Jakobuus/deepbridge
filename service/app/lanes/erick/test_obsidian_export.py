"""python -m app.lanes.erick.test_obsidian_export (exit 1 on failure)"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path

from app.lanes.erick.obsidian_export import LOG_DIR, OUT_ROOT, export


def _hash(d: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(p for p in d.rglob("*") if p.is_file()):
        h.update(str(f.relative_to(d)).encode())
        h.update(f.read_bytes())
    return h.hexdigest()


def check(sid: str) -> list[str]:
    errs: list[str] = []
    counts = export(sid)
    out = OUT_ROOT / sid
    h1 = _hash(out)
    export(sid)
    if _hash(out) != h1:
        errs.append("not deterministic")
    notes = [p for p in out.rglob("*.md")]
    stems = {p.stem for p in notes}
    ev = json.loads((LOG_DIR / f"{sid}.json").read_text())
    nodes = {e["node"]["id"] for e in ev if e["kind"] in ("node", "category")}
    npaths = len({e["path"]["id"] for e in ev if e["kind"] == "path"})
    if len(notes) != len(nodes) + npaths + 1:
        errs.append(f"note count {len(notes)} != {len(nodes)}+{npaths}+1")
    if counts["notes"] != len(notes):
        errs.append("counts mismatch")
    for p in notes:
        t = p.read_text()
        if re.search(r"\bknows\b", t, re.IGNORECASE):
            errs.append(f"'knows' in {p.name}")
        for m in re.findall(r"\[\[([^\]]+)\]\]", t):
            if m not in stems:
                errs.append(f"broken link [[{m}]] in {p.name}")
    g = json.loads((out / ".obsidian" / "graph.json").read_text())
    if len(g["colorGroups"]) < 5:
        errs.append("colorGroups < 5")
    return errs


if __name__ == "__main__":
    bad = 0
    for s in ("demo-hopo", "demo-lightmatter"):
        e = check(s)
        print(s, "FAIL" if e else "ok", e[:5])
        bad += bool(e)
    sys.exit(1 if bad else 0)
