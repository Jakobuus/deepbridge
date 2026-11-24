"""Graph event bus (orchestrator-owned). Every lane publishes GraphEvents here; /graph/stream (Erick's lane) serves them.

publish(session_id, phase, kind, layer, **payload) -> dict  # thread-safe, appends with a per-session seq
events(session_id, from_seq=0) -> list[dict]
subscribe(session_id) -> queue.Queue  # live listeners (SSE); unsubscribe(session_id, q) when done
"""
import json
import queue
import re
import threading
from datetime import UTC, datetime
from pathlib import Path

_LOCK = threading.Lock()
_LOG: dict[str, list[dict]] = {}
_SUBS: dict[str, list[queue.Queue]] = {}


def publish(session_id: str, phase: str, kind: str, layer: str, **payload) -> dict:
    with _LOCK:
        log = _LOG.setdefault(session_id, [])
        event = {'seq': len(log) + 1, 'at': datetime.now(UTC).isoformat(), 'session_id': session_id,
                 'phase': phase, 'kind': kind, 'layer': layer,
                 **{k: v for k, v in payload.items() if v is not None}}
        log.append(event)
        listeners = list(_SUBS.get(session_id, []))
    for q in listeners:
        q.put(event)
    return event


def events(session_id: str, from_seq: int = 0) -> list[dict]:
    with _LOCK:
        return [e for e in _LOG.get(session_id, []) if e['seq'] > from_seq]


def subscribe(session_id: str) -> queue.Queue:
    q: queue.Queue = queue.Queue()
    with _LOCK:
        _SUBS.setdefault(session_id, []).append(q)
    return q


def unsubscribe(session_id: str, q: queue.Queue) -> None:
    with _LOCK:
        if q in _SUBS.get(session_id, []):
            _SUBS[session_id].remove(q)


_SESSION_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
_LOG_DIR = Path(__file__).resolve().parents[2] / 'data' / 'graph_events'


def load_log(session_id: str, events_list: list[dict], replace: bool = True) -> int:
    """Store recorded GraphEvents for a session (seq renumbered 1..N, session_id forced, original `at` kept).
    Does not notify live subscribers. replace=False appends after the existing log. Returns the number stored."""
    with _LOCK:
        log = _LOG.setdefault(session_id, [])
        if replace:
            log.clear()
        for e in events_list:
            log.append({**e, 'seq': len(log) + 1, 'session_id': session_id})
        return len(events_list)


def ensure_recorded(session_id: str) -> bool:
    """If the session has no events and data/graph_events/<session_id>.json exists, load it. True when loaded."""
    if not isinstance(session_id, str) or not _SESSION_RE.match(session_id):
        return False
    if events(session_id):
        return False
    path = _LOG_DIR / f'{session_id}.json'
    if not path.is_file():
        return False
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    if not isinstance(data, list):
        return False
    load_log(session_id, [e for e in data if isinstance(e, dict)])
    return True
