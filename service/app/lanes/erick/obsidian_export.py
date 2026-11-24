"""Export a recorded GraphEvent log as a standalone Obsidian vault (graph view). No network, no LLM."""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
LOG_DIR = ROOT / "data" / "graph_events"
OUT_ROOT = ROOT / "data" / "obsidian"

# Same hex values as web/src/app/deepbridge.css --cat-1..4
CAT_RGB = {1: 0x38BDF8, 2: 0xA78BFA, 3: 0x34D399, 4: 0xFBBF24}
MOSS_RGB, CORE_RGB, PATH_RGB = 0xFF4D4D, 0xF8FAFC, 0xF472B6
HERO_RGB = 0xFACC15


def _clean(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|#^\[\]]', " ", s)
    return re.sub(r"\s+", " ", s).strip(" .")


def _yaml(v: str) -> str:
    return json.dumps(v, ensure_ascii=False)


class _Titles:
    def __init__(self) -> None:
        self.used: set[str] = set()

    def make(self, base: str) -> str:
        base = _clean(base)[:60].strip(" .") or "Untitled"
        t, i = base, 2
        while t.lower() in self.used:
            t = f"{base[: 60 - len(str(i)) - 3]} ({i})"
            i += 1
        self.used.add(t.lower())
        return t


def _node_info(n: dict, is_cat: bool) -> tuple[str, str, str]:
    """-> (kind, folder, title base)"""
    nid = n["id"]
    if is_cat or nid.startswith("category:"):
        return "category", "Categories", "Category - " + n["name"]
    if nid == "company:hopo":
        return "company", "Core", n["name"]
    if nid.startswith("org:"):
        return "org", "Buyers", n["name"]
    if nid.startswith("person:"):
        return "person", "People", n["name"]
    k = n.get("kind", "value")
    return k, "Core", f"{k.capitalize()} - {n.get('text', nid)}"


def _ev_md(evs: list[dict]) -> str:
    out = []
    for e in evs:
        link = f"[{e.get('kind', 'source')}]({e['source_url']})"
        q = (e.get("quote") or "").replace("\n", " ").strip()
        out.append(f"{link} _{q}_" if q else link)
    return "; ".join(out)


def export(session_id: str, out_dir: str | Path | None = None) -> dict:
    events = json.loads((LOG_DIR / f"{session_id}.json").read_text())
    out = Path(out_dir) if out_dir else OUT_ROOT / session_id
    out = out.resolve()
    if OUT_ROOT.resolve() not in out.parents:
        raise ValueError(f"refusing to write outside {OUT_ROOT}: {out}")
    events = sorted(events, key=lambda e: e.get("seq", 0))

    nodes: dict[str, dict] = {}  # id -> {n, kind, folder, layer}
    edges: dict[str, dict] = {}
    paths: dict[str, dict] = {}
    evid: dict[str, dict] = {}
    cat_of: dict[str, int] = {}
    moss_names: set[str] = set()
    for e in events:
        for ev in e.get("evidence") or []:
            evid[ev["id"]] = ev
        k = e["kind"]
        if k in ("node", "category"):
            n = e["node"]
            kind, folder, base = _node_info(n, k == "category")
            nodes[n["id"]] = {"n": n, "kind": kind, "folder": folder, "base": base, "layer": e["layer"]}
            if k == "category":
                m = re.search(r"--cat-(\d+)", n.get("colour", ""))
                if m:
                    cat_of[n["id"]] = int(m.group(1))
        elif k == "edge":
            edges[e["edge"]["id"]] = e["edge"]
        elif k == "path":
            paths[e["path"]["id"]] = e["path"]
        elif k == "status":
            m = re.match(r"Moss verified: (.+?),", e.get("status", ""))
            if m:
                moss_names.add(m.group(1).strip())
    edges = {i: x for i, x in edges.items() if x["from"] in nodes and x["to"] in nodes}
    # buyer orgs inherit category via FITS
    cat: dict[str, int] = dict(cat_of)
    for x in edges.values():
        if x["type"] == "FITS" and x["from"] in cat_of:
            cat.setdefault(x["to"], cat_of[x["from"]])

    titles = _Titles()
    for nid, d in nodes.items():
        d["title"] = titles.make(d["base"])
    outgoing: dict[str, list[dict]] = {}
    for x in edges.values():
        outgoing.setdefault(x["from"], []).append(x)

    if out.exists():
        shutil.rmtree(out)
    for f in ("Core", "Categories", "Buyers", "People", "Paths", ".obsidian"):
        (out / f).mkdir(parents=True)

    counts = {"Core": 0, "Categories": 0, "Buyers": 0, "People": 0, "Paths": 0, "links": 0}
    for nid, d in nodes.items():
        n = d["n"]
        tags = [f"layer/{d['layer']}", f"kind/{d['kind']}"]
        c = cat.get(nid)
        if c:
            tags.append(f"cat/{c}")
        if d["kind"] == "company":
            tags.append("hero")
        if d["kind"] == "person" and n["name"] in moss_names:
            tags.append("verified/moss")
        fm = ["---", f"id: {_yaml(nid)}", f"kind: {d['kind']}", f"layer: {d['layer']}"]
        if c:
            fm.append(f"category: {c}")
        fm += ["tags:"] + [f"  - {t}" for t in tags] + ["---", ""]
        body = [f"# {d['title']}", ""]
        text = n.get("text") or n.get("name") or nid
        body.append(text)
        if d["kind"] == "category":
            body += ["", n.get("value_prop", "")]
            body += [f"- Problem: {p}" for p in n.get("problem_set", [])]
        outs = sorted(outgoing.get(nid, []), key=lambda x: x["id"])
        if outs:
            body += ["", "## Links", ""]
            for x in outs:
                date = f" ({x['date']})" if x.get("date") else ""
                label = x.get("label") or x["type"]
                line = f"- {x['type']} → [[{nodes[x['to']]['title']}]] — {label}{date}"
                evs = [evid[i] for i in x.get("evidence_ids", []) if i in evid]
                if evs:
                    line += " — " + _ev_md(evs)
                body.append(line)
                counts["links"] += 1
        (out / d["folder"] / f"{d['title']}.md").write_text("\n".join(fm + body) + "\n")
        counts[d["folder"]] += 1

    # paths
    best = max((p["score"] for p in paths.values()), default=None)
    for i, p in enumerate(paths.values(), 1):
        if p["bridge_id"] not in nodes or p["buyer_org_id"] not in nodes:
            continue
        bridge, buyer = nodes[p["bridge_id"]]["title"], nodes[p["buyer_org_id"]]["title"]
        title = titles.make(f"Path {i} - {bridge} → {buyer}")
        chain, cur = [p["founder_id"]], p["founder_id"]
        for h in p["hops"]:
            x = edges.get(h)
            if not x:
                continue
            cur = x["to"] if x["from"] == cur else x["from"]
            chain.append(cur)
        if chain[-1] != p["buyer_org_id"]:
            chain.append(p["buyer_org_id"])
        chain = [c for c in chain if c in nodes]
        weak = edges.get(p["weakest_edge_id"])
        tags = ["path"] + (["path/top"] if p["score"] == best else [])
        fm = ["---", f"id: {_yaml(p['id'])}", "kind: path", "layer: lead", f"score: {p['score']}",
              "tags:"] + [f"  - {t}" for t in tags] + ["---", ""]
        body = [f"# {title}", "", f"- Score: {p['score']}", f"- Kind: {p['kind']}"]
        if weak:
            body.append(f"- Weakest edge: {weak['type']} — {weak.get('label') or weak['type']}")
        body += ["", "## Chain", ""]
        body.append(" → ".join(f"[[{nodes[c]['title']}]]" for c in chain))
        pev = [i for i in p.get("hops", [])]
        body += ["", "## Hops", ""]
        for h in pev:
            x = edges.get(h)
            if x:
                evs = [evid[j] for j in x.get("evidence_ids", []) if j in evid]
                body.append(f"- {x['type']}: [[{nodes[x['from']]['title']}]] → [[{nodes[x['to']]['title']}]] — "
                            f"{x.get('label') or x['type']}" + (f" — {_ev_md(evs)}" if evs else ""))
                counts["links"] += 1
        (out / "Paths" / f"{title}.md").write_text("\n".join(fm + body) + "\n")
        counts["Paths"] += 1

    groups = [("tag:#hero", HERO_RGB), ("tag:#verified/moss", MOSS_RGB)] + [(f"tag:#cat/{n}", c) for n, c in CAT_RGB.items()] + [
        ("tag:#layer/core", CORE_RGB), ("tag:#path", PATH_RGB)]
    graph = {
        "collapse-filter": False, "search": "", "showTags": False, "showAttachments": False,
        "hideUnresolved": False, "showOrphans": True, "collapse-color-groups": False,
        "colorGroups": [{"query": q, "color": {"a": 1, "rgb": c}} for q, c in groups],
        "collapse-display": False, "showArrow": True, "textFadeMultiplier": 0,
        "nodeSizeMultiplier": 1.4, "lineSizeMultiplier": 1, "collapse-forces": True,
        "centerStrength": 0.5, "repelStrength": 12, "linkStrength": 1, "linkDistance": 200,
    }
    (out / ".obsidian" / "graph.json").write_text(json.dumps(graph, indent=2) + "\n")
    (out / ".obsidian" / "app.json").write_text("{}\n")
    (out / "README.md").write_text(
        f"# DeepBridge graph: {session_id}\n\nOpen this folder as a vault in Obsidian, then Graph view (Cmd+G). "
        f"Generated from data/graph_events/{session_id}.json; cached/replayed data.\n")
    counts["notes"] = sum(counts[k] for k in ("Core", "Categories", "Buyers", "People", "Paths")) + 1
    return counts


if __name__ == "__main__":
    for sid in sys.argv[1:] or ["demo-hopo", "demo-lightmatter"]:
        print(sid, export(sid))
