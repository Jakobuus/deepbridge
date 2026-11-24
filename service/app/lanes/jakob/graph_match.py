"""Match a founder's spoken answer to nodes already in the demo graph, in well under 5 ms.

Index built once from the recorded demo-hopo graph: value nodes, buyer orgs, bridge people, categories.
Matching: lowercase, pad with spaces, whole-word / multiword `in` checks against each node's specific terms;
value nodes additionally need enough token overlap with their text.
"""
import json
import re
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[4]
_GRAPH = _ROOT / 'data' / 'graph_events' / 'demo-hopo.json'
_STOP = set('''the and for with from that this into over under after before their there about which while where
them they have been were also than then only more most less very such other using based study studies data
using agent agents could would should between within without across among early late high higher low lower
national institute institutes university center centre department health research laboratory hospital public
medical sciences science international state united states france germany japan company corporation agency
office foundation council children's children'''.split())
ORG_ALIASES = {  # spoken word -> fragment of the org's name
    'stockpile': ('strategic preparedness', 'biomedical advanced research'), 'sns': ('strategic preparedness',),
    'aspr': ('strategic preparedness',), 'barda': ('biomedical advanced research',),
    'livermore': ('lawrence livermore',), 'llnl': ('lawrence livermore',), 'cea': ('commissariat',),
    'aachen': ('aachen',), 'nih': ('national institutes of health',), 'cdc': ('centers for disease control',),
    'army': ('united states army',), 'military': ('united states army', 'bundeswehr'),
    'defense': ('united states army', 'bundeswehr', 'uniformed services'), 'bundeswehr': ('bundeswehr',),
    'epa': ('environmental protection agency',), 'nci': ('national cancer institute',),
    'niaid': ('allergy and infectious',), 'inserm': ('inserm',), 'cnrs': ('centre national de la recherche',),
    'ukhsa': ('uk health security',), 'bayer': ('bayer',), 'guerbet': ('guerbet',), 'bracco': ('bracco',),
    'orano': ('orano',), 'genentech': ('genentech',), 'regeneron': ('regeneron',), 'lundbeck': ('lundbeck',),
    'lumiphore': ('lumiphore',), 'irsn': ('radioprotection et de',), 'atsdr': ('toxic substances',),
    'mass general': ('massachusetts general',), 'montefiore': ('montefiore',), 'sri': ('sri international',),
    'rti': ('rti international',), 'health canada': ('health canada',), 'barc': ('bhabha',),
}
SYNONYMS = {'pill': 'oral orally', 'pills': 'oral orally', 'swallow': 'oral orally', 'mouth': 'oral orally',
            'kids': 'children paediatric pediatric lead', 'kid': 'children paediatric lead',
            'imaging': 'pet imaging', 'scan': 'pet imaging', 'scans': 'pet imaging', 'mri': 'gadolinium contrast',
            'radiation': 'radiological actinide decorporation', 'plutonium': 'actinide plutonium decorporation',
            'nuclear': 'radiological actinide', 'safe': 'safety tolerated', 'safety': 'safety tolerated'}
_index: list[dict] | None = None


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-zà-ÿ0-9']+", text.lower()) if len(w) >= 4 and w not in _STOP}


def _padded(text: str) -> str:
    return ' ' + ' '.join(re.findall(r"[a-zà-ÿ0-9']+", text.lower())) + ' '


def build() -> list[dict]:
    global _index
    index = []
    try:
        events = json.loads(_GRAPH.read_text())
    except (OSError, ValueError):
        events = []
    seen = set()
    for event in events:
        node = event.get('node') or {}
        node_id = node.get('id', '')
        if not node_id or node_id in seen or event.get('kind') not in ('node', 'category'):
            continue
        seen.add(node_id)
        name = node.get('name') or node.get('text') or ''
        if node_id.startswith('org:'):
            clean = re.sub(r'\s*\(.*?\)', '', name)
            terms = {_padded(clean).strip()}
            terms |= {alias for alias, frags in ORG_ALIASES.items() if any(f in clean.lower() for f in frags)}
            index.append({'id': node_id, 'name': clean, 'kind': 'org', 'terms': terms})
        elif node_id.startswith('person:'):
            parts = [p for p in re.findall(r"[^\W\d_][\w'’-]+", name) if len(p) > 1]
            terms = {_padded(name).strip()} | ({parts[-1].lower()} if parts and len(parts[-1]) > 3 else set())
            if len(parts) >= 2:
                terms.add(f'{parts[0]} {parts[-1]}'.lower())
            index.append({'id': node_id, 'name': name, 'kind': 'person', 'terms': terms})
        elif node_id.startswith('value:'):
            index.append({'id': node_id, 'name': name, 'kind': 'value', 'tokens': _tokens(name)})
    _index = index
    return index


def match(answer: str, max_values: int = 5) -> list[dict]:
    """Existing graph nodes this answer mentions: [{id, name, kind, score}], orgs/people first."""
    index = _index if _index is not None else build()
    padded = _padded(answer)
    expanded = padded + ' '.join(SYNONYMS.get(w, '') for w in padded.split()) + ' '
    words = set(expanded.split())
    hits, values = [], []
    for node in index:
        if node['kind'] in ('org', 'person'):
            if any(f' {term} ' in padded for term in node['terms']):
                hits.append({'id': node['id'], 'name': node['name'], 'kind': node['kind'], 'score': 1.0})
        elif node['tokens']:
            overlap = node['tokens'] & words
            score = len(overlap) / min(len(node['tokens']), 6)
            if len(overlap) >= 2 and score >= 0.2:  # one specific term plus overlap
                values.append({'id': node['id'], 'name': node['name'][:80], 'kind': 'value', 'score': round(score, 2)})
    values.sort(key=lambda v: -v['score'])
    return hits + values[:max_values]
