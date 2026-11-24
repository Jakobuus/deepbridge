"""Bounded OpenAlex pulls, replayable without a key or network.

CLI: cd service && uv run python -m app.lanes.erick.pull A5060617433
Single-entity GETs may still work when the venue's list-query budget is empty.
"""
import hashlib
import json
import os
import re
import threading
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[4]
CACHE = ROOT / 'data/cache/erick'
_LOCK = threading.RLock()  # serialises OpenAlex pulls (slow, network)
_STATE_LOCK = threading.RLock()  # guards in-memory graph state only (fast); never held during network calls
_LAST_REQUEST = 0.0


class OpenAlexUnavailable(RuntimeError):
    pass


def author_id(value):
    match = re.fullmatch(r'(?:person:openalex:|https://openalex.org/)?(A\d+)', value, re.I)
    if not match:
        raise ValueError('Expected an OpenAlex author ID (A…, person:openalex:A…, or author URL)')
    return match.group(1).upper()


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(f'.{threading.get_ident()}.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    temp.replace(path)


def request(endpoint, params=None):
    """Cache keys never contain credentials; serialize calls to stay below 5 req/s."""
    global _LAST_REQUEST
    params = dict(params or {})
    params.pop('api_key', None)
    identity = endpoint + '?' + urlencode(sorted(params.items()))
    path = CACHE / 'raw' / (hashlib.sha256(identity.encode()).hexdigest()[:24] + '.json')
    if path.exists():
        return json.loads(path.read_text())
    key = os.environ.get('OPENALEX_API_KEY')
    if key:
        params['api_key'] = key
    url = 'https://api.openalex.org/' + endpoint + '?' + urlencode(params)
    try:
        with _LOCK:
            time.sleep(max(0, .21 - (time.monotonic() - _LAST_REQUEST)))
            _LAST_REQUEST = time.monotonic()
            with urlopen(Request(url, headers={'User-Agent': 'DeepBridge/0.1 (publication graph)'}), timeout=12) as response:
                data = json.loads(response.read())
    except HTTPError as exc:
        # Never include the request URL: it may contain a key.
        if exc.code in (402, 403, 429):
            raise OpenAlexUnavailable('OpenAlex budget or rate limit exhausted; cached data is used when available. '
                                     'Set OPENALEX_API_KEY for a separate budget, or retry after the budget resets.') from None
        raise OpenAlexUnavailable(f'OpenAlex returned HTTP {exc.code}; retry or use a cached founder.') from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise OpenAlexUnavailable('OpenAlex could not be reached; retry or use a cached founder.') from None
    if not isinstance(data, dict) or data.get('error'):
        raise OpenAlexUnavailable('OpenAlex returned an error; retry or use a cached founder.')
    write(path, data)
    return data


def _seed_works(aid):
    """Reuse intake evidence read-only when list queries have exhausted their budget."""
    works = {}
    directory = ROOT / 'data/cache/jakob/founders'
    for path in sorted(directory.glob('*.json')):
        try:
            for work in json.loads(path.read_text()).get('works', []):
                if any(((a.get('author') or {}).get('id') or '').endswith('/' + aid)
                       for a in work.get('authorships', [])):
                    works[work['id']] = work
        except (ValueError, KeyError, OSError):
            continue
    seed = CACHE / aid / 'seed.json'
    if seed.exists():
        for wid in json.loads(seed.read_text()).get('work_ids', [])[:10]:
            work = request('works/' + wid)
            if any((a.get('author') or {}).get('id') == 'https://openalex.org/' + aid
                   for a in work.get('authorships', [])):
                works[work['id']] = work
    return list(works.values())


def _works(aid, sort='publication_date:desc', pages=1):
    works = []
    for page in range(1, pages + 1):
        result = request('works', {'filter': 'author.id:' + aid, 'sort': sort, 'page': page,
                                  'per-page': 25, 'select': 'id,title,publication_date,authorships,topics,referenced_works'})
        works.extend(result.get('results', []))
        if len(result.get('results', [])) < 25:
            break
    return works


def pull_founder(openalex_author_id, advisor_id=None):
    """Pull up to 50 recent + 25 cited works, 30 coauthors, and bounded expansion.

    advisor_id requires an independently verified advisor.json in the founder cache;
    neither coauthorship nor author order is taken as proof of supervision.
    All truncation, partial pulls, and budget fallback are recorded in dataset.json.
    """
    aid = author_id(openalex_author_id)
    directory = CACHE / aid
    existing = directory / 'dataset.json'
    if existing.exists():
        return
    with _LOCK:
        if existing.exists():
            return
        observed = datetime.now(timezone.utc).isoformat()
        warnings = []
        founder = request('authors/' + aid)
        budget_blocked = False
        works = _seed_works(aid)
        try:
            works += _works(aid, pages=2)
            works += _works(aid, sort='cited_by_count:desc')
        except OpenAlexUnavailable as exc:
            budget_blocked = True
            warnings.append(str(exc))
        works = list({w['id']: w for w in works}.values())
        if not works:
            raise OpenAlexUnavailable('No cached publication evidence for ' + aid + '. ' +
                                     (warnings[-1] if warnings else 'OpenAlex returned no works.'))
        # Prefer repeated collaborators, then stable IDs. Large team papers are bounded.
        counts = Counter(a['author']['id'] for w in works for a in w.get('authorships', [])
                         if a.get('author', {}).get('id') and a['author']['id'] != founder['id'])
        selected = [a for a, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:30]]
        profiles, coauthor_works = {}, []
        for coauthor in selected:
            try:
                profile = request('authors/' + author_id(coauthor))
                profiles[coauthor] = profile
                if not budget_blocked and any(a['institution'].get('type') == 'company'
                                              for a in profile.get('affiliations', [])):
                    coauthor_works += _works(author_id(coauthor))
            except OpenAlexUnavailable as exc:
                if str(exc) not in warnings:
                    warnings.append(str(exc))
                budget_blocked = True
        citing_works = []
        if not budget_blocked:
            try:
                # One bounded query, not one query per publication.
                ids = '|'.join(w['id'].rsplit('/', 1)[-1] for w in works[:3])
                citing_works = request('works', {'filter': 'cites:' + ids, 'page': 1, 'per-page': 25,
                                                'sort': 'publication_date:desc'})['results']
            except OpenAlexUnavailable as exc:
                warnings.append(str(exc))
        advisor = None
        advisor_file = directory / 'advisor.json'
        advisor_works = []
        if advisor_file.exists():
            advisor = json.loads(advisor_file.read_text())
            # Verified source + quote are required; don't invent a PhD advisor from a paper.
            if not advisor.get('source_url') or not advisor.get('quote'):
                raise ValueError('advisor.json requires a source_url and verbatim quote')
            advisor_id = advisor['openalex_id']
        if advisor_id and not advisor:
            raise ValueError('Advisor expansion requires a sourced advisor.json')
        if advisor:
            try:
                advisor_works = [request('works/' + wid) for wid in advisor.get('work_ids', [])[:10]]
                advisor_works += _works(author_id(advisor_id))
            except OpenAlexUnavailable as exc:
                warnings.append('Advisor expansion: ' + str(exc))
        else:
            warnings.append('PhD advisor not independently resolved; no advisor relationship inferred.')
        write(existing, {'founder': founder, 'works': works, 'profiles': profiles,
                         'coauthor_works': coauthor_works, 'citing_works': citing_works,
                         'advisor': advisor, 'advisor_works': advisor_works, 'topic_works': [],
                         'observed_at': observed, 'cached': True, 'warnings': warnings,
                         'limits': {'founder_works': 75, 'coauthor_profiles': 30,
                                    'coauthors_found': len(counts), 'citing_works': 25},
                         'notes': 'Bounded publication sample, not an exhaustive relationship graph. '
                                  'Profile-only affiliations are unchecked and have low confidence.'})


def load_dataset(founder_id):
    aid = author_id(founder_id)
    path = CACHE / aid / 'dataset.json'
    if not path.exists():
        pull_founder(aid)
    return json.loads(path.read_text())


def resolve_founder(value):
    try:
        return 'person:openalex:' + author_id(value)
    except ValueError:
        # Same name/DOI resolution used by intake; no second identity heuristic.
        from ..jakob.icp import fetch_founder
        try:
            return fetch_founder(value).id
        except HTTPError as exc:
            if exc.code in (402, 403, 429):
                raise OpenAlexUnavailable('OpenAlex name resolution budget exhausted. Use a cached OpenAlex '
                                         'author ID, or set OPENALEX_API_KEY and retry intake.') from None
            raise OpenAlexUnavailable('OpenAlex founder resolution failed; use an author ID.') from None


if __name__ == '__main__':
    import sys
    for value in sys.argv[1:]:
        resolved = resolve_founder(value)
        pull_founder(resolved)
        data = load_dataset(resolved)
        print(json.dumps({'founder_id': resolved, 'name': data['founder']['display_name'],
                          'works': len(data['works']), 'profiles': len(data['profiles']),
                          'warnings': data['warnings']}, ensure_ascii=False))
