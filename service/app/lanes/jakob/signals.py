"""Evidence-backed buyer hypotheses for any researched founder (38 second budget)."""
import hashlib
import json
import logging
import re
import time
from calendar import monthrange
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeout
from datetime import datetime, timedelta, timezone
from threading import Lock, get_ident
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic import Field

from ...openalex import with_key
from ...models import Evidence, Founder, Icp, Org, Signal
from ...store import FIXTURES, store
from .icp import load_research


class BuyerOrg(Org):
    category_hint: str | None = None
    evidence_ids: list[str] = Field(default_factory=list)


LOG = logging.getLogger(__name__)
CACHE = FIXTURES.parent / 'data' / 'cache' / 'jakob'
_last_request = 0.0
_request_lock = Lock()
_INSTITUTION_TYPES = {'company': 'company', 'government': 'government', 'facility': 'lab'}
_HOPO_FOUNDER = 'person:openalex:A5043992375'
# This demo follows the venture's research scope, a subset of the author's work.
_HOPO_TERMS = (
    ('chelation', ('HOPO', 'hydroxypyridinone', 'hydroxypyridonate',
                   'gadolinium deposition', 'gadolinium retention', 'gadolinium chelation',
                   'MRI contrast agent', 'MRI contrast agents', 'gadolinium based contrast agents',
                   'zirconium 89', '89Zr PET', 'radiopharmaceutical chelation')),
    ('radiological', ('actinide chelator', 'actinide chelation', 'actinide decorporation',
                      'radiological countermeasures', 'radionuclide decorporation',
                      'uranium decorporation', 'plutonium decorporation')),
)
_WORK_FIELDS = 'id,title,publication_date,authorships'
_MAX_BUYERS = 12


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f'.{get_ident()}.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    temporary.replace(path)


def _get_json(url: str, deadline: float | None = None):
    """Use the configured OpenAlex access at up to 4 requests/s and cache responses."""
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


def buyer_inputs(founder):
    """Read already-generated data for this founder without starting a model call."""
    from ...routers.valuemap import _CACHE as value_maps

    icp = _cached_icp(founder)
    saved = value_maps.get(founder.id)
    problems = [node.text for node in saved[1].value_nodes if node.kind == 'problem'] if saved else []
    return icp, problems


def _words(text):
    return ' '.join(re.findall(r'[^\W_]+', text.casefold()))


def _phrases(text):
    text = re.sub(r'^hypothesis:\s*|\s*\(hypothesis\)', '', text, flags=re.I)
    for part in re.split(r'[.,;:/()]|\band\b|\bor\b', text, flags=re.I):
        words = _words(part).split()
        if 2 <= len(words) <= 7 or (len(words) == 1 and len(words[0]) >= 5):
            yield ' '.join(words)


def _topic_groups(founder, icp, problems):
    industries = [industry.name for industry in icp.industries] if icp else []
    topics = list(dict.fromkeys(phrase for text in founder.topics + problems for phrase in _phrases(text)))
    # Industry searches use the actual ICP labels as hints. Unclassified topic
    # evidence can still qualify an organization.
    if founder.id == _HOPO_FOUNDER:
        for anchor, seeds in _HOPO_TERMS:
            hint = next((industry for industry in industries if anchor in industry.casefold()), None)
            scoped = [phrase for phrase in topics + list(_phrases(hint or ''))
                      if ' ' in phrase and
                      (anchor in phrase or any(_words(term) in phrase for term in seeds))]
            yield hint, list(dict.fromkeys([*seeds, *scoped]))[:16]
    else:
        for industry in industries[:5]:
            if terms := list(_phrases(industry)):
                yield industry, terms
        if topics:
            yield None, topics[:16]


def _topic_search(terms):
    return ' OR '.join(f'"{term}"' for term in terms)


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


