"""Record the canonical demo-hopo GraphEvent log from cached data only (no LLM, no network).

Run from service/:  uv run python -m app.lanes.erick.record_log
"""
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

from ...models import Org
from . import build, paths

ROOT = Path(__file__).resolve().parents[4]
FIX = ROOT / 'fixtures'
OUT = ROOT / 'data' / 'graph_events' / 'demo-hopo.json'
FOUNDER = 'person:openalex:A5043992375'
HERO = 'person:openalex:A5085203145'
MAX_PATHS = 8
SPAN = 300  # seconds covered by the recording


def _load(name):
    return json.loads((FIX / name).read_text(encoding='utf-8'))


def _dump(m):
    return m.model_dump(mode='json', by_alias=True) if hasattr(m, 'model_dump') else m


def _ev(ids, pool):
    return [pool[i] for i in ids if i in pool]


def build_log(session_id='demo-hopo'):
    vm, cats, buyers = _load('value_map_hopo.json'), _load('categories_hopo.json'), _load('buyers_hopo.json')
    brief, contacts = _load('briefing_demo_hopo.json')['briefing'], _load('contacts.json')
    pool = {e['id']: e for e in vm['evidence'] + contacts['evidence']}
    buyer_orgs = [Org.model_validate({k: v for k, v in o.items() if k in Org.model_fields}) for o in buyers['orgs']]
    paths.buyer_orgs = lambda _f: buyer_orgs  # cached buyers instead of the store-backed router
    buyer_ids = {o.id for o in buyer_orgs}

    people, orgs, edges, ev = build.build_graph(FOUNDER)
    pool.update({e.id: _dump(e) for e in ev})
    person_by = {p.id: p for p in people}
    org_by = {o.id: o for o in orgs} | {o.id: o for o in buyer_orgs}
    ed = {e.id: e for e in edges}

    base_paths = [p for p in paths.find_paths(FOUNDER) if p.buyer_org_id in buyer_ids]
    hero = next((p for p in base_paths if p.bridge_id == HERO and p.buyer_org_id.endswith('I67348948')), None) \
        or next((p for p in base_paths if p.bridge_id == HERO), None)
    contact = next((c for c in contacts['items'] if c['person_id'] == HERO), None)
    warnings = []
    if hero and contact:  # Moss verified: mark the hero hops ok and rescore with the real scoring function
        for h in hero.hops:
            ed[h].name_check = 'ok'
        orig = build.build_graph
        paths.build_graph = lambda f: (people, orgs, list(ed.values()), ev)
        try:
            final = [p for p in paths.find_paths(FOUNDER) if p.buyer_org_id in buyer_ids]
        finally:
            paths.build_graph = orig
    else:
        final = base_paths
    hero_new = next((p for p in final if hero and p.id == hero.id), None)
    top = sorted(final, key=lambda p: (-p.score, p.id))[:MAX_PATHS]  # keep the log demo-sized
    if hero_new and hero_new not in top:
        top = top[:-1] + [hero_new]
    final = sorted(top, key=lambda p: (p.score, p.id))  # ascending: best last
    if hero_new and final[-1].id != hero_new.id:
        warnings.append(f'WARNING: Larsen->Bayer scored {hero_new.score} after Moss check, '
                        f'top is {final[-1].score}; kept score order')

    out, seen = [], set()

    def emit(phase, kind, layer, **kw):
        out.append({'phase': phase, 'kind': kind, 'layer': layer, **{k: v for k, v in kw.items() if v}})

    def node(phase, layer, n, evidence=None):
        if n['id'] in seen:
            return
        seen.add(n['id'])
        emit(phase, 'node', layer, node=n, evidence=evidence)

    def edge(phase, layer, e, evidence=None):
        d = _dump(e)
        emit(phase, 'edge', layer, edge=d, evidence=evidence if evidence is not None else _ev(d['evidence_ids'], pool))

    def person_dict(p):
        return _dump(p)

    def org_dict(o):
        return {k: v for k, v in _dump(o).items() if k in Org.model_fields}

    # 1 reading
    emit('reading', 'status', 'core', status='Reading Berkeley Lab papers (Abergel group)…')
    for s in brief['sources']:
        verb = 'Reading paper' if s['kind'] == 'paper' else f"Reading {s['kind']}"
        emit('reading', 'status', 'core', status=f"{verb}: {s['title'][:110]}")
    node('reading', 'core', person_dict(person_by[FOUNDER]))

    # 2 interview: value map in kind order, edges right after both ends exist
    vedges = list(vm['edges'])
    done = set()
    for kind in ('feature', 'benefit', 'value', 'problem'):
        for n in vm['value_nodes']:
            if n['kind'] != kind:
                continue
            node('interview', 'core', n, _ev(n['evidence_ids'], pool))
            emit('interview', 'status', 'core', status=f"{kind.capitalize()}: {n['text'][:110]}")
            for e in vedges:
                if e['id'] not in done and e['from'] in seen and e['to'] in seen:
                    done.add(e['id'])
                    edge('interview', 'core', e)
    assert len(done) == len(vedges), 'value-map edge with missing endpoint'

    # 3 discovery
    for c in cats:
        emit('discovery', 'category', 'category', node=c)
    emit('discovery', 'status', 'category', status=f'Found {len(cats)} buyer categories')
    cat_of = {}
    for c in cats:
        for oid in c['org_ids']:
            cat_of.setdefault(oid, c['id'])
    for c in cats:
        for oid in c['org_ids']:
            if oid in seen or oid not in org_by or cat_of[oid] != c['id']:
                continue
            node('discovery', 'lead', org_dict(org_by[oid]))
            emit('discovery', 'edge', 'lead', edge={
                'id': f"edge:fits:{c['id']}:{oid}", 'from': c['id'], 'to': oid, 'type': 'FITS', 'date': None,
                'evidence_ids': [], 'confidence': 0.6, 'name_check': 'unchecked',
                'label': f"fits {c['name']}"[:80]})

    # 4 paths
    for p in final:
        for h in p.hops:
            e = ed[h]
            for pid in (e.from_, e.to):
                if pid in person_by:
                    node('paths', 'lead', person_dict(person_by[pid]))
                elif pid in org_by:
                    node('paths', 'lead', org_dict(org_by[pid]))
            edge('paths', 'lead', e)
        buyer = org_by[p.buyer_org_id]
        node('paths', 'lead', org_dict(buyer))
        pe = []
        if hero_new and p.id == hero_new.id and contact:
            pe = _ev(contact['evidence_ids'], pool)
        for h in p.hops:
            pe += [x for x in _ev(ed[h].evidence_ids, pool) if x not in pe]
        emit('paths', 'path', 'lead', path=_dump(p), evidence=pe)
    if hero_new and contact and contact['current_asof']:
        d = datetime.fromisoformat(contact['current_asof'])
        name = person_by[HERO].name
        emit('paths', 'status', 'lead', status=f"Moss verified: {name}, {contact['current_role']} at "
             f"{contact['current_org'].split(' (')[0]} (as of {d.strftime('%b %Y')})")
    n_buy = len({p.buyer_org_id for p in final})
    emit('paths', 'status', 'lead', status=f'{len(final)} warm paths to {n_buy} buyer orgs')

    t0 = datetime.now(UTC) - timedelta(seconds=SPAN)
    step = SPAN / max(len(out) - 1, 1)
    for i, e in enumerate(out):
        e.update(seq=i + 1, session_id=session_id, at=(t0 + timedelta(seconds=i * step)).isoformat())
    build_log.warnings = warnings
    return out


if __name__ == '__main__':
    log = build_log()
    OUT.write_text(json.dumps(log, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print(len(log), 'events ->', OUT)
    for k, n in sorted(Counter((e['phase'], e['kind']) for e in log).items()):
        print(' ', *k, n)
    for w in build_log.warnings:
        print(w)
    for e in log:
        if e['kind'] == 'path':
            print(' path', e['path']['score'], e['path']['bridge_id'], '->', e['path']['buyer_org_id'])
