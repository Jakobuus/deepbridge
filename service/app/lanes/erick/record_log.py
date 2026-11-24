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
OUTDIR = ROOT / 'data' / 'graph_events'
OUT = OUTDIR / 'demo-hopo.json'
SESSIONS = ('demo-hopo', 'demo-lightmatter')
FOUNDER = 'person:openalex:A5043992375'
HERO = 'person:openalex:A5085203145'
MAX_PATHS = 12
SPAN = 300  # seconds covered by the recording
START = datetime(2026, 11, 24, 21, 0, 0, tzinfo=UTC)  # fixed so re-runs do not change the file


def _load(name):
    return json.loads((FIX / name).read_text(encoding='utf-8'))


def _dump(m):
    return m.model_dump(mode='json', by_alias=True) if hasattr(m, 'model_dump') else m


def _ev(ids, pool):
    return [pool[i] for i in ids if i in pool]


def _hopo_ctx():
    vm, cats, buyers = _load('value_map_hopo.json'), _load('categories_hopo.json'), _load('buyers_hopo.json')
    brief, contacts = _load('briefing_demo_hopo.json')['briefing'], _load('contacts.json')
    pool = {e['id']: e for e in vm['evidence'] + contacts['evidence']}
    pool.update({e['id']: e for e in buyers.get('evidence', [])})
    buyer_orgs = [Org.model_validate({k: v for k, v in o.items() if k in Org.model_fields}) for o in buyers['orgs']]
    paths.buyer_orgs = lambda _f: buyer_orgs  # cached buyers instead of the store-backed router
    buyer_ids = {o.id for o in buyer_orgs}
    buyer_ev = {o['id']: o.get('evidence_ids', []) for o in buyers['orgs']}

    people, orgs, edges, ev = build.build_graph(FOUNDER)
    pool.update({e.id: _dump(e) for e in ev})
    person_by = {p.id: p for p in people}
    org_by = {o.id: o for o in orgs} | {o.id: o for o in buyer_orgs}
    ed = {e.id: e for e in edges}

    base = [p for p in paths.find_paths(FOUNDER) if p.buyer_org_id in buyer_ids]
    # Moss-verified contacts: source moss_task + task verification_passed (never pattern/guessed/cache)
    verified = _verified(contacts)

    def _is_verified(p):
        c = verified.get(p.bridge_id)
        return c if c and paths._norm(c['current_org']) == paths._norm(org_by[p.buyer_org_id].name) else None

    for p in base:  # name check ok on the verified bridge person's hop edges, then rescore with the real function
        if _is_verified(p):
            for h in p.hops:
                if p.bridge_id in (ed[h].from_, ed[h].to):
                    ed[h].name_check = 'ok'
    orig = build.build_graph
    paths.build_graph = lambda f: (people, orgs, list(ed.values()), ev)
    try:
        final = [p for p in paths.find_paths(FOUNDER) if p.buyer_org_id in buyer_ids]
    finally:
        paths.build_graph = orig
    ranked = sorted(final, key=lambda p: (-p.score, p.id))
    keep = {p.id for p in ranked[:MAX_PATHS]} | {p.id for p in ranked if _is_verified(p)}
    final = sorted((p for p in ranked if p.id in keep), key=lambda p: (p.score, p.id))  # ascending: best last
    return _ctx(vm=vm, cats=cats, brief=brief, pool=pool, buyer_orgs=buyer_orgs, buyer_ev=buyer_ev,
                founder=FOUNDER, person_by=person_by, org_by=org_by, ed=ed, final=final, is_verified=_is_verified)


def _ctx(**kw):
    return kw


def _verified(contacts):
    tasks = contacts['_meta'].get('tasks', {})
    return {c['person_id']: c for c in contacts['items']
            if c.get('source') == 'moss_task' and tasks.get(c['person_id'], {}).get('verification_passed')}


