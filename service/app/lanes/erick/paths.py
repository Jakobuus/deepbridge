"""Bounded directed paths; scores are ranking heuristics, not relationship facts."""
from collections import defaultdict
from datetime import date

from ...models import Path
from .build import build_graph, stable
from .pull import author_id

WARMTH = {'LAB_MATE': .9, 'DUAL_AFFILIATION': 1., 'ADVISOR_LAB': .7,
          'CO_AUTHORED': .6, 'CITES': .4, 'TOPIC_ALIGNED': .3,
          'AFFILIATED_AT': 1., 'BOARD': .7, 'PERSONAL': 1.}
KINDS = {'LAB_MATE': 'lab_mate', 'DUAL_AFFILIATION': 'dual_affiliation',
         'ADVISOR_LAB': 'advisor_lab', 'CO_AUTHORED': 'co_author',
         'CITES': 'aligned', 'TOPIC_ALIGNED': 'aligned', 'BOARD': 'board', 'PERSONAL': 'personal'}


def edge_weight(edge):
    if edge.name_check == 'rejected':
        return 0.
    try:
        years = max(0, (date.today() - date.fromisoformat(edge.date[:10])).days / 365.25) if edge.date else None
    except ValueError:
        years = None
    recency = 2 ** (-years / 10) if years is not None else .5
    identity = 1. if edge.name_check == 'ok' else .65
    return WARMTH.get(edge.type, .3) * recency * identity * edge.confidence


def find_paths(founder_id, buyer_org_ids=None):
    people, orgs, edges, _ = build_graph(founder_id)
    fid = 'person:openalex:' + author_id(founder_id)
    targets = set(buyer_org_ids) if buyer_org_ids is not None else {o.id for o in orgs if o.is_buyer}
    adjacency = defaultdict(list)
    for edge in edges:
        if edge_weight(edge) > 0:
            adjacency[edge.from_].append(edge)
    results = []

    def visit(node, hops, visited):
        if node in targets and len(hops) >= 2:
            weights = [edge_weight(e) for e in hops]
            # Geometric mean avoids punishing a sourced advisor hop twice; weakest link still limits score.
            product = 1.
            for weight in weights:
                product *= weight
            score = 100 * (product ** (1 / len(weights))) * min(weights) ** .5
            kind = next((KINDS[k] for k in ('DUAL_AFFILIATION', 'LAB_MATE', 'ADVISOR_LAB')
                         if any(e.type == k for e in hops)), KINDS.get(hops[0].type, 'aligned'))
            results.append(Path(id=stable('path:erick', fid, *(e.id for e in hops)), founder_id=fid,
                                bridge_id=hops[0].to, buyer_person_id=hops[-1].from_, buyer_org_id=node,
                                hops=[e.id for e in hops], kind=kind, score=round(score, 2),
                                weakest_edge_id=hops[weights.index(min(weights))].id, why_now_signal_ids=[]))
            return
        if len(hops) == 3:
            return
        for edge in adjacency[node]:
            if edge.to not in visited:
                visit(edge.to, hops + [edge], visited | {edge.to})

    visit(fid, [], {fid})
    # Keep the strongest explanation for each bridge/buyer pair.
    best = {}
    for path in sorted(results, key=lambda p: (-p.score, p.id)):
        best.setdefault((path.bridge_id, path.buyer_org_id), path)
    return list(best.values())[:50]
