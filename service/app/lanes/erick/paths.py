"""Bounded directed paths; scores are ranking heuristics, not relationship facts."""
import re
from collections import defaultdict
from datetime import date

from fastapi import HTTPException

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


def _norm(name):
    """Normalised org name: drop a trailing '(Country)', punctuation and case."""
    return re.sub(r'[^a-z0-9]+', ' ', re.sub(r'\([^)]*\)\s*$', '', name or '').lower()).strip()


def buyer_orgs(founder_id):
    """The founder's buyer orgs, exactly as GET /buyers returns them (cached data only)."""
    from ...routers.buyers import buyers  # late import: routers import this module
    return buyers(founder_id).orgs


def match_buyers(buyer_list, graph_orgs):
    """Map graph org id -> buyer Org. Match by id, then OpenAlex institution id, then normalised name.
    Name matching ignores a trailing '(Country)' so 'Bayer (Norway)' is the buyer 'Bayer (Germany)'; it
    only applies to company/other orgs, never to universities, labs or government bodies."""
    by_id = {o.id: o for o in graph_orgs}
    by_oa = {o.openalex_id.rsplit('/', 1)[-1]: o.id for o in graph_orgs if o.openalex_id}
    by_name = defaultdict(list)
    for o in graph_orgs:
        if o.type not in ('university', 'lab', 'government') and _norm(o.name):
            by_name[_norm(o.name)].append(o.id)
    matched = {}
    for b in buyer_list:
        gids = [b.id] if b.id in by_id else []
        if oa := by_oa.get((b.openalex_id or '').rsplit('/', 1)[-1]):
            gids.append(oa)
        if b.type not in ('university', 'lab', 'government'):
            gids += by_name.get(_norm(b.name), [])
        for gid in gids:
            matched.setdefault(gid, b)
    return matched


def path_categories(founder_id):
    """{path_id: category_id} for the founder's paths. Path has no category field (contract
    unchanged), so GET /paths cannot carry it; callers use this helper. Best effort: {} if
    categories are unavailable for this founder."""
    try:
        from ...routers.categories import category_layer
        cats = category_layer()[0]
    except Exception:  # noqa: BLE001 - categories are optional decoration
        return {}
    cat_of = {oid: c.id for c in cats for oid in c.org_ids}
    return {p.id: cat_of[p.buyer_org_id] for p in find_paths(founder_id) if p.buyer_org_id in cat_of}


def find_paths(founder_id, buyer_org_ids=None):
    """Warm paths ending at the founder's buyer orgs, best first by warmth x buyer score (0-100)."""
    _, orgs, edges, _ = build_graph(founder_id)
    fid = 'person:openalex:' + author_id(founder_id)
    buyer_score, buyer_id = {}, {}
    if buyer_org_ids is not None:
        targets = set(buyer_org_ids)
    else:
        try:
            matched = match_buyers(buyer_orgs(founder_id), orgs)
        except HTTPException:  # no intake research / buyers yet for this founder: old behaviour
            matched = {o.id: o for o in orgs if o.is_buyer}
        targets = set(matched)
        buyer_id = {gid: b.id for gid, b in matched.items()}
        buyer_score = {gid: b.buyer_score for gid, b in matched.items() if b.buyer_score}
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
            warmth = (product ** (1 / len(weights))) * min(weights) ** .5  # 0..1
            # With buyer scores (0-100): warmth x buyer_score, already on a 0-100 scale.
            score = warmth * buyer_score.get(node, 100)
            kind = next((KINDS[k] for k in ('DUAL_AFFILIATION', 'LAB_MATE', 'ADVISOR_LAB')
                         if any(e.type == k for e in hops)), KINDS.get(hops[0].type, 'aligned'))
            results.append(Path(id=stable('path:erick', fid, *(e.id for e in hops)), founder_id=fid,
                                bridge_id=hops[0].to, buyer_person_id=hops[-1].from_, buyer_org_id=buyer_id.get(node, node),
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
    return sorted(best.values(), key=lambda p: (-p.score, p.id))[:50]
