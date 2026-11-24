import re
from email.utils import collapse_rfc2231_value
from urllib.parse import parse_qs, urlsplit

from .base import FetchedItem, SetupRequired, SourceUnavailable, json_object, read

API = "https://www.googleapis.com/drive/v3"
DOC_MIME = "application/vnd.google-apps.document"
FILE_ID = r"[A-Za-z0-9_-]+"


def file_id_from_url(url: str) -> tuple[str, bool]:
    parsed = urlsplit(url)
    if parsed.scheme == "https" and parsed.hostname == "docs.google.com":
        match = re.match(
            rf"^/(document|spreadsheets|presentation|drawings|forms)/(?:u/\d+/)?d/({FILE_ID})(?:/|$)",
            parsed.path,
        )
        if match and not (match[2] == "e" and "/d/e/" in parsed.path):
            return match[2], match[1] == "document"
    if parsed.scheme == "https" and parsed.hostname == "drive.google.com":
        match = re.match(rf"^/file/(?:u/\d+/)?d/({FILE_ID})(?:/|$)", parsed.path)
        if match:
            return match[1], False
        if parsed.path.rstrip("/") == "/open":
            file_id = parse_qs(parsed.query).get("id", [""])[0]
            if re.fullmatch(FILE_ID, file_id):
                return file_id, False
    raise ValueError("Use a Google Docs or Drive file URL.")


def _access_token(path: str) -> str:
    try:
        from google.auth.exceptions import GoogleAuthError
        from google.auth.transport.requests import Request
        from google.oauth2.service_account import Credentials
    except ImportError:
        raise SetupRequired("Start the service with google-auth[requests] to use GDRIVE_SA_FILE.") from None

    try:
        credentials = Credentials.from_service_account_file(
            path, scopes=["https://www.googleapis.com/auth/drive.readonly"]
        )
        credentials.refresh(Request())
    except (OSError, ValueError, GoogleAuthError):
        raise SetupRequired("Check GDRIVE_SA_FILE and its service account credentials.") from None
    return credentials.token


class DriveSource:
    def __init__(self, service_account_file: str | None):
        self.service_account_file = service_account_file

    def fetch_item(self, external_id: str) -> FetchedItem:
        if not re.fullmatch(FILE_ID, external_id):
            raise ValueError("Invalid Drive file ID.")
        if not self.service_account_file:
            return self._public_doc(external_id)

        headers = {"Authorization": f"Bearer {_access_token(self.service_account_file)}"}
        path = f"{API}/files/{external_id}"
        body, _ = read(path, headers=headers, params={
            "fields": "name,mimeType,webViewLink,trashed", "supportsAllDrives": "true",
        })
        file = json_object(body)
        if file.get("trashed"):
            raise SourceUnavailable("The Drive file is in the trash.", status=404)

        mime = file.get("mimeType")
        if mime == DOC_MIME:
            body, _ = read(f"{path}/export", headers=headers, params={"mimeType": "text/plain"})
            text = body.decode("utf-8-sig", errors="replace")
        elif mime in ("text/plain", "text/markdown", "text/x-markdown"):
            body, _ = read(path, headers=headers, params={"alt": "media", "supportsAllDrives": "true"})
            text = body.decode("utf-8-sig", errors="replace")
        else:
            text = f"Unsupported file type: {mime or 'unknown'}"

        url = file.get("webViewLink") or (
            f"https://docs.google.com/document/d/{external_id}/edit" if mime == DOC_MIME
            else f"https://drive.google.com/file/d/{external_id}/view"
        )
        return FetchedItem(file.get("name") or "Untitled", url, text)

    def _public_doc(self, external_id: str) -> FetchedItem:
        url = f"https://docs.google.com/document/d/{external_id}"
        body, headers = read(f"{url}/export", params={"format": "txt"}, public_export=True)
        if headers.get_content_type() != "text/plain":
            raise SourceUnavailable("Google Docs did not return plain text.")
        filenames = [
            collapse_rfc2231_value(value) for key, value in
            headers.get_params(header="Content-Disposition", failobj=[])
            if key == "filename"
        ]
        title = filenames[-1].removesuffix(".txt") if filenames else ""
        return FetchedItem(title or "Google Doc", f"{url}/edit", body.decode("utf-8-sig", errors="replace"))