def _discover(founder, groups, source, date_filter):
    orgs, papers, affiliations, hints = {}, {}, {}, {}
    author_id = (founder.openalex_id or '').rsplit('/', 1)[-1]

    def remember(institution):
        key, name = institution.get('id'), institution.get('display_name')
        kind = _INSTITUTION_TYPES.get(institution.get('type'))
        if not (key and name and kind) or name.casefold() == founder.company.casefold():
            return None
        if key not in orgs:
            orgs[key] = BuyerOrg(id='org:openalex:' + key.rsplit('/', 1)[-1],
                name=name, type=kind, is_buyer=True, buyer_score=0, openalex_id=key)
        return key

    for hint, terms in groups:
        filters = ('institutions.type:' + '|'.join(_INSTITUTION_TYPES) + ',' + date_filter)
        for page in (1, 2):
            data = source.get(_works_url(filters, page=page, **{
                'search.title_and_abstract': _topic_search(terms),
                'per-page': 40, 'select': _WORK_FIELDS}))
            results = (data or {}).get('results', [])
            for work in results:
                for entry in work.get('authorships', []):
                    for institution in entry.get('institutions', []):
                        if key := remember(institution):
                            papers.setdefault(key, {})[work['id']] = work
                            if hint is not None:
                                hints.setdefault(key, {}).setdefault(hint, set()).add(work['id'])
            if len(results) < 40:
                break

    try:
        works = {work['id']: work for work in load_research(founder.id)['works']}
    except (OSError, ValueError, KeyError):
        pass
    if author_id:
        data = source.get(_works_url('author.id:' + author_id, **{
            'per-page': 200, 'sort': 'cited_by_count:desc', 'select': _WORK_FIELDS}))
        works.update((work['id'], work) for work in (data or {}).get('results', []))

    coauthors, work_ids = {}, []
    for work in works.values():
        title = ' ' + _words(work['title']) + ' '
        work_hints = [hint for hint, terms in groups if hint is not None and
                      any(' ' + _words(term) + ' ' in title for term in terms)]
        if founder.id == _HOPO_FOUNDER and not any(
                ' ' + _words(term) + ' ' in title for _, terms in groups for term in terms):
            continue
        work_ids.append(work['id'].rsplit('/', 1)[-1])
        date = work.get('publication_date')
        if not date:
            continue
        for entry in work.get('authorships', []):
            author = entry.get('author') or {}
            aid = (author.get('id') or '').rsplit('/', 1)[-1]
            if not aid or aid == author_id:
                continue
            coauthors.setdefault(aid, (work, work_hints))
            for institution in entry.get('institutions', []):
                if key := remember(institution):
                    if key not in affiliations or date > affiliations[key][0]:
                        affiliations[key] = (date, work['id'],
                            'authorships.institutions.display_name: ' + institution['display_name'], None)
                    for hint in work_hints:
                        hints.setdefault(key, {}).setdefault(hint, set()).add(work['id'])

    ids = list(coauthors)[:100]
    for start in range(0, len(ids), 50):
        data = source.get('https://api.openalex.org/authors?' + urlencode({
            'filter': 'openalex_id:' + '|'.join(ids[start:start + 50]), 'per-page': 50, 'page': 1,
            'select': 'id,affiliations'}))
        for author in (data or {}).get('results', []):
            aid = author['id'].rsplit('/', 1)[-1]
            if aid not in coauthors:
                continue
            work, work_hints = coauthors[aid]
            for affiliation in author.get('affiliations') or []:
                institution = affiliation.get('institution') or {}
                years = affiliation.get('years') or []
                if years and (key := remember(institution)):
                    year = str(max(years))
                    if key not in affiliations or year > affiliations[key][0]:
                        affiliations[key] = (year, author['id'],
                            'affiliations.institution.display_name: ' + institution['display_name'], work)
                    for hint in work_hints:
                        hints.setdefault(key, {}).setdefault(hint, set()).add(work['id'])

    return orgs, work_ids[:100], papers, affiliations, hints


def _group_counts(orgs, date_filter, terms, source):
    if not orgs or not terms:
        return {}, None
    ids = '|'.join(o.openalex_id.rsplit('/', 1)[-1] for o in orgs)
    url = _works_url('institutions.id:' + ids + ',' + date_filter,
                     **{'search.title_and_abstract': _topic_search(terms),
                        'group_by': 'institutions.id', 'per-page': 200})
    data = source.get(url)
    allowed = {o.openalex_id for o in orgs}
    counts = {g['key']: g['count'] for g in (data or {}).get('group_by', []) if g['key'] in allowed}
    return counts, url if data else None


def _slugs(name):
    name = re.sub(r'\s*\([^()]*\)$', '', name.casefold())
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


