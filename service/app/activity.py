"""Append-only, per-process activity; restarting restores the cached demo history."""
from threading import RLock
from typing import Literal

from pydantic import BaseModel

from .store import now, store


class Activity(BaseModel):
    id: int
    at: str
    actor: str
    actor_kind: Literal['agent', 'human']
    action: str
    target_id: str
    detail: str
    cached: bool = False


_lock = RLock()
_entries: list[Activity] = []
_seeded = False


def log(actor: str, actor_kind: Literal['agent', 'human'], action: str,
        target_id: str, detail: str) -> Activity:
    """Record a live action. Other lanes can import this function directly."""
    with _lock:
        entry = Activity(id=len(_entries) + 1, at=now(), actor=actor,
                         actor_kind=actor_kind, action=action,
                         target_id=target_id, detail=detail)
        _entries.append(entry)
        return entry.model_copy(deep=True)


def seed() -> None:
    """Replay fixture histories once, after the application loads the store."""
    global _seeded
    with store.lock, _lock:
        if _seeded:
            return
        histories = [(h.at, card.id, h) for card in store.cards.values() for h in card.history]
        for _, card_id, history in sorted(histories, key=lambda item: item[0]):
            _entries.append(Activity(
                id=len(_entries) + 1, at=history.at, actor=history.actor,
                actor_kind=history.actor_kind, action='pipeline.advance',
                target_id=card_id, detail=f'Stage: {history.stage} (simulated demo history)',
                cached=True))
        _seeded = True


def recent(limit: int) -> list[Activity]:
    with _lock:
        return [entry.model_copy(deep=True) for entry in reversed(_entries[-limit:])] if limit else []


def after(cursor: int) -> list[Activity]:
    with _lock:
        return [entry.model_copy(deep=True) for entry in _entries[cursor:]]


def latest_id() -> int:
    with _lock:
        return len(_entries)
