"""Turn sampled publication records into dated claims; never infer personal contact."""
import hashlib
from collections import defaultdict

from ...models import Edge, Evidence, Org, Person
from . import pull


def stable(prefix, *parts):
    return prefix + ':' + hashlib.sha256('|'.join(str(v) for v in parts).encode()).hexdigest()[:20]


def person_id(value):
    return 'person:openalex:' + value.rsplit('/', 1)[-1]


def org_id(value):
    return 'org:openalex:' + value.rsplit('/', 1)[-1]


def build_graph(founder_id):
    """Return (people, orgs, edges, evidence), validated against the shared contract.

    TOPIC_ALIGNED consumes externally supplied topic_works in the cached dataset;
    ADVISOR_LAB requires sourced advisor metadata. Missing inputs yield no claims.
    """
    data = pull.load_dataset(founder_id)
    founder = data['founder']
    fid = person_id(founder['id'])
    people, orgs, edges, evidence = {}, {}, {}, {}
    profiles = dict(data.get('profiles', {}))
    profiles[founder['id']] = founder
    observed = data['observed_at']
    works = {w['id']: w for key in ('works', 'coauthor_works', 'citing_works', 'advisor_works', 'topic_works')
             for w in data.get(key, [])}
    appearances = defaultdict(list)
    affiliation_edges = defaultdict(list)

    def add_person(author):
        aid = author.get('id')
        if not aid:
            return None
        pid = person_id(aid)
        profile = profiles.get(aid, {})
        if pid not in people:
            people[pid] = Person(id=pid, name=author.get('display_name') or aid, openalex_id=aid,
                                 orcid=profile.get('orcid'), org_id=None, affiliation_asof=None,
                                 role=None, is_bridge_candidate=pid != fid, alignment=None)
        return pid

    def add_org(inst):
        if not inst.get('id'):
            return None
        oid = org_id(inst['id'])
        kind = {'education': 'university', 'company': 'company', 'facility': 'lab',
                'government': 'government'}.get(inst.get('type'), 'other')
        orgs[oid] = Org(id=oid, name=inst.get('display_name') or inst['id'], type=kind,
                        is_buyer=kind == 'company', buyer_score=None, openalex_id=inst['id'])
        return oid

    def ev(url, quote, date, kind='paper'):
        eid = stable('evidence:erick', url, quote, date, kind)
        evidence[eid] = Evidence(id=eid, source_url=url, quote=quote, source_date=date,
                                 observed_at=observed, kind=kind)
        return eid

    def edge(source, target, kind, date, eids, label, confidence=.85):
        eid = stable('edge:erick', source, target, kind)
        candidate = Edge(id=eid, **{'from': source}, to=target, type=kind, date=date,
                         evidence_ids=list(dict.fromkeys(eids)), confidence=confidence,
                         name_check='unchecked', label=label + ' [cached OpenAlex]')
        old = edges.get(eid)
        if old is None or (date or '') > (old.date or '') or ((date or '') == (old.date or '') and confidence > old.confidence):
            edges[eid] = candidate
        return edges[eid]

    def noise(aid):
        """Flag profile/work affiliation disagreement; absence of a profile is unverified."""
        profile = profiles.get(aid)
        if not profile:
            return .45
        reported = {a['institution']['id'] for a in profile.get('affiliations', []) if a.get('institution', {}).get('id')}
        seen = {i['id'] for _, a in appearances.get(aid, []) for i in a.get('institutions', []) if i.get('id')}
        # A mismatch is a warning, not proof of a false identity or a job change.
        return .4 if reported and seen and not reported.intersection(seen) else .85

    add_person(founder)
    for work in works.values():
        for authorship in work.get('authorships', []):
            author = authorship.get('author') or {}
            if author.get('id'):
                appearances[author['id']].append((work, authorship))

    # Paper affiliations are stronger than profile rollups and have a real date.
    for aid, entries in appearances.items():
        for work, authorship in entries:
            pid = add_person(authorship['author'])
            date = work.get('publication_date')
            institutions = authorship.get('institutions', [])
            dual = any(i.get('type') == 'education' for i in institutions) and any(i.get('type') == 'company' for i in institutions)
            quote = '\n'.join(authorship.get('raw_affiliation_strings') or [])
            if not quote:
                quote = 'institutions: ' + ', '.join(i.get('display_name', '') for i in institutions)
            eid = ev(work['id'], quote, date, 'affiliation')
            for institution in institutions:
                oid = add_org(institution)
                if not oid:
                    continue
                kind = 'DUAL_AFFILIATION' if dual and institution.get('type') == 'company' else 'AFFILIATED_AT'
                label = ('dual university/company affiliation' if kind == 'DUAL_AFFILIATION' else 'affiliated')
                affiliation = edge(pid, oid, kind, date, [eid], label + ' as of ' + (date or 'undated source'), noise(aid))
                affiliation_edges[pid].append((date or '', affiliation))
                person = people[pid]
                if date and (person.affiliation_asof is None or date > person.affiliation_asof):
                    person.org_id, person.affiliation_asof = oid, date

    # Profile years are useful fallback evidence, but not a verified workplace.
    # Preserve the year in the label; don't fabricate January 1 as an exact date.
    for aid, profile in profiles.items():
        pid = person_id(aid)
        if pid not in people:
            continue
        for affiliation in profile.get('affiliations', []):
            inst = affiliation.get('institution') or {}
            years = [y for y in affiliation.get('years', []) if isinstance(y, int)]
            if inst.get('type') != 'company' or not years:
                continue
            oid = add_org(inst)
            if not oid or any(e.to == oid and d >= str(max(years)) for d, e in affiliation_edges[pid]):
                continue
            year = max(years)
            # Rollups have no work ID; cite their actual source rather than falsely citing a paper.
            quote = 'institution.display_name: ' + inst['display_name'] + '; years: ' + ', '.join(map(str, affiliation['years']))
            eid = ev(profile['id'], quote, None, 'affiliation')
            affiliation_edge = edge(pid, oid, 'AFFILIATED_AT', None, [eid],
                                    f'OpenAlex affiliation as of {year}; identity unchecked', min(noise(aid), .45))
            affiliation_edges[pid].append((str(year), affiliation_edge))

    for work in data.get('works', []):
        authors = work.get('authorships', [])
        own = next((a for a in authors if (a.get('author') or {}).get('id') == founder['id']), None)
        if not own:
            continue
        uni = {i['id'] for i in own.get('institutions', []) if i.get('type') == 'education'}
        date = work.get('publication_date')
        eid = ev(work['id'], work.get('title') or 'id: ' + work['id'], date)
        for a in authors:
            aid = (a.get('author') or {}).get('id')
            if not aid or aid == founder['id']:
                continue
            pid = person_id(aid)
            edge(fid, pid, 'CO_AUTHORED', date, [eid], 'co-authored ' + (date[:4] if date else '(undated)'), noise(aid))
            shared = uni.intersection(i['id'] for i in a.get('institutions', []) if i.get('id'))
            later = [(d, e) for d, e in affiliation_edges[pid] if orgs[e.to].type == 'company' and date and d[:4] > date[:4]]
            if shared and later:
                # "LAB_MATE" is the contract category; displayed claim is only shared university coauthorship.
                edge(fid, pid, 'LAB_MATE', date, [eid] + [x for _, e in later for x in e.evidence_ids],
                     'co-authored ' + date[:4] + ' at shared university; later company affiliation', noise(aid))

    founder_work_ids = {w['id'] for w in data.get('works', [])}
    founder_topics = {t['id'] for w in data.get('works', []) for t in w.get('topics', []) if t.get('id')}
    for kind, key in [('CITES', 'citing_works'), ('TOPIC_ALIGNED', 'topic_works')]:
        for work in data.get(key, []):
            if kind == 'CITES' and not founder_work_ids.intersection(work.get('referenced_works', [])):
                continue
            if kind == 'TOPIC_ALIGNED' and not founder_topics.intersection(t['id'] for t in work.get('topics', []) if t.get('id')):
                continue
            eid = ev(work['id'], work.get('title') or 'id: ' + work['id'], work.get('publication_date'))
            for a in work.get('authorships', []):
                aid = (a.get('author') or {}).get('id')
                if aid and aid != founder['id']:
                    edge(fid, person_id(aid), kind, work.get('publication_date'), [eid],
                         ('authored paper citing founder work' if kind == 'CITES' else 'shared OpenAlex topic; no relationship implied'), noise(aid))

    advisor = data.get('advisor')
    if advisor and advisor.get('source_url') and advisor.get('quote'):
        advisor_url = 'https://openalex.org/' + pull.author_id(advisor['openalex_id'])
        apid = add_person({'id': advisor_url, 'display_name': advisor.get('name', advisor_url)})
        aeid = ev(advisor['source_url'], advisor['quote'], advisor.get('source_date'), 'web')
        edge(fid, apid, 'ADVISOR_LAB', advisor.get('source_date'), [aeid], 'PhD advisor (sourced)', .85)
        for work in data.get('advisor_works', []):
            if not any((a.get('author') or {}).get('id') == advisor_url for a in work.get('authorships', [])):
                continue
            eid = ev(work['id'], work.get('title') or 'id: ' + work['id'], work.get('publication_date'))
            for a in work.get('authorships', []):
                aid = (a.get('author') or {}).get('id')
                if aid and aid not in (advisor_url, founder['id']):
                    edge(apid, person_id(aid), 'ADVISOR_LAB', work.get('publication_date'), [aeid, eid],
                         'co-authored with founder’s sourced advisor', noise(aid))

    with pull._LOCK:
        for item in edges.values():
            item.name_check = NAME_CHECKS.get(item.id, 'unchecked')
        COMPUTED_EDGES.update(edges)
        COMPUTED_EVIDENCE.update(evidence)
    return list(people.values()), list(orgs.values()), list(edges.values()), list(evidence.values())

# Human decisions survive subsequent recomputation in this process, just like fixture decisions.
# Keep computed entities separate so the stage-safe Lightmatter response stays unchanged.
COMPUTED_EDGES = {}
COMPUTED_EVIDENCE = {}
NAME_CHECKS = {}
