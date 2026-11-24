"""OpenAlex publication overlap, never a claim of commercial competition.

Run `python -m app.lanes.jakob.competitors` to refresh the demo snapshot.
Keyless reads only; a depleted search budget yields a labelled paper sample.
"""
import hashlib
import json
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic import BaseModel, ConfigDict, Field

from ...models import Evidence, Founder
from ...store import FIXTURES

CACHE = FIXTURES.parent / 'data/cache/jakob/competitors'
SNAPSHOT = FIXTURES / 'competitors.json'
_REQUEST_LOCK = Lock()
_LAST_REQUEST = 0.0


class AdjacentCompany(BaseModel):
    name: str
    url: str
    why: str
    overlap_topics: list[str]
    evidence_ids: list[str]


class CompetitorsResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    competitors: list[AdjacentCompany]
    evidence: list[Evidence]
    metadata: dict = Field(alias='_meta')


def _write(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def _url(endpoint, params):
    return 'https://api.openalex.org/' + endpoint + '?' + urlencode(params)


def _get(endpoint, params):
    """Cache small raw responses by public URL; never use a credential."""
    global _LAST_REQUEST
    url = _url(endpoint, params)
    path = CACHE / 'raw' / (hashlib.sha256(url.encode()).hexdigest()[:24] + '.json')
    today = datetime.now(timezone.utc).date().isoformat()
    if path.exists():
        saved = json.loads(path.read_text())
        if saved['observed_at'].startswith(today):
            return saved['response']
    with _REQUEST_LOCK:
        time.sleep(max(0, .26 - (time.monotonic() - _LAST_REQUEST)))
        _LAST_REQUEST = time.monotonic()
        with urlopen(Request(url, headers={'User-Agent': 'DeepBridge-demo/0.1'}), timeout=20) as response:
            data = json.load(response)
    _write(path, {'url': url, 'observed_at': datetime.now(timezone.utc).isoformat(), 'response': data})
    return data


def _since(as_of):
    day = date.fromisoformat(as_of)
    try:
        return day.replace(year=day.year - 2).isoformat()
    except ValueError:  # February 29, two years earlier.
        return day.replace(year=day.year - 2, day=28).isoformat()


def _same_company(left, right):
    def normal(value):
        value = re.sub(r'\([^)]*\)', '', value.casefold())
        value = re.sub(r'\b(incorporated|inc|llc|ltd|limited|corporation|corp)\b', '', value)
        return re.sub(r'[^a-z0-9]', '', value)
    return bool(normal(right)) and normal(left) == normal(right)


def fingerprint(founder):
    return hashlib.sha256(json.dumps(founder.model_dump(), sort_keys=True).encode()).hexdigest()


def snapshot_path(founder):
    return CACHE / (hashlib.sha256(founder.id.encode()).hexdigest()[:24] + '.json')


def validate_snapshot(data, founder):
    parsed = CompetitorsResponse.model_validate(data)
    if parsed.metadata.get('fingerprint') != fingerprint(founder):
        raise ValueError('Snapshot belongs to a different founder profile')
    evidence = {e.id: e for e in parsed.evidence if e.source_url and e.quote}
    for company in parsed.competitors:
        if (not company.evidence_ids or not set(company.evidence_ids) <= evidence.keys()
                or _same_company(company.name, founder.company)):
            raise ValueError('Adjacent company is missing evidence or is the founder company')
    return parsed.model_dump(by_alias=True)


def _topics(founder, works):
    available = {t['display_name'].casefold(): t for w in works for t in w.get('topics', [])}
    topics = []
    for name in founder.topics[:3]:
        topic = available.get(name.casefold())
        if topic is None:
            matches = _get('topics', {'search': name, 'per-page': 5, 'page': 1,
                                     'select': 'id,display_name'})['results']
            topic = next((t for t in matches if t['display_name'].casefold() == name.casefold()), None)
        if topic:
            topics.append(topic)
    return topics


def discover(founder: Founder, works=(), seed_evidence=(), as_of=None):
    as_of = as_of or datetime.now(timezone.utc).date().isoformat()
    since = _since(as_of)
    observed_at = datetime.now(timezone.utc).isoformat()
    works = list(works)
    # The demo's paper establishes its exact topic IDs without a search query.
    if not works:
        for evidence in seed_evidence:
            match = re.search(r'openalex.org/(W\d+)', evidence.source_url)
            if match:
                works.append(_get('works/' + match[1], {'select': 'id,title,publication_date,topics,authorships'}))
                break
    topics = _topics(founder, works)
    if not topics:
        raise ValueError('No exact OpenAlex topic match for this founder')
    companies, evidence_by_id, rankings = {}, {}, {}
    partial, reason = False, None

    def add(institution, topic, count, evidence, sampled=False):
        iid = institution['id']
        if institution.get('type') != 'company' or _same_company(institution['display_name'], founder.company):
            return
        company = companies.setdefault(iid, {'name': institution['display_name'],
                    'url': institution.get('homepage_url') or iid, 'why': '',
                    'overlap_topics': [], 'evidence_ids': []})
        if topic not in company['overlap_topics']:
            company['overlap_topics'].append(topic)
        for item in evidence:
            evidence_by_id[item.id] = item.model_dump()
            if item.id not in company['evidence_ids']:
                company['evidence_ids'].append(item.id)
        label = f'at least {count} observed works' if sampled else f'{count} works'
        company['why'] += ('; ' if company['why'] else 'Adjacent company publishing on the same topics: ') + f'publishes on {topic} ({label} since {since})'
        if sampled:
            company['why'] += ' [partial paper sample; not a total publication count]'
        rankings[iid] = rankings.get(iid, 0) + count

    try:
        for topic in topics:
            topic_companies = 0
            # Group counts are per institution and topic, not a sum of papers across topics.
            topic_id = topic['id'].rsplit('/', 1)[-1]
            for page in range(1, 4):
                params = {'filter': f'topics.id:{topic_id},from_publication_date:{since},to_publication_date:{as_of},institutions.type:company',
                          'group_by': 'institutions.id', 'per-page': 200, 'page': page}
                groups = _get('works', params)['group_by']
                for group in groups:
                    if not group.get('key') or not group.get('count'):
                        continue
                    iid = group['key'].rsplit('/', 1)[-1]
                    institution_params = {'select': 'id,display_name,type,homepage_url'}
                    institution = _get('institutions/' + iid, institution_params)
                    if institution.get('type') != 'company' or _same_company(institution['display_name'], founder.company):
                        continue
                    eid = f'evidence:adjacent:{topic_id}:{iid}:{since}:{as_of}'
                    count_evidence = Evidence(id=eid, source_url=_url('works', params),
                        quote='group_by: ' + json.dumps(group, ensure_ascii=False, separators=(',', ':')),
                        source_date=None, observed_at=observed_at, kind='paper')
                    identity = Evidence(id=f'evidence:adjacent:{iid}:identity:{as_of}',
                        source_url=_url('institutions/' + iid, institution_params),
                        quote='; '.join(f'{key}: {institution.get(key)}' for key in ('id', 'display_name', 'type', 'homepage_url')),
                        source_date=None, observed_at=observed_at, kind='affiliation')
                    add(institution, topic['display_name'], group['count'], [count_evidence, identity])
                    topic_companies += 1
                    if topic_companies >= 12:
                        break
                if len(groups) < 200 or topic_companies >= 12:
                    break
    except HTTPError as exc:
        if exc.code != 429:
            raise
        # Entity reads remain free when the shared keyless search budget is empty.
        companies, evidence_by_id, rankings = {}, {}, {}
        partial, reason = True, 'OpenAlex shared keyless query budget exhausted (HTTP 429); counts are lower bounds from a sample of founder papers and papers already cited in this founder research.'
        seed_ids = {w['id'].rsplit('/', 1)[-1] for w in works if since <= w.get('publication_date', '') <= as_of}
        for item in seed_evidence:
            match = re.search(r'openalex.org/(W\d+)', item.source_url)
            if match and (not item.source_date or since <= item.source_date[:10] <= as_of):
                seed_ids.add(match[1])
        buckets = {}
        for wid in sorted(seed_ids)[:20]:
            params = {'select': 'id,title,publication_date,topics,authorships'}
            work = _get('works/' + wid, params)
            if not since <= work.get('publication_date', '') <= as_of:
                continue
            overlapping = [t['display_name'] for t in topics if t['id'] in {x['id'] for x in work.get('topics', [])}]
            institutions = {i['id']: i for a in work.get('authorships', []) for i in a.get('institutions', [])}
            for institution in institutions.values():
                if institution.get('type') != 'company' or _same_company(institution['display_name'], founder.company):
                    continue
                for topic in overlapping:
                    key = institution['id'], topic
                    bucket = buckets.setdefault(key, {'institution': institution, 'works': {}})
                    quote = {'id': work['id'], 'title': work['title'], 'publication_date': work['publication_date'],
                             'topics': work['topics'], 'authorships.institutions': institution}
                    bucket['works'][wid] = Evidence(id=f'evidence:adjacent:paper:{wid}:{institution["id"].rsplit("/", 1)[-1]}',
                        source_url=_url('works/' + wid, params), quote=json.dumps(quote, ensure_ascii=False, separators=(',', ':')),
                        source_date=work['publication_date'], observed_at=observed_at, kind='paper')
        for (_, topic), bucket in buckets.items():
            add(bucket['institution'], topic, len(bucket['works']), list(bucket['works'].values()), sampled=True)
    ordered = [companies[iid] for iid in sorted(companies, key=lambda k: (-rankings[k], companies[k]['name']))[:12]]
    used = {eid for company in ordered for eid in company['evidence_ids']}
    return {'competitors': ordered, 'evidence': [e for eid, e in evidence_by_id.items() if eid in used],
            '_meta': {'founder_id': founder.id, 'fingerprint': fingerprint(founder), 'cached': True,
                      'observed_at': observed_at, 'from_publication_date': since, 'to_publication_date': as_of,
                      'label': 'Adjacent companies publishing on the same topics', 'partial': partial,
                      'notes': reason or 'Publication overlap is not evidence of commercial competition. Up to 600 institution groups and 12 companies checked per topic; returns at most 12 companies. Ranking sums per-topic counts and may count a paper in multiple topics.',
                      'company_exclusion': 'name match' if founder.company else 'unavailable: founder company not supplied'}}


if __name__ == '__main__':
    from ...store import store
    from .icp import load_research
    store.load()
    try:
        works = load_research(store.founder.id)['works']
    except ValueError:
        works = []
    result = discover(store.founder, works, store.evidence.values())
    _write(SNAPSHOT, validate_snapshot(result, store.founder))
    print(json.dumps(result, ensure_ascii=False, indent=2))
