# Notion and Google Drive connectors

`GET /connectors` lists both connectors with their setup instructions. `connected` means the corresponding environment variable is set. A public Google Doc can be fetched while Google Drive shows `connected: false`.

Send `{"url":"<page or file URL>"}` to `POST /connectors/notion/fetch` or `POST /connectors/gdrive/fetch`. Both return `title`, `url`, and `text` for the requested item. Missing setup returns HTTP 409 with instructions. Use this API on the local demo server or behind access controls. Anyone who can call it can request an item the configured integration can read.

- **Notion** — Set `NOTION_TOKEN` and give the integration access to the page in Notion. The connector reads the page and its nested blocks. Fetch linked child pages by their own URL.
- **Google Drive** — With `GDRIVE_SA_FILE` unset, use a regular Google Docs link with public viewing and downloads enabled. For private Docs and Drive files, enable the Drive API, share the file with the service account, and set `GDRIVE_SA_FILE` to the path of its JSON key. From `service/`, start with `uv run --with 'google-auth[requests]' uvicorn app.main:app --port 8000`. Google Docs export as plain text. Plain text and Markdown files are downloaded as text. Other file types return an unsupported-type note in `text`. [Drive download and export documentation](https://developers.google.com/workspace/drive/api/guides/manage-downloads)
