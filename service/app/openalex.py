"""Add the OpenAlex API key at send time only, so it never lands in cache keys or evidence URLs."""
import os
from urllib.parse import urlencode


def with_key(url: str) -> str:
    key = os.getenv('OPENALEX_API_KEY')
    if not key or 'api.openalex.org' not in url:
        return url
    return url + ('&' if '?' in url else '?') + urlencode({'api_key': key})
