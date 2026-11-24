"""Interview answers sharpen the knowledge graph: keyword -> HOPO category weights + value nodes to confirm.

Fire-and-forget POST to the graph lane's `/graph/sharpen`; skipped silently when that route is missing or slow.
"""
import json
import os
import queue
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


KNOWN_ORGS = ('Bayer', 'BARDA', 'FDA', 'NIH', 'CDC', 'HHS', 'DoD', 'Department of Defense', 'Army', 'Navy',
              'Berkeley Lab', 'Lawrence Berkeley', 'Novartis', 'Lantheus', 'GE Healthcare', 'Bracco', 'Guerbet',
              'Siemens', 'Curium', 'Telix', 'RayzeBio', 'Fusion Pharma', 'Strategic National Stockpile', 'NATO',
              'WHO', 'Medicaid', 'UCSF', 'Stanford', 'MIT', 'Harvard')
_STOP = {'I', 'We', 'The', 'They', 'It', 'Our', 'And', 'But', 'So', 'Then', 'First', 'Yes', 'No', 'Maybe', 'Also',
         'Hi', 'PET', 'MRI', 'HOPO', 'My', 'Their', 'That', 'This', 'For', 'Probably', 'Governments', 'Government'}
_NAME = re.compile(r"\b(?:Dr\.?\s+)?[A-ZÀ-Þ][\w'’-]+(?:\s+(?:[A-Z]\.\s*)?[A-ZÀ-Þ][\w'’-]+)+\b")
_GROUPS = (r'government|stockpile|defen[cs]e|military|hospital|radiopharma\w*|pharma companies|'
           r'imaging (?:centers|companies)|public health|pediatric\w*|paediatric\w*|contrast makers')


def _slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.casefold()).strip('-')[:40]


def _category(text):
    return next((c for c, (pattern, _, _) in CATEGORIES.items() if re.search(pattern, text, re.I)), None)


def entities(answer: str, topic: int) -> list[dict]:
    """Stage mode: deterministic orgs / people / value phrase from one answer (topic 0 value, 1 buyers, 2 people)."""
    found, seen = [], set()
    answer_category = _category(answer)

    def add(label, kind):
        label = ' '.join(label.split()).strip(' .,;:')
        if label and not any(label.casefold() in old for old in seen):
            seen.add(label.casefold())
            found.append({'id': f'interview:{kind}:{_slug(label)}', 'label': label, 'kind': kind,
                          'category': _category(label) or (None if kind == 'person' else answer_category)})
    if topic == 0:
        first = re.split(r'(?<=[.!?;])\s|,\s(?:for|so|and)\s', ' '.join(answer.split()))[0]
        add(' '.join(first.split()[:9]), 'value')
    for org in KNOWN_ORGS:
        if re.search(r'\b' + re.escape(org) + r'\b', answer):
            add(org, 'buyer')
    for match in _NAME.finditer(answer):
        words = [w for w in match[0].split() if w not in _STOP]
        if len(words) >= 2 and not any(org.casefold() in match[0].casefold() for org in KNOWN_ORGS):
            add(' '.join(words), 'person' if topic == 2 or match[0].startswith('Dr') else 'buyer')
    for group in re.findall(_GROUPS, answer, re.I):
        add(group[:1].upper() + group[1:], 'buyer')
    return found[:6]


def _post(base, graph_session, body):
    try:
        request = Request(f'{base}/graph/sharpen?session_id={graph_session}', data=json.dumps(body).encode(),
                          headers={'Content-Type': 'application/json'}, method='POST')
        urlopen(request, timeout=1.5).close()
    except Exception:  # HACK: route may be missing or slow; the interview never waits on it.
        pass


def send(graph_session: str, answers: list[str], latest: str = '', topic: int = 0, extractor=None) -> dict:
    """Fast path (<5 ms): match existing graph nodes -> strengthen; unknown names -> add_nodes; post in a thread.
    Slow path: optional LLM extractor in a daemon thread with a hard 2 s timeout; new finds -> a second post."""
    from . import graph_match
    matched = graph_match.match(latest)
    known = {m['name'].casefold() for m in matched}
    payload = mapping(answers)
    latest_categories = [c for c, (pattern, _, _) in CATEGORIES.items() if re.search(pattern, latest, re.I)]
    payload['add_nodes'] = [n for n in entities(latest, topic) if not any(
        n['label'].casefold() in name or name in n['label'].casefold() for name in known)
        and not any(m['kind'] in ('org', 'person') for m in graph_match.match(n['label']))]
    payload['strengthen'] = latest_categories + [m['id'] for m in matched] + [n['id'] for n in payload['add_nodes']]
    payload['matched'] = [{'id': m['id'], 'name': m['name'], 'kind': m['kind']} for m in matched]
    payload['note'] = ' '.join(latest.split())[:200]
    base = os.environ.get('DEEPBRIDGE_API', 'http://127.0.0.1:8000').rstrip('/')
    body = {k: v for k, v in payload.items() if k != 'matched'}

    def run():
        _post(base, graph_session, body)
        if extractor is None:
            return
        results = queue.Queue()
        threading.Thread(target=lambda: results.put(extractor(latest)), daemon=True).start()
        try:
            found = results.get(timeout=2)
        except Exception:
            return
        have = known | {n['label'].casefold() for n in payload['add_nodes']}
        extra = [{'id': f'interview:{e["kind"]}:{_slug(e["label"])}', 'label': e['label'], 'kind': e['kind'],
                  'category': _category(e['label']) or _category(latest)}
                 for e in found or [] if e['label'].casefold() not in have
                 and not graph_match.match(e['label'])]
        if extra:
            _post(base, graph_session, {'add_nodes': extra, 'strengthen': [e['id'] for e in extra],
                                        'note': 'More from the answer: ' + ', '.join(e['label'] for e in extra)})

    threading.Thread(target=run, daemon=True).start()
    return payload
