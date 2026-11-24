"""Evidence-backed buyer hypotheses for any researched founder (38 second budget)."""
import hashlib
import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime, timedelta, timezone
from threading import Lock, get_ident
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from ...openalex import with_key

from ...models import Evidence, Founder, Icp, Org, Signal
from ...store import FIXTURES, store
from .icp import load_research

LOG = logging.getLogger(__name__)
CACHE = FIXTURES.parent / 'data' / 'cache' / 'jakob'
_last_request = 0.0
_request_lock = Lock()
_STOP = set('a an and are as at be by can could for from hypothesis in into is it may of on or the their these this to with research based need needs improve improving enable enabling advanced advancements technologies technology modeling management systems materials development manufacturing developers'.split())


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f'.{get_ident()}.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    temporary.replace(path)


def _get_json(url: str, deadline: float | None = None):
    """Keyless requests, <=4 OpenAlex req/s, with raw successful responses cached."""
    global _last_request
    deadline = deadline if deadline is not None else time.monotonic() + 5
    cache = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:24] + '.json')
    today = datetime.now(timezone.utc).date().isoformat()
    if cache.exists():
        saved = json.loads(cache.read_text())
        if saved['observed_at'].startswith(today):
            return saved['response']
    if url.startswith('https://api.openalex.org/'):
        with _request_lock:
            pause = max(0, .26 - (time.monotonic() - _last_request))
            if time.monotonic() + pause >= deadline:
                raise TimeoutError('Buyer computation deadline reached')
            time.sleep(pause)
            _last_request = time.monotonic()
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('Buyer computation deadline reached')
    with urlopen(Request(with_key(url), headers={'User-Agent': 'DeepBridge-demo/0.1'}),
                 timeout=min(3, remaining)) as response:
        if response.status != 200:
            raise ValueError('Only successful public boards and API responses are usable')
        data = json.load(response)
    _write(cache, {'url': url, 'observed_at': datetime.now(timezone.utc).isoformat(), 'response': data})
    return data


def _topic_terms(founder: Founder, icp: Icp | None = None) -> list[str]:
    """Use scientific words from this founder and their evidence-backed ICP needs."""
    texts = founder.topics + ([n.text for n in icp.needs] if icp else [])
    words = [w.casefold() for text in texts for w in re.findall(r'[a-zA-Z][a-zA-Z-]{2,}', text)]
    return list(dict.fromkeys(w for w in words if w not in _STOP))[:32]


def _cached_icp(founder):
    if founder.id == store.founder.id:
        return store.icp
    # Same fingerprint and location as GET /icp. Never start a 180s CLI call here.
    try:
        research = load_research(founder.id)
        fingerprint = hashlib.sha256(json.dumps({'founder': research['founder'],
            'works': research['works'], 'persona': research['persona']}, sort_keys=True).encode()).hexdigest()
        path = CACHE / 'icp' / (hashlib.sha256(founder.id.encode()).hexdigest()[:24] + '.json')
        saved = json.loads(path.read_text())
        if saved.get('fingerprint') == fingerprint:
            return Icp.model_validate(saved['icp'])
    except (OSError, ValueError, KeyError):
        pass
    return None


def _works_url(filters, **params):
    return 'https://api.openalex.org/works?' + urlencode({'filter': filters, 'page': 1, **params})


class _Sources:
    def __init__(self, deadline):
        self.deadline = deadline
        self.blocked = False
        self.errors = []

    def get(self, url):
        if self.blocked or time.monotonic() >= self.deadline:
            return None
        try:
            return _get_json(url, self.deadline)
        except (OSError, ValueError, KeyError) as exc:
            self.errors.append(str(exc))
            if isinstance(exc, HTTPError) and exc.code in (401, 403, 429):
                self.blocked = True  # Shared keyless budget is exhausted; don't hammer it.
            LOG.warning('Buyer source unavailable: %s', exc)
            return None


