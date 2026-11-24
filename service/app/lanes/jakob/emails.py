"""Rank email patterns using domains supplied by organization evidence."""
import re
from collections.abc import Iterable
from unicodedata import normalize
from urllib.parse import urlsplit

_DOMAIN = re.compile(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\Z')
_LEGAL_SUFFIXES = {'ag', 'corp', 'corporation', 'gmbh', 'inc', 'incorporated', 'limited', 'llc', 'ltd', 'plc'}
_CONNECTORS = {'and', 'for', 'of', 'the'}
_COUNTRY_SUFFIXES = {'ac', 'co', 'com', 'edu', 'gov', 'net', 'org'}


def _ascii(text: str) -> str:
    text = text.casefold().translate(str.maketrans({'ä': 'ae', 'ö': 'oe', 'ü': 'ue'}))
    return normalize('NFKD', text).encode('ascii', 'ignore').decode()


def email_candidates(first: str, last: str, domain: str) -> list[str]:
    """Return deduplicated common patterns, with first.last ranked highest."""
    first = re.sub(r'[^a-z0-9]', '', _ascii(first))
    last = re.sub(r'[^a-z0-9]', '', _ascii(last))
    domain = domain.strip().lower().rstrip('.')
    if not first or not last or len(first) + len(last) >= 64 or not _DOMAIN.fullmatch(domain):
        return []
    local_parts = (
        f'{first}.{last}', f'{first[0]}.{last}', f'{first[0]}{last}',
        f'{first}_{last}', f'{first}{last}', first, last, f'{first[0]}.{last[0]}',
    )
    return [f'{local}@{domain}' for local in dict.fromkeys(local_parts)]


def company_domain(org_name: str, evidence_urls: Iterable[str]) -> str | None:
    """Use a website or profile host that matches the organization's name."""
    words = re.findall(r'[a-z0-9]+', _ascii(org_name))
    while words and words[-1] in _LEGAL_SUFFIXES:
        words.pop()
    significant = [word for word in words if word not in _CONNECTORS]
    if not significant:
        return None
    aliases = {''.join(words), ''.join(significant)}
    if len(significant) > 1:
        aliases.add(''.join(word[0] for word in significant))

    for url in evidence_urls:
        try:
            parsed = urlsplit(url)
            host = (parsed.hostname or '').rstrip('.')
        except ValueError:
            continue
        if parsed.scheme not in ('http', 'https') or parsed.username is not None:
            continue
        if not _DOMAIN.fullmatch(host):
            continue
        labels = host.split('.')
        root_size = 2
        if len(labels[-1]) == 2 and labels[-2] in _COUNTRY_SUFFIXES:
            root_size = 3
        if len(labels) >= root_size and labels[-root_size].replace('-', '') in aliases:
            return '.'.join(labels[-root_size:])
    return None
