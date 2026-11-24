"""Moss browser Tasks contact resolution; never asks Moss for emails or phones.

Credentials are read only from the process environment. Run this module to warm the
three highest-scoring Lightmatter bridge contacts. No messages are sent.
"""
import asyncio
import hashlib
import json
import logging
import os
import re
from datetime import date
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from ...models import Contact, Evidence, Person, Profile
from ...store import now, store
from .emails import company_domain, email_candidates

CACHE_PATH = Path(__file__).resolve().parents[4] / 'fixtures' / 'contacts.json'
MOSS_BASE = 'https://inference.moss.dev/v1'
POLL_SECONDS = 2
log = logging.getLogger(__name__)


class ContactResolutionError(RuntimeError):
    pass


def _read_cache():
    if not CACHE_PATH.exists():
        return {'_meta': {'cached': True, 'tasks': {}}, 'items': [], 'evidence': []}
    return json.loads(CACHE_PATH.read_text())


def _mask_email(email: str | None) -> str | None:
    if not email:
        return None
    local, _, domain = email.rpartition('@')
    return f'{local[0]}***@{domain}' if local and domain and '@' not in local else None


def _public_evidence(evidence: Evidence) -> Evidence:
    # Older Hunter fixtures stored the address alongside the provider status.
    if evidence.id.startswith('evidence:hunter:') and evidence.quote.startswith('email: '):
        _, _, status = evidence.quote.partition('; verification.status: ')
        return evidence.model_copy(update={'quote': f'verification.status: {status}' if status else 'Email finder result'})
    return evidence


def _with_pattern(contact: Contact, person: Person, evidence: list[Evidence]) -> Contact:
    if os.getenv('HUNTER_API_KEY') or contact.email or not contact.current_org:
        return contact
    names = person.name.split()
    if len(names) < 2:
        return contact
    supplemental = store.evidence.get(f'evidence:contact-domain:{person.id}')
    if supplemental is not None:
        evidence = [*evidence, supplemental]
    for source in evidence:
        domain = company_domain(contact.current_org, [source.source_url])
        if domain is None:
            continue
        candidates = email_candidates(names[0], names[-1], domain)
        if not candidates:
            return contact
        reason = f'pattern first.last@{domain}; domain from {source.source_url}'
        return contact.model_copy(update={
            'email': _mask_email(candidates[0]),
            'email_status': 'guessed',
            'assessment': f'{contact.assessment} {reason}' if contact.assessment else reason,
            'source': 'cache' if contact.source == 'cache' else 'pattern',
            'evidence_ids': list(dict.fromkeys([*contact.evidence_ids, source.id])),
        })
    return contact


def cached_contact(person_id: str) -> Contact | None:
    """Replay evidence alongside contacts so /evidence/{id} works after restart."""
    data = _read_cache()
    for item in data.get('items', []):
        if item['person_id'] == person_id:
            contact = Contact.model_validate(item)
            evidence = [_public_evidence(Evidence.model_validate(e)) for e in data.get('evidence', [])]
            with store.lock:
                store.evidence.update({e.id: e for e in evidence})
                if not all(e in store.evidence for e in contact.evidence_ids):
                    raise ContactResolutionError('Cached contact evidence is missing')
                sources = [store.evidence[eid] for eid in contact.evidence_ids]
                person = store.people.get(person_id)
            masked = _mask_email(contact.email)
            assessment = contact.assessment
            if assessment and contact.email and masked:
                assessment = assessment.replace(contact.email, masked)
            contact = contact.model_copy(update={
                'source': 'cache', 'email': masked, 'assessment': assessment,
                'email_status': contact.email_status if masked else 'none',
            })
            return _with_pattern(contact, person, sources) if person else contact
    return None


def _save(contact: Contact, evidence: list[Evidence], task: dict):
    # Keep this lane's new evidence in its own fixture, avoiding concurrent edits
    # to the shared evidence fixture. Existing evidence is never removed.
    with store.lock:
        data = _read_cache()
        items = {c['person_id']: c for c in data.get('items', [])}
        items[contact.person_id] = contact.model_dump()
        data['items'] = list(items.values())
        existing = {e['id']: e for e in data.get('evidence', [])}
        existing.update({e.id: e.model_dump() for e in evidence})
        data['evidence'] = list(existing.values())
        meta = data.setdefault('_meta', {})
        meta.update(cached=True, observed_at=now())
        meta.setdefault('tasks', {})[contact.person_id] = {
            'id': task['id'], 'status': task['status'], 'verification_passed': True,
            'cost_usd': task.get('usage', {}).get('cost', {}).get('total_usd'),
        }
        meta['live_run'] = 'Verified Moss Tasks results cached for replay.'
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = CACHE_PATH.with_suffix('.json.tmp')
        temporary.write_text(json.dumps(data, indent=2) + '\n')
        temporary.replace(CACHE_PATH)
        store.evidence.update({e.id: e for e in evidence})


