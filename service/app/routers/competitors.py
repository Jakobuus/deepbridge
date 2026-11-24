"""Replayable, evidence-backed adjacent-company publication map."""
import json
import logging
from threading import Lock
from urllib.error import URLError

from fastapi import APIRouter, HTTPException

from ..lanes.jakob.competitors import (SNAPSHOT, CompetitorsResponse, _write,
    discover, snapshot_path, validate_snapshot)
from ..lanes.jakob.icp import load_research
from ..models import Evidence, Founder
from ..store import store

router = APIRouter()
_BUILD_LOCK = Lock()
LOG = logging.getLogger(__name__)


@router.get('/competitors', response_model=CompetitorsResponse)
def competitors(founder_id: str | None = None):
    selected = founder_id or getattr(store, 'jakob_active_founder_id', store.founder.id)
    works, seed_evidence = [], []
    if selected == store.founder.id:
        founder = store.founder
        seed_evidence = list(store.evidence.values())
        try:
            works = load_research(selected)['works']
        except ValueError:
            pass
    else:
        try:
            research = load_research(selected)
            founder = Founder.model_validate(research['founder'])
            works = research['works']
            seed_evidence = [Evidence.model_validate(e) for e in research['evidence']]
        except (ValueError, KeyError) as exc:
            raise HTTPException(404, 'Founder research not found; submit intake first') from exc
    with _BUILD_LOCK:
        path = SNAPSHOT if selected == store.founder.id else snapshot_path(founder)
        result = None
        if path.exists():
            try:
                result = validate_snapshot(json.loads(path.read_text()), founder)
            except (ValueError, KeyError, OSError) as exc:
                LOG.warning('Adjacent company snapshot invalid: %s', exc)
        if result is None:
            try:
                result = validate_snapshot(discover(founder, works, seed_evidence), founder)
                _write(path, result)
            except (TimeoutError, URLError) as exc:
                raise HTTPException(503, 'OpenAlex unavailable; no adjacent-company snapshot for this founder') from exc
            except (ValueError, KeyError) as exc:
                raise HTTPException(502, 'Could not resolve evidence-backed adjacent companies') from exc
        with store.lock:
            store.evidence.update({e['id']: Evidence.model_validate(e) for e in result['evidence']})
        return result
