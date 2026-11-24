"""HOPO paths end at buyer orgs, best first. Run: uv run python -m app.lanes.erick.test_paths_buyers (exit 1 on failure)."""
import sys
from itertools import pairwise

from app.lanes.erick.build import build_graph
from app.lanes.erick.paths import buyer_orgs, find_paths, match_buyers, path_categories
from app.store import store

HOPO = 'person:openalex:A5043992375'


def main():
    store.load()
    graph_orgs = build_graph(HOPO)[1]
    matched = match_buyers(buyer_orgs(HOPO), graph_orgs)
    paths = find_paths(HOPO)
    names = {o.id: o.name for o in graph_orgs}
    for p in paths[:3]:
        print(p.score, names[p.buyer_org_id])
    checks = [('at least 1 path', len(paths) >= 1),
              ('every path ends at a buyer org', all(p.buyer_org_id in matched for p in paths)),
              ('scores non-increasing', all(a.score >= b.score for a, b in pairwise(paths))),
              ('weakest edge is a hop', all(p.weakest_edge_id in p.hops for p in paths)),
              ('path_categories maps only known paths', set(path_categories(HOPO)) <= {p.id for p in paths})]
    for name, ok in checks:
        print('PASS' if ok else 'FAIL', name)
    return 0 if all(ok for _, ok in checks) else 1


if __name__ == '__main__':
    sys.exit(main())