def _lightmatter_ctx():
    """The original fixture founder (Lightmatter): fixtures only, scores taken from fixtures/paths.json as-is."""
    from ...models import Edge, Path, Person
    founder, vm, plans = _load('founder.json'), _load('value_map.json'), _load('categories.json')
    brief, contacts = _load('briefing_demo.json')['briefing'], _load('contacts.json')
    pool = {e['id']: e for e in _load('evidence.json')['items'] + vm['evidence'] + contacts['evidence']}
    for evs in plans['buyer_evidence'].values():
        pool.update({e['id']: e for e in evs})
    person_by = {p['id']: Person.model_validate(p) for p in _load('people.json')['items']}
    org_by = {o['id']: Org.model_validate(o) for o in _load('orgs.json')['items']}
    ed = {e['id']: Edge.model_validate(e) for e in _load('edges.json')['items']}
    buyer_orgs = [o for o in org_by.values() if o.is_buyer]
    buyer_ev = {oid: [e['id'] for e in evs] for oid, evs in plans['buyer_evidence'].items()}
    cats = []
    for i, pl in enumerate(plans['plans']):
        ids = [oid for oid in pl['members'] if oid in org_by]
        cats.append({'id': f'category:lightmatter:{i + 1}', 'name': pl['name'], 'problem_set': pl['problem_set'],
                     'value_prop': pl['value_prop'], 'colour': f'--cat-{i + 1}', 'org_ids': ids,
                     'problem_node_ids': pl['problem_ids'],
                     'evidence_ids': sorted({x for oid in ids for x in pl['members'][oid]})})
    verified = _verified(contacts)
    for p in _load('paths.json')['items']:  # name check ok on the Moss-verified bridge person's own hop edges
        c = verified.get(p['bridge_id'])
        if c and paths._norm(c['current_org']) == paths._norm(org_by[p['buyer_org_id']].name):
            for h in p['hops']:
                if p['bridge_id'] in (ed[h].from_, ed[h].to):
                    ed[h].name_check = 'ok'
    final = sorted((Path.model_validate(p) for p in _load('paths.json')['items']
                    if org_by[p['buyer_org_id']].is_buyer), key=lambda p: (p.score, p.id))

    def _is_verified(p):
        c = verified.get(p.bridge_id)
        return c if c and paths._norm(c['current_org']) == paths._norm(org_by[p.buyer_org_id].name) else None
    person_by[founder['id']] = person_by.get(founder['id']) or Person.model_validate(
        {'id': founder['id'], 'name': founder['name'], 'openalex_id': founder['openalex_id'], 'orcid': None,
         'org_id': None, 'affiliation_asof': None, 'role': None, 'is_bridge_candidate': False, 'alignment': None})
    return _ctx(vm=vm, cats=cats, brief=brief, pool=pool, buyer_orgs=buyer_orgs, buyer_ev=buyer_ev,
                founder=founder['id'], person_by=person_by, org_by=org_by, ed=ed, final=final, is_verified=_is_verified)


