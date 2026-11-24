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
        event = {**{k: v for k, v in payload.items() if v is not None},
                 'seq': len(log) + 1, 'at': datetime.now(UTC).isoformat(), 'session_id': session_id,
                 'phase': phase, 'kind': kind, 'layer': layer}
        log.append(event)
        listeners = list(_SUBS.get(session_id, []))
    for q in listeners:
        try:
            q.put_nowait(event)
        except queue.Full:
            pass  # bounded wakeup queues: a pending wakeup is enough
    return event


def events(session_id: str, from_seq: int = 0, limit: int | None = None) -> list[dict]:
    """Events with seq > from_seq. seq is contiguous 1..N, so this is a slice: O(returned), not O(log)."""
    start = max(from_seq, 0)
    with _LOCK:
        log = _LOG.get(session_id, [])
        return log[start:] if limit is None else log[start:start + max(limit, 0)]


def last_seq(session_id: str) -> int:
    with _LOCK:
        return len(_LOG.get(session_id, []))


def _subscribe_bounded(session_id: str, maxsize: int = 1) -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize)
    with _LOCK:
        _SUBS.setdefault(session_id, []).append(q)
    return q


def subscribe(session_id: str) -> queue.Queue:
    return _subscribe_bounded(session_id, 0)


def unsubscribe(session_id: str, q: queue.Queue) -> None:
    with _LOCK:
        subs = _SUBS.get(session_id)
        if subs is None:
            return
        if q in subs:
            subs.remove(q)
        if not subs:
            del _SUBS[session_id]


_SESSION_RE = re.compile(r'[A-Za-z0-9_-]{1,64}')
_PHASES = {'reading', 'interview', 'discovery', 'paths'}
_KINDS = {'node', 'edge', 'path', 'category', 'status'}
_LAYERS = {'core', 'category', 'lead'}
_LOG_DIR = Path(__file__).resolve().parents[2] / 'data' / 'graph_events'


def _store(log: list[dict], session_id: str, events_list: list[dict]) -> None:
    for e in events_list:
        log.append({**e, 'seq': len(log) + 1, 'session_id': session_id})


def load_log(session_id: str, events_list: list[dict], replace: bool = True) -> int:
    """Store recorded GraphEvents for a session (seq renumbered 1..N, session_id forced, original `at` kept).
    Does not notify live subscribers. replace=False appends after the existing log. Returns the number stored."""
    with _LOCK:
        log = _LOG.setdefault(session_id, [])
        if replace:
            log.clear()
        _store(log, session_id, events_list)
        return len(events_list)


def _install_if_empty(session_id: str, events_list: list[dict]) -> bool:
    with _LOCK:
        if _LOG.get(session_id):
            return False
        _store(_LOG.setdefault(session_id, []), session_id, events_list)
        return True


def _in(v, allowed: set) -> bool:
    return isinstance(v, str) and v in allowed


def _valid_at(v) -> bool:
    if not isinstance(v, str):
        return False
    try:
        datetime.fromisoformat(v[:-1] + '+00:00' if v.endswith('Z') else v)
    except ValueError:
        return False
    return True


def _valid_record(e) -> bool:
    if not (isinstance(e, dict) and _in(e.get('phase'), _PHASES) and _in(e.get('kind'), _KINDS)
            and _in(e.get('layer'), _LAYERS) and _valid_at(e.get('at'))):
        return False
    if any(k in e and not isinstance(e[k], dict) for k in ('node', 'edge', 'path')):
        return False
    if 'evidence' in e and not isinstance(e['evidence'], list):
        return False
    return not ('status' in e and not isinstance(e['status'], str))


def ensure_recorded(session_id: str) -> bool:
    """If the session has no events and data/graph_events/<session_id>.json exists and is valid, load it atomically.
    True when loaded. An invalid file (any bad record) loads nothing."""
    if not isinstance(session_id, str) or not _SESSION_RE.fullmatch(session_id):
        return False
    if events(session_id):
        return False
    path = _LOG_DIR / f'{session_id}.json'
    try:
        if not path.is_file():
            return False
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return False
    if not isinstance(data, list) or not data or not all(_valid_record(e) for e in data):
        return False
    return _install_if_empty(session_id, data)