async def _request_json(method, url, *, headers=None, body=None, params=None):
    """stdlib HTTP in a thread keeps polling from blocking FastAPI's event loop."""
    if params:
        url += '?' + urlencode(params)
    def request():
        req = Request(url, method=method, headers=headers or {},
                      data=json.dumps(body).encode() if body is not None else None)
        try:
            with urlopen(req, timeout=15) as response:
                return json.load(response)
        except HTTPError as exc:
            # Do not expose request headers, query credentials, or response text.
            if exc.code == 403 and 'inference.moss.dev' in url:
                try:
                    error = json.loads(exc.read()).get('error', {})
                    code = error.get('code') if isinstance(error, dict) else error
                except (ValueError, AttributeError):
                    code = None
                if code == 'tasks_not_enabled':
                    raise ContactResolutionError('Moss Tasks access denied: tasks_not_enabled') from None
                raise ContactResolutionError('Moss Tasks access denied: HTTP 403') from None
            raise ContactResolutionError(f'Contact provider HTTP {exc.code}') from None
    return await asyncio.to_thread(request)


def _http_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in ('https', 'http') or not parsed.hostname or parsed.username or parsed.password:
        raise ContactResolutionError('Invalid profile URL')
    return url


def _schema():
    nullable = {'type': ['string', 'null']}
    properties = {key: nullable for key in ('current_role', 'current_org', 'asof', 'assessment', 'current_org_domain')}
    properties['profiles'] = {'type': 'array', 'items': {
        'type': 'object', 'additionalProperties': False,
        'properties': {'kind': {'type': 'string', 'enum': ['linkedin', 'homepage', 'scholar', 'orcid', 'github', 'other']},
                       'url': {'type': 'string'}, 'quote': {'type': 'string', 'minLength': 1}},
        'required': ['kind', 'url', 'quote']}}
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}


def _goal(person, evidence):
    # Use only evidence connected to this person, supplied by the router.
    context = '\n'.join(f'{e.source_date or "date unknown"}: {e.quote} ({e.source_url})' for e in evidence)
    return (f'Find the current employer and role of {person.name}, who published the papers '
            f'identified in this dated evidence, with the affiliations stated there:\n{context or "No paper evidence available; disambiguate identity carefully."}\n'
            f'Known author identifier: {person.openalex_id}; ORCID: {person.orcid}. '
            f'Assess their work on {", ".join(store.founder.topics)} in one sentence. '
            'Check the paper title and year at the linked source before matching the person. '
            'Return current_role, current_org, asof (source date YYYY-MM-DD or null), profiles, '
            'assessment, and current_org_domain (official employer domain, or null). '
            'For each profile supply its kind, public URL and a verbatim quote. Quotes must support '
            'the returned employment and research claims. Use null for unsupported claims. '
            'Publication affiliation alone does not establish current employment. '
            'Never look up or return personal emails, phone numbers, or contact details. '
            'Do not send messages or submit forms. Return only JSON matching the schema.')


async def _hunter(person, domain):
    key = os.getenv('HUNTER_API_KEY')
    if not key or not domain or not re.fullmatch(r'[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', domain):
        return None, 'none', None
    try:
        response = await _request_json('GET', 'https://api.hunter.io/v2/email-finder',
            headers={'Authorization': f'Bearer {key}'},
            params={'domain': domain, 'full_name': person.name, 'max_duration': 10})
        data = response['data']
        email = data.get('email')
        status = (data.get('verification') or {}).get('status')
        if (not isinstance(email, str) or email.count('@') != 1 or email.rsplit('@', 1)[-1].lower() != domain.lower()
                or status in ('invalid', 'disposable', 'webmail')):
            return None, 'none', None
        return email, 'verified' if status == 'valid' else 'guessed', status
    except Exception:
        log.warning('Hunter lookup unavailable; contact retained without email')
        return None, 'none', None


