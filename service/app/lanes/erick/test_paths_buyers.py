"""HOPO paths end at buyer orgs, best first. Run: uv run python -m app.lanes.erick.test_paths_buyers (exit 1 on failure)."""
import sys
from itertools import pairwise

from app.lanes.erick.build import build_graph
from app.lanes.erick.paths import (
    _norm,
    buyer_orgs,
    find_paths,
    match_buyers,
    path_categories,
)
from app.store import store

HOPO = 'person:openalex:A5043992375'
HERO = {'https://openalex.org/W2899214672', 'https://doi.org/10.1021/acs.inorgchem.8b02430'}


def main():
    store.load()
    graph_orgs = build_graph(HOPO)[1]
    matched = match_buyers(buyer_orgs(HOPO), graph_orgs)
    paths = find_paths(HOPO)
    names = {o.id: o.name for o in graph_orgs}
    buyers = {b.id: b for b in buyer_orgs(HOPO)}
    people = {p.id: p.name for p in build_graph(HOPO)[0]}
    _, _, edges, evidence = build_graph(HOPO)
    edge_by_id = {e.id: e for e in edges}
    ev_by_id = {e.id: e for e in evidence}
    for rank, p in enumerate(paths, 1):
        print(rank, p.score, buyers[p.buyer_org_id].name, '|', people.get(p.bridge_id), '|', p.kind)
    hero = [(r, p) for r, p in enumerate(paths, 1) if _norm(buyers[p.buyer_org_id].name) == 'bayer' and any(
        ev_by_id[x].source_url in HERO for h in p.hops for x in edge_by_id[h].evidence_ids)]
    print('Bayer hero path rank:', hero[0][0] if hero else None)
    uni = [o for o in graph_orgs if o.type == 'university']
    fake_buyer = uni[0].model_copy(update={'id': 'org:fake', 'name': uni[0].name + ' (Norway)', 'openalex_id': None})
    uni_match = match_buyers([fake_buyer], graph_orgs)
    checks = [('Bayer path via the 2018 Inorg. Chem. paper', bool(hero)),
              ('universities never matched by stripped name', not uni_match),
              ('Bayer (Norway) graph org matched to a buyer', any(names[g].startswith('Bayer') for g in matched)),
              ('at least 1 path', len(paths) >= 1),
              ('every path ends at a buyer org', all(p.buyer_org_id in buyers for p in paths)),
              ('scores non-increasing', all(a.score >= b.score for a, b in pairwise(paths))),
              ('weakest edge is a hop', all(p.weakest_edge_id in p.hops for p in paths)),
              ('path_categories maps only known paths', set(path_categories(HOPO)) <= {p.id for p in paths})]
    for name, ok in checks:
        print('PASS' if ok else 'FAIL', name)
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == '__main__':
    sys.exit(main())