def build_log(session_id='demo-hopo'):
    ctx = {'demo-hopo': _hopo_ctx, 'demo-lightmatter': _lightmatter_ctx}[session_id]()
    vm, cats, brief, pool = ctx['vm'], ctx['cats'], ctx['brief'], ctx['pool']
    buyer_orgs, buyer_ev, person_by, org_by = ctx['buyer_orgs'], ctx['buyer_ev'], ctx['person_by'], ctx['org_by']
    ed, final, _is_verified, founder = ctx['ed'], ctx['final'], ctx['is_verified'], ctx['founder']
    warnings = []
    build_log.final = final

    out, seen = [], set()

    def emit(phase, kind, layer, **kw):
        out.append({'phase': phase, 'kind': kind, 'layer': layer, **{k: v for k, v in kw.items() if v}})

    def node(phase, layer, n, evidence=None):
        if n['id'] in seen:
            return
        seen.add(n['id'])
        emit(phase, 'node', layer, node=n, evidence=evidence)

    seen_edges = set()

    def edge(phase, layer, e, evidence=None):
        d = _dump(e)
        if d['id'] in seen_edges:
            return
        seen_edges.add(d['id'])
        emit(phase, 'edge', layer, edge=d, evidence=evidence if evidence is not None else _ev(d['evidence_ids'], pool))

    def person_dict(p):
        return _dump(p)

    def org_dict(o):
        return {k: v for k, v in _dump(o).items() if k in Org.model_fields}

    # 1 reading
    emit('reading', 'status', 'core', status='Reading Berkeley Lab papers (Abergel group)…' if session_id == 'demo-hopo'
         else f"Reading papers and site: {brief['founder'].get('name', 'founder')}…")
    for s in brief['sources']:
        verb = 'Reading paper' if s['kind'] == 'paper' else f"Reading {s['kind']}"
        emit('reading', 'status', 'core', status=f"{verb}: {s['title'][:110]}")
    node('reading', 'core', person_dict(person_by[founder]))

    # 2 interview: value map in kind order, edges right after both ends exist
    vedges = list(vm['edges'])
    done = set()
    for kind in ('feature', 'benefit', 'value', 'problem'):
        for n in vm['value_nodes']:
            if n['kind'] != kind:
                continue
            node('interview', 'core', n, _ev(n['evidence_ids'], pool))
            if kind == 'value':
                emit('interview', 'status', 'core', status=f"Value: {n['text'][:110]}")
            for e in vedges:
                if e['id'] not in done and e['from'] in seen and e['to'] in seen:
                    done.add(e['id'])
                    edge('interview', 'core', e)
    assert len(done) == len(vedges), 'value-map edge with missing endpoint'

    # 3 discovery: categories (+ SOLVES to problem nodes), then all buyers grouped by category, best score first
    for c in cats:
        emit('discovery', 'category', 'category', node=c, evidence=_ev(c.get('evidence_ids', []), pool))
        for pid in c.get('problem_node_ids', []):
            if pid in seen:
                emit('discovery', 'edge', 'category', edge={
                    'id': f"edge:solves:{c['id']}:{pid}", 'from': c['id'], 'to': pid, 'type': 'SOLVES', 'date': None,
                    'evidence_ids': [], 'confidence': 0.6, 'name_check': 'unchecked', 'label': 'Solves'})
    emit('discovery', 'status', 'category', status=f'Found {len(cats)} buyer categories')
    cat_of = {}
    for c in cats:
        for oid in c['org_ids']:
            cat_of.setdefault(oid, c['id'])
    score = {o.id: o.buyer_score or 0 for o in buyer_orgs}
    groups = [(c, [i for i in c['org_ids'] if cat_of[i] == c['id'] and i in org_by]) for c in cats]
    groups.append((None, [o.id for o in buyer_orgs if o.id not in cat_of]))
    for c, ids in groups:
        if c is None:
            emit('discovery', 'status', 'lead', status=f'{len(ids)} other buyers')
        for oid in sorted(ids, key=lambda i: (-score[i], i)):
            node('discovery', 'lead', org_dict(org_by[oid]), _ev(buyer_ev.get(oid, []), pool))
            if c:
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
        c = _is_verified(p)
        pe = _ev(c['evidence_ids'], pool) if c else []
        for h in p.hops:
            pe += [x for x in _ev(ed[h].evidence_ids, pool) if x not in pe]
        emit('paths', 'path', 'lead', path=_dump(p), evidence=pe)
        if c:
            asof = f" (as of {datetime.fromisoformat(c['current_asof']).strftime('%b %Y')})" if c['current_asof'] else ''
            emit('paths', 'status', 'lead', status=f"Moss verified: {person_by[p.bridge_id].name}, "
                 f"{c['current_role']} at {c['current_org'].split(' (')[0]}{asof}")
    n_buy = len({p.buyer_org_id for p in final})
    emit('paths', 'status', 'lead', status=f'{len(final)} warm paths to {n_buy} buyer orgs')

    t0 = START
    step = SPAN / max(len(out) - 1, 1)
    for i, e in enumerate(out):
        e.update(seq=i + 1, session_id=session_id, at=(t0 + timedelta(seconds=round(i * step, 3))).isoformat())
    build_log.warnings = warnings
    return out


def founder_sessions():
    """founder_id -> recorded session id whose cached data drives discovery."""
    return {FOUNDER: 'demo-hopo', _load('founder.json')['id']: 'demo-lightmatter'}


def discovery_events(founder_id=FOUNDER):
    """Only the discovery + paths phase events (no seq/at/session_id), same order as the recorded log."""
    sid = founder_sessions().get(founder_id)
    if sid is None:
        raise KeyError(founder_id)
    return [{k: v for k, v in e.items() if k not in ('seq', 'at', 'session_id')}
            for e in build_log(sid) if e['phase'] in ('discovery', 'paths')]


if __name__ == '__main__':
    import sys
    for sid in sys.argv[1:] or SESSIONS:
        log = build_log(sid)
        out = OUTDIR / f'{sid}.json'
        out.write_text(json.dumps(log, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        print(sid, len(log), 'events ->', out)
        for k, n in sorted(Counter((e['phase'], e['kind']) for e in log).items()):
            print(' ', *k, n)
        for w in build_log.warnings:
            print(w)
        for e in log:
            if e['kind'] == 'path':
                print(' path', e['path']['score'], e['path']['bridge_id'], '->', e['path']['buyer_org_id'])