def rank_buyers(
    founder: Founder, org_ids: list[str], inputs=None,
) -> tuple[list[BuyerOrg], list[Signal]]:
    """Score publication and co-author candidates with the existing signals."""
    deadline = time.monotonic() + 38
    source = _Sources(min(deadline, time.monotonic() + 30))
    today = datetime.now(timezone.utc).date()
    observed = datetime.now(timezone.utc).isoformat()
    icp, problems = buyer_inputs(founder) if inputs is None else inputs
    groups = list(_topic_groups(founder, icp, problems))
    terms = list(dict.fromkeys(term for _, group in groups for term in group))
    date_filter = 'to_publication_date:' + today.isoformat()
    two_years_ago = today.replace(year=today.year - 2,
        day=min(today.day, monthrange(today.year - 2, today.month)[1]))
    discovered, works, topical, affiliations, hints = _discover(
        founder, groups, source, f'from_publication_date:{two_years_ago},{date_filter}')
    if source.errors and (not discovered or (groups and not topical)):
        raise RuntimeError('OpenAlex buyer discovery unavailable: ' + source.errors[0])
    orgs = [org for org in discovered.values() if not org_ids or org.id in org_ids]
    # Keep within OpenAlex's OR limit while retaining the strongest discovery evidence.
    orgs = sorted(orgs, key=lambda o: (-len(topical.get(o.openalex_id, {})),
        o.openalex_id not in affiliations, o.name, o.id))[:100]
    cutoff = (today - timedelta(days=90)).isoformat()
    recent, recent_url = _group_counts(orgs, f'from_publication_date:{cutoff},{date_filter}', terms, source)
    citations = {o.openalex_id: {} for o in orgs}
    if works:
        # Give both cohorts their own citation sample so prolific institutions
        # do not exhaust the results before company publications are counted.
        for company in (True, False):
            ids = '|'.join(o.openalex_id.rsplit('/', 1)[-1] for o in orgs
                           if (o.type == 'company') == company)
            if not ids:
                continue
            data = source.get(_works_url('institutions.id:' + ids + ',cites:' + '|'.join(works) + ',' + date_filter,
                **{'per-page': 200, 'sort': 'publication_date:desc', 'select': _WORK_FIELDS}))
            for work in (data or {}).get('results', []):
                for authorship in work.get('authorships', []):
                    for institution in authorship.get('institutions', []):
                        if institution['id'] in citations:
                            citations[institution['id']][work['id']] = work
    signals, evidence, ranked = [], {}, []

    def proof(org, kind, url, quote, date, suffix=''):
        digest = hashlib.sha256((founder.id + org.id + kind + url + suffix).encode()).hexdigest()[:20]
        eid = 'evidence:buyers:' + digest
        evidence[eid] = Evidence(id=eid, source_url=url, quote=quote, source_date=date,
                                 observed_at=observed, kind=kind)
        return eid, digest

    def add(org, kind, title, url, quote, date=None, suffix=''):
        eid, digest = proof(org, 'job_post' if kind == 'job_post' else 'paper',
                            url, quote, date, kind + suffix)
        signals.append(Signal(id='signal:buyers:' + digest, org_id=org.id, type=kind,
                              title=title, date=date, evidence_ids=[eid]))

    job_results = {}
    # Network waits run concurrently. Never wait for worker shutdown beyond the budget.
    executor = ThreadPoolExecutor(max_workers=10)
    job_candidates = sorted((o for o in orgs if o.type == 'company'), key=lambda o: (
        -min(40, recent.get(o.openalex_id, 0) * 4)
        - min(35, len(citations[o.openalex_id]) * 5), o.name, o.id))
    futures = {executor.submit(_discover_jobs, o, deadline): o for o in job_candidates[:_MAX_BUYERS]}
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
        key = org.openalex_id
        matches = hints.get(key, {})
        topic_works = topical.get(key, {})
        hint = max(matches, key=lambda name: (len(matches[name].intersection(topic_works)),
                                              len(matches[name])), default=None)
        org_proofs = []
        if topic_works:
            work = max(topic_works.values(), key=lambda w: (w.get('publication_date') or '', w['id']))
            org_proofs.append(proof(org, 'paper', work['id'], work['title'],
                                    work.get('publication_date'))[0])
        if key in affiliations:
            date, url, quote, shared_work = affiliations[key]
            org_proofs.append(proof(org, 'affiliation', url, quote, date)[0])
            if shared_work:
                org_proofs.append(proof(org, 'paper', shared_work['id'], shared_work['title'],
                                        shared_work.get('publication_date'))[0])
        ranked.append(org.model_copy(update={'buyer_score': score, 'category_hint': hint,
                                            'evidence_ids': org_proofs}))
    with store.lock:
        store.evidence.update(evidence)
    ranked.sort(key=lambda o: (-(o.buyer_score or 0), -len(topical.get(o.openalex_id, {})), o.name, o.id))
    ranked = ranked[:_MAX_BUYERS]
    selected = {o.id for o in ranked}
    return ranked, [signal for signal in signals if signal.org_id in selected]


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
