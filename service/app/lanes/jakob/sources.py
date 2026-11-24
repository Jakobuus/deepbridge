"""Read founder-supplied material as data for the interview briefing."""

import hashlib
import ipaddress
import json
import os
import re
import socket
import subprocess
import time
from html.parser import HTMLParser
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock
from typing import Literal
from urllib.error import HTTPError
from urllib.parse import quote, unquote, urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from pydantic import BaseModel, Field
from ...openalex import with_key

try:
    import httpx
except ModuleNotFoundError:
    httpx = None  # The base service has no httpx dependency.

SourceKind = Literal['paper', 'website', 'notes', 'notion', 'gdoc']
_HTTP_ERRORS = (OSError,) if httpx is None else (OSError, httpx.HTTPError, httpx.InvalidURL)
_CACHE = Path(__file__).resolve().parents[4] / 'data/cache/jakob/openalex'
_OPENALEX = 'https://api.openalex.org/'
_RATE_LOCK = Lock()
_last_request = 0.0
_DOI = re.compile(r'10\.\d{4,9}/[^\s?#]+', re.I)
_ARXIV = re.compile(r'(?:(?:https?://(?:www\.)?arxiv\.org/(?:abs|pdf|html)/)|arxiv:)?'
                    r'(\d{4}\.\d{4,5}|[a-z][a-z.\-]*/\d{7})(?:v\d+)?(?:\.pdf)?/?$', re.I)
_HEADERS = {'User-Agent': 'DeepBridge/0.1 (founder source reader)'}
_REDIRECTS = {301, 302, 303, 307, 308}


class SourceDoc(BaseModel):
    kind: SourceKind
    url: str | None
    title: str
    text: str
    source_date: str | None = Field(default=None, exclude=True)
    cached: bool = Field(default=False, exclude=True)


class SourceError(ValueError):
    """A source could not be read."""


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _public_url(url):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username is not None:
            raise ValueError
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
        addresses = socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
            raise ValueError
    except (ValueError, OSError) as exc:
        raise SourceError('Use a reachable public HTTP or HTTPS URL') from exc


def _get(url, *, headers=None, limit=2_000_000, public=False):
    """Return bounded response bytes, headers and final URL."""
    request_headers = {**_HEADERS, **(headers or {})}
    deadline = time.monotonic() + 10
    for _ in range(6):
        if public:
            _public_url(url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SourceError('Source request timed out')
        try:
            if httpx is not None:
                with httpx.stream('GET', with_key(url), headers=request_headers, timeout=remaining,
                                  follow_redirects=False) as response:
                    status, response_headers = response.status_code, response.headers
                    if status == 200:
                        body = bytearray()
                        for chunk in response.iter_bytes():
                            if time.monotonic() > deadline:
                                raise SourceError('Source request timed out')
                            body.extend(chunk[:limit - len(body)])
                            if len(body) >= limit:
                                break
                        return bytes(body), response_headers, url
            else:
                opener = build_opener(_NoRedirect())
                try:
                    response = opener.open(Request(with_key(url), headers=request_headers), timeout=remaining)
                except HTTPError as exc:
                    response = exc
                with response:
                    status, response_headers = response.status, response.headers
                    if status == 200:
                        body = bytearray()
                        while len(body) < limit:
                            if time.monotonic() > deadline:
                                raise SourceError('Source request timed out')
                            chunk = response.read1(min(65536, limit - len(body)))
                            if not chunk:
                                break
                            body.extend(chunk)
                        return bytes(body), response_headers, url
        except _HTTP_ERRORS as exc:
            raise SourceError('Source could not be reached') from exc

        location = response_headers.get('location')
        if status not in _REDIRECTS or not location or headers:
            raise SourceError(f'Source returned HTTP {status}')
        url = urljoin(url, location)
        if urlsplit(url).scheme not in ('http', 'https'):
            raise SourceError('Source redirect must use HTTP or HTTPS')
    raise SourceError('Too many source redirects')


class _HTML(HTMLParser):
    _skip = {'script', 'style', 'noscript', 'template', 'svg', 'head'}
    _break = {'address', 'article', 'br', 'div', 'footer', 'h1', 'h2', 'h3', 'h4', 'header',
              'li', 'main', 'nav', 'p', 'section', 'td', 'tr'}

    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.ignored = []
        self.in_title = False
        self.title_parts = []
        self.parts = []
        self.doi = None
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        if tag == 'title':
            self.in_title = True
        if tag == 'meta':
            attrs = dict(attrs)
            if (attrs.get('name') or attrs.get('property') or '').lower() in {'citation_doi', 'dc.identifier'}:
                self.doi = self.doi or _DOI.search(attrs.get('content') or '')
        if tag in self._skip:
            self.ignored.append(tag)
        if tag in self._break and not self.ignored:
            self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if self.ignored and tag == self.ignored[-1]:
            self.ignored.pop()
        if tag in self._break and not self.ignored:
            self.parts.append('\n')

    def handle_data(self, data):
        if self.in_title:
            self.title_parts.append(data)
        if not self.ignored and not self.in_title:
            self.parts.append(data)

    @property
    def title(self):
        return ' '.join(''.join(self.title_parts).split())

    @property
    def text(self):
        return '\n'.join(line for part in ''.join(self.parts).splitlines()
                         if (line := ' '.join(part.split())))


def _decode(body, headers):
    found = re.search(r'charset\s*=\s*["\']?([^\s;"\']+)', headers.get('content-type', ''), re.I)
    try:
        return body.decode(found[1] if found else 'utf-8-sig', errors='replace')
    except LookupError:
        return body.decode('utf-8-sig', errors='replace')


def _openalex(ref):
    global _last_request
    fields = 'id,doi,title,publication_date,abstract_inverted_index,open_access'
    url = _OPENALEX + 'works/' + quote(ref, safe=':/') + '?' + urlencode({'select': fields})
    path = _CACHE / (hashlib.sha256(url.encode()).hexdigest()[:24] + '.json')
    try:
        cached = json.loads(path.read_bytes())
        if cached.get('id') and cached.get('title'):
            return cached, True
    except (OSError, ValueError, AttributeError):
        pass
    with _RATE_LOCK:
        time.sleep(max(0, 0.205 - (time.monotonic() - _last_request)))
        _last_request = time.monotonic()
        body, _, _ = _get(url)
    work = json.loads(body)
    if not isinstance(work, dict) or not work.get('id') or not work.get('title'):
        raise SourceError('OpenAlex returned no usable work')
    try:
        _CACHE.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=_CACHE, delete=False) as output:
            output.write(body)
        Path(output.name).replace(path)
    except OSError:
        pass
    return work, False


