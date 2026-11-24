"""Read paper text from a PDF URL or from PDF bytes."""

import json
import subprocess
import sys
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen

from pypdf import PdfReader
from pypdf.errors import PdfReadError

MAX_BYTES = 15 * 1024 * 1024
MAX_TEXT = 60_000
TIMEOUT = 20


def pdf_text(url_or_bytes: str | bytes) -> dict[str, str]:
    """Return a paper's title and text. Raise on size, timeout, or read errors."""
    command = [sys.executable, "-I", str(Path(__file__).resolve())]
    if isinstance(url_or_bytes, bytes):
        if len(url_or_bytes) > MAX_BYTES:
            raise ValueError("PDF exceeds the 15 MB size limit")
        data = url_or_bytes
    else:
        if urlsplit(url_or_bytes).scheme not in {"http", "https"}:
            raise ValueError("PDF URL must use HTTP or HTTPS")
        command.append(url_or_bytes)
        data = b""

    # Isolate parsing so the same deadline covers download and extraction.
    try:
        result = subprocess.run(command, input=data, capture_output=True, timeout=TIMEOUT)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(f"PDF download and extraction exceeded {TIMEOUT} seconds") from exc
    if result.returncode:
        errors = result.stderr.decode(errors="replace").strip().splitlines()
        raise ValueError(errors[-1] if errors else "PDF worker failed")
    return json.loads(result.stdout)


def _read_pdf(data: bytes, fallback_title: str) -> dict[str, str]:
    reader = PdfReader(BytesIO(data))
    metadata = reader.metadata
    title = (metadata.title or "").strip() if metadata else ""
    parts, remaining = [], MAX_TEXT
    for page in reader.pages:
        page_text = (page.extract_text() or "").strip()
        if not page_text:
            continue
        part = ("\n\n" if parts else "") + page_text
        parts.append(part[:remaining])
        remaining -= len(parts[-1])
        if remaining == 0:
            break
    return {"title": title or fallback_title, "text": "".join(parts).rstrip()}


def _worker(url: str | None) -> dict[str, str]:
    fallback_title = "Untitled PDF"
    if url is None:
        data = sys.stdin.buffer.read(MAX_BYTES + 1)
    else:
        with urlopen(url, timeout=TIMEOUT) as response:
            data = response.read(MAX_BYTES + 1)
            path = urlsplit(response.geturl()).path
            filename = PurePosixPath(unquote(path)).name
            if filename.lower().endswith(".pdf"):
                filename = filename[:-4]
            fallback_title = filename or fallback_title
    if len(data) > MAX_BYTES:
        raise ValueError("PDF exceeds the 15 MB size limit")
    return _read_pdf(data, fallback_title)


if __name__ == "__main__":
    try:
        print(json.dumps(_worker(sys.argv[1] if len(sys.argv) > 1 else None)))
    except (OSError, ValueError, PdfReadError) as exc:
        sys.exit(f"Could not read PDF: {exc}")
