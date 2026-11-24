import json
from dataclasses import dataclass
from email.message import Message
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


@dataclass(frozen=True)
class FetchedItem:
    title: str
    url: str
    text: str


class SourceUnavailable(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None):
        super().__init__(message)
        self.status = status


class SetupRequired(RuntimeError):
    pass


class _ProviderRedirect(HTTPRedirectHandler):
    def __init__(self, public_export: bool):
        self.public_export = public_export

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if self.public_export:
            target = urlsplit(newurl)
            host = target.hostname or ""
            if target.scheme == "https" and (
                host == "docs.google.com" or host.endswith(".googleusercontent.com")
            ):
                return super().redirect_request(req, fp, code, msg, headers, newurl)
        return None


def read(
    url: str, *, headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None, public_export: bool = False,
) -> tuple[bytes, Message]:
    if params:
        url = f"{url}?{urlencode(params)}"
    request = Request(url, headers=headers or {})
    try:
        with build_opener(_ProviderRedirect(public_export)).open(request, timeout=15) as response:
            return response.read(), response.headers
    except HTTPError as error:
        error.close()
        if public_export and 300 <= error.code < 400:
            target = urlsplit(error.headers.get("Location", ""))
            if target.hostname == "accounts.google.com":
                raise SourceUnavailable("Google Docs requires sign-in.", status=403) from None
        raise SourceUnavailable("Provider request failed.", status=error.code) from None
    except (URLError, OSError, HTTPException, ValueError):
        raise SourceUnavailable("Could not read from the provider.") from None


def json_object(body: bytes) -> dict:
    try:
        data = json.loads(body)
    except ValueError:
        raise SourceUnavailable("Provider returned unreadable JSON.") from None
    if not isinstance(data, dict):
        raise SourceUnavailable("Provider returned an unexpected JSON response.")
    return data
