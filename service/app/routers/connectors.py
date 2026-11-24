import os
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..connectors.base import FetchedItem, SetupRequired, SourceUnavailable
from ..connectors.gdrive import DriveSource, file_id_from_url
from ..connectors.notion import NotionSource, page_id_from_url

router = APIRouter(prefix="/connectors", tags=["connectors"])

NOTION_SETUP = "Set NOTION_TOKEN and give the integration access to the page."
GDRIVE_SETUP = "Set GDRIVE_SA_FILE and share the file with that service account, or use a public Google Docs link."


class ConnectorStatus(BaseModel):
    id: Literal["notion", "gdrive"]
    name: str
    connected: bool
    setup: str


class FetchRequest(BaseModel):
    url: str


@router.get("")
def list_connectors() -> list[ConnectorStatus]:
    return [
        ConnectorStatus(id="notion", name="Notion", connected=bool(os.getenv("NOTION_TOKEN")), setup=NOTION_SETUP),
        ConnectorStatus(id="gdrive", name="Google Drive", connected=bool(os.getenv("GDRIVE_SA_FILE")), setup=GDRIVE_SETUP),
    ]


@router.post("/{id}/fetch")
def fetch(id: str, payload: FetchRequest) -> FetchedItem:
    if id not in ("notion", "gdrive"):
        raise HTTPException(404, "Unknown connector.")

    setup = NOTION_SETUP if id == "notion" else GDRIVE_SETUP
    public_doc = False
    try:
        if id == "notion":
            token = os.getenv("NOTION_TOKEN")
            if not token:
                raise SetupRequired(setup)
            return NotionSource(token).fetch_item(page_id_from_url(payload.url))

        file_id, is_doc = file_id_from_url(payload.url)
        service_account_file = os.getenv("GDRIVE_SA_FILE")
        public_doc = not service_account_file and is_doc
        if not service_account_file and not public_doc:
            raise SetupRequired(setup)
        return DriveSource(service_account_file).fetch_item(file_id)
    except ValueError as error:
        raise HTTPException(422, str(error)) from None
    except SetupRequired as error:
        raise HTTPException(409, str(error)) from None
    except SourceUnavailable as error:
        if public_doc and error.status in (401, 403, 404):
            raise HTTPException(409, setup) from None
        if error.status in (401, 403):
            raise HTTPException(403, setup) from None
        if error.status == 404:
            raise HTTPException(404, "Item not found or inaccessible to the connector.") from None
        raise HTTPException(502, str(error)) from None