def _paper_ref(value):
    value = unquote(value.strip()).split('#', 1)[0].split('?', 1)[0]
    if match := _DOI.search(value):
        return 'https://doi.org/' + match[0].rstrip('.,;)')
    if match := _ARXIV.fullmatch(value):
        return 'https://doi.org/10.48550/arXiv.' + match[1]
    if re.fullmatch(r'(?:https?://(?:api\.)?openalex\.org/(?:works/)?)?W\d+/?', value, re.I):
        return value.rstrip('/').rsplit('/', 1)[-1].upper()
    parsed = urlsplit(value)
    if parsed.hostname in {'nature.com', 'www.nature.com'}:
        slug = re.fullmatch(r'/articles/([\w.\-]+?)(?:\.pdf)?/?', parsed.path, re.ASCII)
        if slug:
            return 'https://doi.org/10.1038/' + slug[1]
    body, headers, resolved = _get(value, public=True)
    match = _DOI.search(unquote(urlsplit(resolved).path)) or _HTML(_decode(body, headers)).doi
    if match:
        return 'https://doi.org/' + match[0].rstrip('.,;)')
    raise SourceError('No DOI found on the paper page')


def _paper_full_text(url):
    body, headers, final_url = _get(url, limit=15_000_000, public=True)
    content_type = headers.get('content-type', '').lower()
    if body.startswith(b'%PDF-') or 'application/pdf' in content_type:
        result = subprocess.run(['pdftotext', '-l', '20', '-', '-'], input=body, capture_output=True,
                                check=True, timeout=10)
        text = result.stdout.decode('utf-8', errors='replace')
    elif 'html' in content_type or body.lstrip().startswith(b'<'):
        text = _HTML(_decode(body, headers)).text
    elif 'text/plain' in content_type:
        text = _decode(body, headers)
    else:
        text = ''
    return ' '.join(text.split())[:15_000], final_url


def read_paper(value, on_title=None) -> SourceDoc:
    work, cached = _openalex(_paper_ref(value))
    title = work['title']
    if on_title:
        on_title(title, cached)
    words = sorted((pos, word) for word, positions in (work.get('abstract_inverted_index') or {}).items()
                   for pos in positions)
    abstract = ' '.join(word for _, word in words)
    url = work.get('doi') or work['id']
    full_text = ''
    if oa_url := (work.get('open_access') or {}).get('oa_url'):
        try:
            full_text, final_url = _paper_full_text(oa_url)
            if full_text:
                url = final_url
        except (OSError, SourceError, subprocess.SubprocessError):
            pass  # OpenAlex metadata and abstract remain usable without a full-text copy.
    return SourceDoc(kind='paper', url=url, title=title, text='\n\n'.join(filter(None, (title, abstract, full_text))),
                     source_date=work.get('publication_date'), cached=cached)


