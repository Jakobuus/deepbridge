"""Pull public buyer signals. Run with `python -m app.lanes.jakob.signals`."""
import hashlib
import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from ...openalex import with_key

from ...models import Evidence, Founder, Org, Signal
from ...store import FIXTURES, store

LOG = logging.getLogger(__name__)
CACHE = FIXTURES.parent / 'data' / 'cache' / 'jakob'
# Verified against the public board API, 2026-11-24. Other employers are skipped.
JOB_BOARDS = {'org:psiquantum': ('greenhouse', 'psiquantum')}
_last_request = 0.0
_request_lock = Lock()


def _get_json(url: str):
    """Keyless requests, <=4 req/s; raw responses cached by URL and UTC day."""
    global _last_request
    cache = CACHE / (hashlib.sha256(url.encode()).hexdigest()[:24] + '.json')
    today = datetime.now(timezone.utc).date().isoformat()
    if cache.exists():
        saved = json.loads(cache.read_text())
        if saved['observed_at'].startswith(today):
            return saved['response']
    with _request_lock:
        time.sleep(max(0, .26 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        with urlopen(Request(with_key(url), headers={'User-Agent': 'DeepBridge-demo/0.1'}), timeout=30) as response:
            data = json.load(response)
    CACHE.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({'url': url, 'observed_at': datetime.now(timezone.utc).isoformat(),
                                'response': data}, ensure_ascii=False, separators=(',', ':')))
    return data


def _works_url(filters: str, page=1, per_page=1, sort='publication_date:desc') -> str:
    return 'https://api.openalex.org/works?' + urlencode({
        'filter': filters, 'sort': sort, 'select': 'id,title,publication_date',
        'per-page': per_page, 'page': page})


def _topic_terms(founder: Founder) -> list[str]:
    if re.search(r'photonic|optical', ' '.join(founder.topics), re.I):
        return ['photonic', 'photonics', 'optical', 'optics', 'silicon photonics', 'interconnect']
    # Preserve scientific phrases; generic words like "computing" alone are too broad.
    return list(dict.fromkeys(part.strip().lower() for topic in founder.topics
                              for part in re.split(r'\band\b|[,;]', topic, flags=re.I)
                              if part.strip()))


def _founder_works(founder: Founder) -> list[str]:
    if not founder.openalex_id:
        return []
    works, page = [], 1
    while True:
        data = _get_json(_works_url('author.id:' + founder.openalex_id.rsplit('/', 1)[-1],
                                    page=page, per_page=200))
        works.extend(w['id'].rsplit('/', 1)[-1] for w in data['results'])
        if page * 200 >= data['meta']['count'] or not data['results']:
            return list(dict.fromkeys(works))
        page += 1


def _known_citing_works(work_ids: list[str]) -> list[dict]:
    """Recheck individual works seeded by existing citation evidence, without search.

    Single-entity reads are still available when the keyless search budget is
    exhausted. Samples are checked for actual references and exact institutions;
    they establish a lower bound, never a total query count.
    """
    seeds = set()
    for signal in store.signals.values():
        if signal.type != 'cites_founder':
            continue
        for eid in signal.evidence_ids:
            evidence = store.evidence.get(eid)
            if evidence:
                seeds.update(re.findall(r'https://openalex.org/(W[0-9]+)',
                                        evidence.source_url + ' ' + evidence.quote))
    verified = []
    for wid in sorted(seeds - set(work_ids)):
        url = 'https://api.openalex.org/works/' + wid + '?' + urlencode({
            'select': 'id,title,publication_date,authorships,referenced_works'})
        try:
            work = _get_json(url)
            references = {ref.rsplit('/', 1)[-1] for ref in work['referenced_works']}
            if references.intersection(work_ids):
                work['_source_url'] = url
                verified.append(work)
        except (OSError, ValueError, KeyError) as exc:
            LOG.warning('Known citation %s unavailable: %s', wid, exc)
    return verified


def _jobs(provider: str, slug: str) -> list[dict]:
    if provider == 'greenhouse':
        data = _get_json(f'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs')
        return [dict(id=str(j['id']), title=j['title'], url=j['absolute_url'], date=None,
                     source_url=f'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{j["id"]}')
                for j in data['jobs']]  # updated_at is not a publication date.
    if provider == 'ashby':
        data = _get_json(f'https://api.ashbyhq.com/posting-api/job-board/{slug}')
        return [dict(id=j.get('id', j['jobUrl']), title=j['title'], url=j['jobUrl'],
                     date=j.get('publishedAt')) for j in data['jobs'] if j.get('isListed', True)]
    if provider == 'lever':
        data = _get_json(f'https://api.lever.co/v0/postings/{slug}?mode=json')
        return [dict(id=j['id'], title=j['text'], url=j['hostedUrl'],
                     date=datetime.fromtimestamp(j['createdAt'] / 1000, timezone.utc).isoformat()
                     if j.get('createdAt') else None) for j in data]
    raise ValueError(f'Unknown public job board: {provider}')


def rank_buyers(founder: Founder, org_ids: list[str]) -> tuple[list[Org], list[Signal]]:
    """Rank fixture companies other than the founder's company, with public evidence.

    Score (0-100) = min(40, 4 * on-topic papers in [today-90, today])
      + min(35, 5 * distinct papers citing any founder work, all time)
      + min(25, 5 * matching currently listed job posts).
    This is a ranking heuristic, not purchase intent. Missing/failed sources add
    zero, never an invented claim. Each source is independent. Empty org_ids means
    all fixture companies. Evidence is registered in the store for /evidence/{id};
    the CLI persists it together with the ranked demo response.
    """
    today = datetime.now(timezone.utc).date()
    cutoff = (today - timedelta(days=90)).isoformat()
    observed = datetime.now(timezone.utc).isoformat()
    terms = _topic_terms(founder)
    signals, evidence, ranked = [], {}, []
    try:
        works = _founder_works(founder)
    except (OSError, ValueError, KeyError) as exc:
        LOG.warning('Founder works unavailable: %s', exc)
        works = []
    known_citations = None
    candidates = json.loads((FIXTURES / 'orgs.json').read_text())
    candidates = candidates.get('items', []) if isinstance(candidates, dict) else candidates
    selected = set(org_ids)

    def add(org, kind, title, source_url, quote, date=None, suffix=''):
        digest = hashlib.sha256((founder.id + org.id + kind + source_url + suffix).encode()).hexdigest()[:20]
        eid, sid = f'evidence:buyers:{digest}', f'signal:buyers:{digest}'
        evidence[eid] = Evidence(id=eid, source_url=source_url, quote=quote,
                                 source_date=date, observed_at=observed,
                                 kind='job_post' if kind == 'job_post' else 'paper')
        signal = Signal(id=sid, org_id=org.id, type=kind, title=title, date=date, evidence_ids=[eid])
        signals.append(signal)
        return signal

    for raw in candidates:
        org = Org.model_validate(raw)
        if (org.type != 'company' or org.name.casefold() == founder.company.casefold()
                or (selected and org.id not in selected)):
            continue
        recent, citations, job_count = 0, 0, 0
        institution = org.openalex_id.rsplit('/', 1)[-1] if org.openalex_id else None
        if institution and terms:
            url = _works_url(f'institutions.id:{institution},from_publication_date:{cutoff},'
                             f'to_publication_date:{today},title_and_abstract.search:' + ' OR '.join(terms))
            try:
                data = _get_json(url)
                if data['meta']['count'] and data['results']:
                    recent = data['meta']['count']
                    newest = data['results'][0]
                    signal = add(org, 'paper_90d', f'{recent} on-topic papers since {cutoff} (cached)',
                                 url, f"meta.count: {recent}", today.isoformat())
                    # Keep the newest title verbatim in separate, work-level evidence.
                    title_signal = add(org, 'paper_90d', newest['title'], newest['id'],
                                       newest['title'], newest['publication_date'], 'newest')
                    signals.pop()
                    signal.evidence_ids.extend(title_signal.evidence_ids)
            except (OSError, ValueError, KeyError) as exc:
                LOG.warning('%s recent papers unavailable: %s', org.name, exc)
        if institution and works:
            # OR counts each citing work once. OpenAlex allows <=100 IDs per OR.
            citing, citation_urls = {}, []
            try:
                for start in range(0, len(works), 100):
                    page = 1
                    while True:
                        url = _works_url(f'institutions.id:{institution},to_publication_date:{today},cites:'
                                         + '|'.join(works[start:start + 100]), page=page, per_page=200)
                        data = _get_json(url)
                        citation_urls.append((url, data['meta']['count']))
                        citing.update({w['id']: w for w in data['results']})
                        if page * 200 >= data['meta']['count'] or not data['results']:
                            break
                        page += 1
                citations = len(citing)
                if citations:
                    newest = max(citing.values(), key=lambda w: (w['publication_date'], w['id']))
                    signal = add(org, 'cites_founder',
                                 f'{citations} distinct papers cite founder works (all time; cached)',
                                 newest['id'], newest['title'], newest['publication_date'])
                    for url, count in citation_urls:
                        proof = add(org, 'cites_founder', 'Citation query', url,
                                    f'meta.count: {count}', today.isoformat())
                        signals.pop()
                        signal.evidence_ids.extend(proof.evidence_ids)
            except (OSError, ValueError, KeyError) as exc:
                LOG.warning('%s citations unavailable: %s', org.name, exc)
                if known_citations is None:
                    known_citations = _known_citing_works(works)
                samples = [w for w in known_citations
                           if w['publication_date'] <= today.isoformat() and any(
                               i['id'] == org.openalex_id for a in w['authorships']
                               for i in a.get('institutions', []))]
                citations = len(samples)
                if samples:
                    newest = max(samples, key=lambda w: (w['publication_date'], w['id']))
                    add(org, 'cites_founder',
                        f'at least {citations} verified citing papers (query unavailable; cached)',
                        newest['_source_url'], newest['title'], newest['publication_date'])
        if org.id in JOB_BOARDS:
            try:
                seen = set()
                for job in _jobs(*JOB_BOARDS[org.id]):
                    if job['url'] in seen or not any(re.search(r'\b' + re.escape(t) + r'\b',
                                                               job['title'], re.I) for t in terms):
                        continue
                    seen.add(job['url'])
                    signal = add(org, 'job_post', job['title'] + ' (cached listing)',
                                 job.get('source_url', job['url']), job['title'], job['date'], job['id'])
                    if job.get('source_url') and job['source_url'] != job['url']:
                        posting = add(org, 'job_post', job['title'], job['url'],
                                      job['title'], job['date'], job['id'])
                        signals.pop()
                        signal.evidence_ids.extend(posting.evidence_ids)
                    job_count += 1
            except (OSError, ValueError, KeyError) as exc:
                LOG.warning('%s job board unavailable: %s', org.name, exc)
        score = min(40, recent * 4) + min(35, citations * 5) + min(25, job_count * 5)
        ranked.append(org.model_copy(update={'buyer_score': score, 'is_buyer': score > 0}))
    with store.lock:
        store.evidence.update(evidence)
    return sorted(ranked, key=lambda o: (-(o.buyer_score or 0), o.name)), signals


def main():
    logging.basicConfig(level=logging.WARNING)
    store.load()
    orgs, signals = rank_buyers(store.founder, [])
    eids = {eid for s in signals for eid in s.evidence_ids}
    payload = {
        '_meta': {'cached': True, 'observed_at': datetime.now(timezone.utc).isoformat(),
                  'founder_id': store.founder.id, 'case': store.founder.company,
                  'score_formula': 'min(40,4*papers_90d)+min(35,5*citing_papers)+min(25,5*job_posts)',
                  'notes': 'Public API snapshot. Scores are heuristics. Unavailable sources add zero; '
                           'query-unavailable citation samples establish lower bounds only. Citations are all time; '
                           'job listing observation does not establish publication date. '
                           'Publication affiliations do not establish current employment.'},
        'orgs': [o.model_dump() for o in orgs],
        'signals': [s.model_dump() for s in signals],
        'evidence': [store.evidence[eid].model_dump() for eid in sorted(eids)],
    }
    (FIXTURES / 'buyers_computed.json').write_text(json.dumps(payload, indent=2, ensure_ascii=False) + '\n')
    print(f'Live pull: {len(orgs)} companies, {len(signals)} signals, {len(eids)} evidence records')
    for org in orgs:
        kinds = [s.type for s in signals if s.org_id == org.id]
        print(f'{org.name}: score={org.buyer_score:g}; signals={len(kinds)}; {", ".join(sorted(set(kinds)))}')


if __name__ == '__main__':
    main()