def _discover(founder, icp, source):
    """Company affiliations are publication-dated; they do not establish employment."""
    companies, works = {}, []
    try:
        works = load_research(founder.id)['works']
    except (OSError, ValueError, KeyError):
        pass
    author_id = founder.openalex_id.rsplit('/', 1)[-1] if founder.openalex_id else None
    if author_id:
        # A bounded sample: 200 top-cited works, not a claim of exhaustive coverage.
        data = source.get(_works_url('author.id:' + author_id, **{
            'per-page': 200, 'sort': 'cited_by_count:desc',
            'select': 'id,title,publication_date,authorships'}))
        if data:
            works = list({w['id']: w for w in works + data['results']}.values())
    coauthors = {}
    def remember(institution):
        if institution.get('type') == 'company' and institution.get('id'):
            companies[institution['id']] = Org(id='org:openalex:' + institution['id'].rsplit('/', 1)[-1],
                name=institution['display_name'], type='company', is_buyer=False,
                buyer_score=0, openalex_id=institution['id'])
    for work in works:
        for authorship in work.get('authorships', []):
            author = authorship.get('author') or {}
            aid = (author.get('id') or '').rsplit('/', 1)[-1]
            if not aid or aid == author_id:
                continue
            coauthors[aid] = True
            for institution in authorship.get('institutions', []):
                remember(institution)
    # Discover company affiliations of coauthors beyond their shared founder paper.
    for start in range(0, min(len(coauthors), 100), 50):
        ids = list(coauthors)[start:start + 50]
        data = source.get('https://api.openalex.org/authors?' + urlencode({
            'filter': 'openalex_id:' + '|'.join(ids), 'per-page': 50, 'page': 1,
            'select': 'id,last_known_institutions,affiliations'}))
        for author in (data or {}).get('results', []):
            for institution in author.get('last_known_institutions') or []:
                remember(institution)
            for affiliation in author.get('affiliations', []):
                remember(affiliation.get('institution', {}))
    for industry in (icp.industries[:3] if icp else []):
        data = source.get('https://api.openalex.org/institutions?' + urlencode({
            'search': industry.name, 'filter': 'type:company', 'per-page': 10, 'page': 1,
            'select': 'id,display_name,type'}))
        for institution in (data or {}).get('results', []):
            remember(institution)
    return [o for o in companies.values() if not founder.company or
            o.name.casefold() != founder.company.casefold()], list(dict.fromkeys(w['id'].rsplit('/', 1)[-1] for w in works))[:100]


def _group_counts(orgs, filters, source):
    """Counts grouped by company across the candidate set, not a sampled ranking."""
    if not orgs:
        return {}, None
    ids = '|'.join(o.openalex_id.rsplit('/', 1)[-1] for o in orgs)
    url = _works_url('institutions.id:' + ids + ',' + filters,
                     group_by='institutions.id', **{'per-page': 200})
    data = source.get(url)
    allowed = {o.openalex_id for o in orgs}
    counts = {g['key']: g['count'] for g in (data or {}).get('group_by', []) if g['key'] in allowed}
    return counts, url if data else None


def _slugs(name):
    name = name.casefold()
    trimmed = re.sub(r'\b(incorporated|inc|corporation|corp|limited|ltd|llc|company|co)\b\.?', '', name)
    return list(dict.fromkeys(s for text in (name, trimmed) for s in (
        re.sub(r'[^a-z0-9]', '', text), re.sub(r'[^a-z0-9]+', '-', text).strip('-')) if s))


def _jobs(provider, slug, deadline):
    if provider == 'greenhouse':
        url = f'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs'
        data = _get_json(url, deadline)
        return [dict(id=str(j['id']), title=j['title'], url=j['absolute_url'], date=None,
                     source_url=url) for j in data['jobs']]
    if provider == 'ashby':
        url = f'https://api.ashbyhq.com/posting-api/job-board/{slug}'
        data = _get_json(url, deadline)
        return [dict(id=j.get('id', j['jobUrl']), title=j['title'], url=j['jobUrl'],
                     source_url=url, date=j.get('publishedAt')) for j in data['jobs'] if j.get('isListed', True)]
    url = f'https://api.lever.co/v0/postings/{slug}?mode=json'
    data = _get_json(url, deadline)
    return [dict(id=j['id'], title=j['text'], url=j['hostedUrl'], source_url=url,
                 date=datetime.fromtimestamp(j['createdAt'] / 1000, timezone.utc).isoformat()
                 if j.get('createdAt') else None) for j in data]


def _discover_jobs(org, deadline):
    jobs = {}
    for provider in ('ashby', 'greenhouse', 'lever'):
        for slug in _slugs(org.name):
            if time.monotonic() >= deadline:
                return list(jobs.values())
            try:
                found = _jobs(provider, slug, deadline)
                jobs.update({j['url']: j for j in found})
                break  # Retain only boards returning 200 and the expected JSON shape.
            except (OSError, ValueError, KeyError, TypeError):
                continue
    return list(jobs.values())


