"""Read-only HTTP acceptance run (start uvicorn first); writes a compact evidence report.

uv run python -m app.lanes.erick.verify_live http://localhost:8011
"""
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .pull import CACHE, write


def main(base):
    def get(path, **params):
        with urlopen(base + path + ('?' + urlencode(params) if params else ''), timeout=60) as response:
            return json.load(response), dict(response.headers)

    initial, _ = get('/graph')
    initial_ids = {e['id'] for e in initial['edges']}
    output = {'observed_at': datetime.now(timezone.utc).isoformat(), 'founders': []}
    for aid in ['A5060617433', 'A5069094503']:
        fid = 'person:openalex:' + aid
        graph, headers = get('/graph', founder_id=fid)
        paths, _ = get('/paths', founder_id=fid)
        assert graph['edges'] and paths, (fid, 'computed graph and paths required')
        assert all(e['id'].startswith('edge:erick:') for e in graph['edges'])
        edges = {e['id']: e for e in graph['edges']}
        evidence = {e['id']: e for e in graph['evidence']}
        for edge in edges.values():
            assert edge['evidence_ids'] and all(e in evidence for e in edge['evidence_ids'])
        for item in evidence.values():
            assert item['source_url'] and item['quote']
        for path in paths:
            node = fid
            for eid in path['hops']:
                assert edges[eid]['from'] == node
                node = edges[eid]['to']
            assert node == path['buyer_org_id']
            assert path['weakest_edge_id'] in path['hops']
        first_evidence, _ = get('/evidence/' + graph['evidence'][0]['id'])
        assert first_evidence == graph['evidence'][0]
        filtered, _ = get('/paths', founder_id=fid, buyer_org_ids=paths[0]['buyer_org_id'])
        assert filtered and all(p['buyer_org_id'] == paths[0]['buyer_org_id'] for p in filtered)
        summary = dict(founder_id=fid, people=len(graph['people']), orgs=len(graph['orgs']),
                       edges=len(edges), edge_types=dict(Counter(e['type'] for e in edges.values())),
                       evidence=len(evidence), paths=len(paths), example_path=paths[0],
                       data=headers.get('x-graph-data') or headers.get('X-Graph-Data'),
                       partial=headers.get('x-graph-partial') or headers.get('X-Graph-Partial'))
        output['founders'].append(summary)
        print('GET /graph?founder_id=' + fid + ' 200: ' + str(len(edges)) + ' computed edges')
        print('GET /paths?founder_id=' + fid + ' 200: ' + str(len(paths)) + ' computed paths')
        print(json.dumps(paths[0], ensure_ascii=False))
    final, _ = get('/graph')
    assert {e['id'] for e in final['edges']} == initial_ids
    output['lightmatter_fixture_unchanged'] = True
    write(CACHE / 'verification.json', output)
    print('Evidence references, ordered hops, buyer filter, and fixture isolation passed.')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8000')
