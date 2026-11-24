"""Quick check of the recorded demo-hopo and demo-lightmatter logs. Run from service/: uv run python -m app.lanes.erick.test_record_log"""
import json
import sys

from ... import events
from .record_log import OUTDIR, SESSIONS, build_log

ORDER = ['reading', 'interview', 'discovery', 'paths']


def check(sid):
    errs = []
    log = json.loads((OUTDIR / f'{sid}.json').read_text(encoding='utf-8'))
    fresh = build_log(sid)
    if not 60 <= len(log) <= 1500:
        errs.append(f'{len(log)} events, want 60-1500')
    if fresh != log:
        errs.append('file is stale vs build_log()')
    if [e['seq'] for e in log] != list(range(1, len(log) + 1)):
        errs.append('seq not contiguous')
    idx = [ORDER.index(e['phase']) for e in log]
    if idx != sorted(idx):
        errs.append('phase order broken')
    ats = [e['at'] for e in log]
    if ats != sorted(ats):
        errs.append('at not ascending')
    known, edge_ids = set(), set()
    buyers = set()
    for e in log:
        n = e.get('node')
        if n:
            known.add(n['id'])
            if n.get('is_buyer'):
                buyers.add(n['id'])
        if e['kind'] == 'category':
            known.add(e['node']['id'])
        if e.get('edge'):
            x = e['edge']
            for end in (x['from'], x['to']):
                if end not in known:
                    errs.append(f"seq {e['seq']}: edge {x['id']} dangling {end}")
            edge_ids.add(x['id'])
        if e.get('path'):
            p = e['path']
            for ref in (p['founder_id'], p['bridge_id'], p['buyer_org_id']):
                if ref not in known:
                    errs.append(f"seq {e['seq']}: path dangling {ref}")
            if any(h not in edge_ids for h in p['hops']):
                errs.append(f"seq {e['seq']}: path hop edge not emitted yet")
            if p['buyer_org_id'] not in buyers:
                errs.append(f"seq {e['seq']}: path does not end at a buyer org")
    scores = [e['path']['score'] for e in log if e['kind'] == 'path']
    if scores != sorted(scores):
        errs.append('paths not ascending by score')
    events._LOG.pop(sid, None)
    if not events.ensure_recorded(sid) or len(events.events(sid)) != len(log):
        errs.append('ensure_recorded failed')
    for er in errs:
        print('FAIL', sid, er)
    print(sid, 'OK' if not errs else f'{len(errs)} failure(s)', len(log), 'events')
    return len(errs)


def test_warmth():
    log = build_log('demo-hopo')
    ps = [e['path'] for e in log if e['kind'] == 'path']
    assert ps
    for p in ps:
        assert p['warmth_type'] in ('research_peer', 'former_colleague', 'same_institution', 'other'), p
        assert p['warmth_label'] and 'knows' not in p['warmth_label'].lower(), p
    assert all(e['edge'].get('warmth_label') for e in log if e['kind'] == 'edge' and e['phase'] == 'paths')


def main():
    return 1 if sum(check(sid) for sid in SESSIONS) else 0


if __name__ == '__main__':
    sys.exit(main())