async def resolve_contact(person: Person, evidence: list[Evidence]) -> Contact:
    """Resolve with Moss or dated affiliation evidence. Cache completed Moss tasks."""
    project, key = os.getenv('MOSS_PROJECT_ID'), os.getenv('MOSS_PROJECT_KEY')
    if not project or not key:
        if not os.getenv('HUNTER_API_KEY'):
            cached = cached_contact(person.id)
            if cached is not None:
                return cached
            org = store.orgs.get(person.org_id)
            affiliation = Contact(
                person_id=person.id, current_role=person.role, current_org=org.name if org else None,
                current_asof=person.affiliation_asof, email=None, email_status='none', profiles=[],
                assessment='Cached affiliation only; current employment not verified.',
                source='cache', evidence_ids=[source.id for source in evidence],
            )
            contact = _with_pattern(affiliation, person, evidence)
            if contact.email:
                return contact
        raise ContactResolutionError('Moss key pending: set MOSS_PROJECT_ID and MOSS_PROJECT_KEY')
    async with asyncio.timeout(120):
        headers = {'Authorization': f'Bearer {project}:{key}', 'Content-Type': 'application/json'}
        task = await _request_json('POST', f'{MOSS_BASE}/tasks', headers=headers, body={
            'goal': _goal(person, evidence), 'environment': {'type': 'browser'},
            'model': 'moss-fast', 'output_schema': _schema(),
            'limits': {'max_runtime_seconds': 120, 'max_cost_usd': 0.5}})
        task_id = task['id']
        if not re.fullmatch(r'[A-Za-z0-9_-]+', task_id):
            raise ContactResolutionError('Invalid Moss task id')
        while task.get('status') in ('queued', 'running'):
            await asyncio.sleep(POLL_SECONDS)
            task = await _request_json('GET', f'{MOSS_BASE}/tasks/{task_id}', headers=headers)
        if task.get('status') != 'completed' or task.get('verification', {}).get('passed') is not True:
            raise ContactResolutionError('Moss task failed or output was not verified')
        output = task['result']['output']
        asof = output['asof']
        if asof is not None:
            date.fromisoformat(asof)
        profiles, sources = [], []
        for p in output['profiles']:
            profile = Profile(kind=p['kind'], url=_http_url(p['url']))
            quote = p['quote'].strip()
            if not quote:
                raise ContactResolutionError('Profile source quote missing')
            identifier = hashlib.sha256(f'{task_id}:{person.id}:{profile.url}:{quote}'.encode()).hexdigest()[:20]
            sources.append(Evidence(id=f'evidence:moss:{identifier}', source_url=profile.url,
                quote=quote, source_date=asof, observed_at=now(), kind='web'))
            profiles.append(profile)
        if not sources and any(output.get(k) for k in ('current_role', 'current_org', 'assessment')):
            raise ContactResolutionError('Moss claims lack source evidence')
        email, email_status, hunter_status = await _hunter(person, output.get('current_org_domain') if output.get('current_org') else None)
        if email:
            # Public provider endpoint, without credentials or the email in its URL.
            identifier = hashlib.sha256(f'{task_id}:{person.id}:{email}:{email_status}'.encode()).hexdigest()[:20]
            sources.append(Evidence(id=f'evidence:hunter:{identifier}',
                source_url='https://api.hunter.io/v2/email-finder',
                quote=f'verification.status: {hunter_status}',
                source_date=None, observed_at=now(), kind='web'))
        contact = Contact(person_id=person.id, current_role=output['current_role'],
            current_org=output['current_org'], current_asof=asof, profiles=profiles,
            assessment=output['assessment'], source='moss_task', evidence_ids=[e.id for e in sources],
            email=_mask_email(email), email_status=email_status)
        contact = _with_pattern(contact, person, [*sources, *evidence])
        _save(contact, sources, task)
        return contact


async def _warm():
    store.load()
    # Rank unique bridge people using the existing demo path scores.
    from ...routers.contacts import person_evidence
    seen = set()
    for path in sorted(store.paths.values(), key=lambda p: p.score, reverse=True):
        if path.bridge_id in seen:
            continue
        seen.add(path.bridge_id)
        try:
            result = await resolve_contact(store.people[path.bridge_id], person_evidence(path.bridge_id))
            print(result.model_dump_json())
        except Exception as exc:
            print(json.dumps({'person_id': path.bridge_id, 'live_run': 'failed', 'error_type': type(exc).__name__,
                              'reason': str(exc) if isinstance(exc, ContactResolutionError) else 'Provider response unavailable or invalid'}))
        if len(seen) == 3:
            break


if __name__ == '__main__':
    asyncio.run(_warm())