def read_website(url) -> SourceDoc:
    body, headers, final_url = _get(url.strip(), public=True)
    content = _decode(body, headers)
    page = _HTML(content)
    text = ' '.join(content.split()) if 'text/plain' in headers.get('content-type', '') else page.text
    if not text:
        raise SourceError('Website returned no readable text')
    return SourceDoc(kind='website', url=final_url, title=page.title or urlsplit(final_url).hostname, text=text[:10_000])


def read_gdoc(url) -> SourceDoc:
    parsed = urlsplit(url.strip())
    match = re.match(r'^/document/(?:u/\d+/)?d/([\w-]+)(?:/|$)', parsed.path)
    if parsed.hostname != 'docs.google.com' or not match:
        raise SourceError('Use a Google Docs document sharing link')
    canonical = 'https://docs.google.com/document/d/' + match[1]
    try:
        body, headers, final_url = _get(canonical + '/export?format=txt', limit=150_000, public=True)
    except SourceError as exc:
        raise SourceError('Google Doc export failed. The document must be publicly readable.') from exc
    text = _decode(body, headers).strip()
    if (not text or urlsplit(final_url).hostname == 'accounts.google.com'
            or 'text/html' in headers.get('content-type', '')):
        raise SourceError('Google Doc export requires a publicly readable document')
    return SourceDoc(kind='gdoc', url=canonical + '/edit', title=text.splitlines()[0][:160], text=text[:15_000])


def _rich_text(items):
    return ''.join(item.get('plain_text', item.get('text', {}).get('content', '')) for item in items)


def read_notion(url) -> SourceDoc:
    page_id = re.search(r'([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$',
                        unquote(urlsplit(url.strip()).path).rstrip('/'), re.I)
    if not page_id:
        raise SourceError('Notion link must end with the page ID')
    token = os.environ.get('NOTION_TOKEN')
    if not token:
        raise SourceError('NOTION_TOKEN is required to read Notion pages')
    headers = {'Authorization': 'Bearer ' + token, 'Notion-Version': '2022-06-28'}
    page_id = page_id[1].replace('-', '')

    def notion_get(path):
        body, _, _ = _get('https://api.notion.com/v1/' + path, headers=headers)
        return json.loads(body)

    try:
        page = notion_get('pages/' + page_id)
        title = next((_rich_text(prop.get('title', [])) for prop in page.get('properties', {}).values()
                      if prop.get('type') == 'title'), '') or 'Notion page'
        lines = []
        size = 0

        def walk(block_id, depth=0):
            nonlocal size
            cursor = None
            while size < 15_000:
                params = {'start_cursor': cursor} if cursor else {}
                result = notion_get(f'blocks/{block_id}/children?' + urlencode(params))
                for block in result['results']:
                    kind = block['type']
                    value = block.get(kind, {})
                    text = _rich_text(value.get('rich_text', [])) or value.get('title', '')
                    if not text and kind == 'table_row':
                        text = ' | '.join(_rich_text(cell) for cell in value.get('cells', []))
                    prefix = {'heading_1': '# ', 'heading_2': '## ', 'heading_3': '### ',
                              'bulleted_list_item': '- ', 'numbered_list_item': '1. ',
                              'to_do': '- [x] ' if value.get('checked') else '- [ ] ',
                              'quote': '> '}.get(kind, '')
                    if text:
                        line = '  ' * depth + prefix + text
                        lines.append(line)
                        size += len(line) + 1
                    if size >= 15_000:
                        return
                    if block.get('has_children') and depth < 20:
                        child_id = block['id']
                        if re.fullmatch(r'[0-9a-f-]{32,36}', child_id, re.I):
                            walk(child_id, depth + 1)
                cursor = result.get('next_cursor')
                if not result.get('has_more') or not cursor:
                    break

        walk(page_id)
    except (SourceError, ValueError, KeyError) as exc:
        raise SourceError('Could not read the Notion page. Check the integration token and page access.') from exc
    return SourceDoc(kind='notion', url=page.get('url') or 'https://www.notion.so/' + page_id,
                     title=title, text=('\n'.join([title, *lines]))[:15_000])
