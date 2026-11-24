import re
from collections.abc import Iterator
from urllib.parse import urlsplit

from .base import FetchedItem, SourceUnavailable, json_object, read

API = "https://api.notion.com/v1"
PAGE_ID = r"[0-9a-fA-F]{8}(?:-?[0-9a-fA-F]{4}){3}-?[0-9a-fA-F]{12}"
PREFIXES = {
    "heading_1": "# ", "heading_2": "## ", "heading_3": "### ",
    "bulleted_list_item": "- ", "numbered_list_item": "1. ", "quote": "> ",
}


def page_id_from_url(url: str) -> str:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    if parsed.scheme != "https" or not (
        host in ("notion.so", "notion.site") or host.endswith((".notion.so", ".notion.site"))
    ):
        raise ValueError("Use a Notion page URL.")
    slug = parsed.path.rstrip("/").rsplit("/", 1)[-1]
    match = re.search(rf"(?:^|-)({PAGE_ID})$", slug)
    if not match:
        raise ValueError("The Notion URL must contain a page ID.")
    return match[1]


def _plain(parts: list | None) -> str:
    return "".join(part.get("plain_text", "") for part in parts or [])


class NotionSource:
    def __init__(self, token: str):
        self.headers = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"}

    def _get(self, path: str, params: dict[str, str] | None = None) -> dict:
        body, _ = read(API + path, headers=self.headers, params=params)
        return json_object(body)

    def fetch_item(self, external_id: str) -> FetchedItem:
        if not re.fullmatch(PAGE_ID, external_id):
            raise ValueError("Invalid Notion page ID.")
        page_id = external_id.replace("-", "").lower()
        page = self._get(f"/pages/{page_id}")
        if page.get("archived") or page.get("in_trash"):
            raise SourceUnavailable("The Notion page is archived or trashed.", status=404)

        title = next(
            (_plain(prop.get("title")) for prop in (page.get("properties") or {}).values()
             if prop.get("type") == "title"),
            "",
        )
        url = page.get("url") or f"https://www.notion.so/{page_id}"
        return FetchedItem(title or "Untitled", url, "\n".join(self._blocks(page_id)))

    def _blocks(self, block_id: str, depth: int = 0) -> Iterator[str]:
        params = {"page_size": "100"}
        while True:
            data = self._get(f"/blocks/{block_id}/children", params)
            for block in data.get("results", []):
                kind = block.get("type", "")
                if kind in ("child_page", "child_database"):
                    continue
                body = block.get(kind) or {}
                text = _plain(body.get("rich_text"))
                if kind == "table_row":
                    text = " | ".join(_plain(cell) for cell in body.get("cells", []))
                prefix = PREFIXES.get(kind, "")
                if kind == "to_do":
                    prefix = "[x] " if body.get("checked") else "[ ] "
                if text:
                    yield f"{'  ' * depth}{prefix}{text}"
                if block.get("has_children"):
                    yield from self._blocks(block["id"], depth + 1)
            cursor = data.get("next_cursor")
            if not data.get("has_more") or not cursor:
                return
            params["start_cursor"] = cursor
