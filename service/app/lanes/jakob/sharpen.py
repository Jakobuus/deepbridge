"""Interview answers sharpen the knowledge graph: keyword -> HOPO category weights + value nodes to confirm.

Fire-and-forget POST to the graph lane's `/graph/sharpen`; skipped silently when that route is missing or slow.
"""
import json
import os
import re
import threading
from pathlib import Path
from urllib.request import Request, urlopen

_FIXTURE = Path(__file__).resolve().parents[4] / 'fixtures' / 'value_map_hopo.json'
CATEGORIES = {  # category -> (answer keywords, weight when mentioned, node id markers)
    'radiation': (r'radiat|plutonium|americium|uranium|nuclear|radioactive|dirty bomb|stockpile|BARDA|defen[cs]e|'
                  r'military|emergenc|first responder|actinide', 1.0, ('hopo-rad-', 'hopo-c-oral', 'hopo-f-decorp')),
    'lead': (r'\blead\b|child|kid|paediatric|pediatric|applesauce|poison', 0.9, ('hopo-lead-',)),
    'pet': (r'\bPET\b|imaging|scan|radiopharm|zirconium|tracer|Bayer|cancer', 0.8,
            ('hopo-pet-', 'hopo-v-pet', 'hopo-b-pet', 'hopo-f-zr')),
    'gd': (r'\bMRI\b|gadolinium|contrast', 0.8, ('hopo-gd-', 'hopo-v-gd', 'hopo-b-gd', 'hopo-f-gd', 'hopo-p-gd')),
}
UNMENTIONED = 0.35
_node_ids: list[str] | None = None


def _nodes() -> list[str]:
    global _node_ids
    if _node_ids is None:
        try:
            _node_ids = sorted(set(re.findall(r'"(value:hopo-[a-z0-9-]+)"', _FIXTURE.read_text())))
        except OSError:
            _node_ids = []
    return _node_ids


def mapping(answers: list[str]) -> dict:
    """Deterministic: which categories the founder's answers so far point at."""
    text = ' '.join(answers)
    weights, confirm = {}, []
    for category, (pattern, weight, markers) in CATEGORIES.items():
        hit = bool(re.search(pattern, text, re.I))
        weights[category] = weight if hit else UNMENTIONED
        if hit:
            confirm += [node for node in _nodes() if any(marker in node for marker in markers)]
    return {'confirm': list(dict.fromkeys(confirm)), 'fade': [], 'category_weights': weights}


def send(graph_session: str, answers: list[str]) -> dict:
    """Post the mapping in a background thread (1.5 s timeout, errors and 404 ignored); returns the payload."""
    payload = mapping(answers)
    base = os.environ.get('DEEPBRIDGE_API', 'http://127.0.0.1:8000').rstrip('/')

    def post():
        try:
            request = Request(f'{base}/graph/sharpen?session_id={graph_session}', data=json.dumps(payload).encode(),
                              headers={'Content-Type': 'application/json'}, method='POST')
            urlopen(request, timeout=1.5).close()
        except Exception:  # HACK: route may not exist yet (404) or be slow; the interview never waits on it.
            pass

    threading.Thread(target=post, daemon=True).start()
    return payload