def rank_buyers(founder: Founder, org_ids: list[str]) -> tuple[list[Org], list[Signal]]:
    """Top ten candidates by on-topic works in 12 months, scored with public signals.

    Scores are heuristics: min(40,4*papers_90d) + min(35,5*citing_papers)
    + min(25,5*job_posts). Citation counts are verified lower bounds over at most
    100 founder works and 200 citing works; unavailable sources contribute zero.
    """
    deadline = time.monotonic() + 38
    source = _Sources(min(deadline, time.monotonic() + 24))
    today = datetime.now(timezone.utc).date()
    observed = datetime.now(timezone.utc).isoformat()
    icp = _cached_icp(founder)
    terms = _topic_terms(founder, icp)
    orgs, works = _discover(founder, icp, source)
    if not orgs and source.errors:
        raise RuntimeError('OpenAlex company discovery unavailable: ' + source.errors[0])
    if org_ids:
        orgs = [o for o in orgs if o.id in org_ids]
    # OpenAlex OR limit is 100; cap discovery deterministically before grouping.
    orgs = sorted(orgs, key=lambda o: o.id)[:100]
    topic_filter = 'title_and_abstract.search:' + ' OR '.join(terms)
    date_filter = 'to_publication_date:' + today.isoformat()
    year_counts, year_url = _group_counts(orgs, 'from_publication_date:' +
        (today - timedelta(days=365)).isoformat() + ',' + date_filter + ',' + topic_filter, source) if terms else ({}, None)
    if orgs and terms and year_url is None:
        raise RuntimeError('OpenAlex annual buyer ranking unavailable; retry shortly')
    orgs = sorted(orgs, key=lambda o: (-year_counts.get(o.openalex_id, 0), o.name))[:10]
    recent, recent_url = _group_counts(orgs, 'from_publication_date:' +
        (today - timedelta(days=90)).isoformat() + ',' + date_filter + ',' + topic_filter, source) if terms else ({}, None)
    citations = {o.openalex_id: {} for o in orgs}
    if orgs and works:
        ids = '|'.join(o.openalex_id.rsplit('/', 1)[-1] for o in orgs)
        data = source.get(_works_url('institutions.id:' + ids + ',cites:' + '|'.join(works) + ',' + date_filter,
            **{'per-page': 200, 'sort': 'publication_date:desc', 'select': 'id,title,publication_date,authorships'}))
        for work in (data or {}).get('results', []):
            for authorship in work.get('authorships', []):
                for institution in authorship.get('institutions', []):
                    if institution['id'] in citations:
                        citations[institution['id']][work['id']] = work
    signals, evidence, ranked = [], {}, []
    def add(org, kind, title, url, quote, date=None, suffix=''):
        digest = hashlib.sha256((founder.id + org.id + kind + url + suffix).encode()).hexdigest()[:20]
        eid = 'evidence:buyers:' + digest
        evidence[eid] = Evidence(id=eid, source_url=url, quote=quote, source_date=date,
            observed_at=observed, kind='job_post' if kind == 'job_post' else 'paper')
        signals.append(Signal(id='signal:buyers:' + digest, org_id=org.id, type=kind,
            title=title, date=date, evidence_ids=[eid]))
    job_results = {}
    # Network waits run concurrently. Never wait for worker shutdown beyond the budget.
    executor = ThreadPoolExecutor(max_workers=10)
    futures = {executor.submit(_discover_jobs, o, deadline): o for o in orgs}
    try:
        for future in as_completed(futures, timeout=max(.001, deadline - time.monotonic())):
            job_results[futures[future].id] = future.result()
    except FuturesTimeout:
        pass
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    for org in orgs:
        papers = recent.get(org.openalex_id, 0)
        if papers and recent_url:
            add(org, 'paper_90d', f'{papers} on-topic papers in the past 90 days (cached)',
                recent_url, f"key: {org.openalex_id}; count: {papers}", today.isoformat(), org.id)
        citing = citations[org.openalex_id]
        if citing:
            # Every counted citing work has a retrievable verbatim title as evidence.
            start = len(signals)
            for work in citing.values():
                add(org, 'cites_founder', 'Citation evidence', work['id'], work['title'], work.get('publication_date'))
            proofs = signals[start:]
            del signals[start:]
            newest = max(citing.values(), key=lambda w: w.get('publication_date') or '')
            signals.append(Signal(id=proofs[0].id, org_id=org.id, type='cites_founder',
                title=f'At least {len(citing)} papers cite sampled founder works (cached)',
                date=newest.get('publication_date'), evidence_ids=[s.evidence_ids[0] for s in proofs]))
        jobs = [j for j in job_results.get(org.id, []) if any(re.search(r'\b' + re.escape(t) + r'\b',
                j['title'], re.I) for t in terms)]
        for job in jobs:
            add(org, 'job_post', job['title'] + ' (cached listing)', job['source_url'],
                job['title'], job['date'], job['id'])
        score = min(40, papers * 4) + min(35, len(citing) * 5) + min(25, len(jobs) * 5)
        ranked.append(org.model_copy(update={'buyer_score': score, 'is_buyer': score > 0}))
    with store.lock:
        store.evidence.update(evidence)
    return sorted(ranked, key=lambda o: (-(o.buyer_score or 0), o.name)), signals


def main():
    """Live check without overwriting the instant Lightmatter stage fixture."""
    import sys
    store.load()
    if len(sys.argv) > 1:
        founder = Founder.model_validate(load_research(sys.argv[1])['founder'])
    else:
        founder = store.founder
    started = time.monotonic()
    orgs, signals = rank_buyers(founder, [])
    print(json.dumps({'founder': founder.name, 'seconds': round(time.monotonic() - started, 2),
        'orgs': [o.model_dump() for o in orgs], 'signals': [s.model_dump() for s in signals]}, indent=2))


if __name__ == '__main__':
    main()
