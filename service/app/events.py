"""Graph event bus (orchestrator-owned). Every lane publishes GraphEvents here; /graph/stream (Erick's lane) serves them.

publish(session_id, phase, kind, layer, **payload) -> dict  # thread-safe, appends with a per-session seq
events(session_id, from_seq=0) -> list[dict]
subscribe(session_id) -> queue.Queue  # live listeners (SSE); unsubscribe(session_id, q) when done
"""
import queue
import threading
from datetime import datetime, timezone

_LOCK = threading.Lock()
_LOG: dict[str, list[dict]] = {}
_SUBS: dict[str, list[queue.Queue]] = {}


def publish(session_id: str, phase: str, kind: str, layer: str, **payload) -> dict:
    with _LOCK:
        log = _LOG.setdefault(session_id, [])
        event = {'seq': len(log) + 1, 'at': datetime.now(timezone.utc).isoformat(), 'session_id': session_id,
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
