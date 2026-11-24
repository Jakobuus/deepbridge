import hashlib
import json
import subprocess
from threading import Lock
from urllib.error import HTTPError, URLError

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from ..lanes.jakob.icp import CACHE, FounderNotFound, _write, build_icp, fetch_founder, load_research
from ..models import Evidence, Founder, Icp, IntakeRequest
from ..store import store

router = APIRouter()
_BUILD_LOCK = Lock()


def _register(research):
    founder = Founder.model_validate(research['founder'])
    with store.lock:
        if not hasattr(store, 'jakob_founders'):
            store.jakob_founders = {}
        store.jakob_founders[founder.id] = founder
        for evidence in research['evidence']:
            parsed = Evidence.model_validate(evidence)
            store.evidence[parsed.id] = parsed
    return founder


@router.post('/intake', response_model=Founder)
def intake(body: IntakeRequest):
    form = body.model_dump()
    query = (body.query or body.name or '').strip().casefold()
    lightmatter = {'lightmatter', 'nicholas c. harris', 'nicholas harris',
                   'a5102978866', 'https://openalex.org/a5102978866',
                   '10.1038/nphoton.2017.93', 'https://doi.org/10.1038/nphoton.2017.93'}
    links = {link.rstrip('/').casefold() for link in body.paper_links}
    if ((query in lightmatter and (not links or links.issubset(lightmatter)))
            or (not query and links and links.issubset(lightmatter))):
        store.jakob_active_founder_id = store.founder.id
        return store.founder
    try:
        founder = fetch_founder(form)
        _register(load_research(founder.id))
        store.jakob_active_founder_id = founder.id
        return founder
    except FounderNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except HTTPError as exc:
        detail = ('OpenAlex is rate limited; retry shortly'
                  if exc.code == 429 else 'OpenAlex is unavailable; retry shortly')
        raise HTTPException(503, detail) from exc
    except (TimeoutError, URLError) as exc:
        raise HTTPException(504, 'OpenAlex intake unavailable or timed out; retry shortly') from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get('/icp', response_model=Icp)
def icp(founder_id: str | None = None):
    selected = founder_id or getattr(store, 'jakob_active_founder_id', store.founder.id)
    if selected == store.founder.id:
        return store.icp
    try:
        research = load_research(selected)
        founder = _register(research)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    # Serialize builds so repeated stage clicks do not launch duplicate CLI calls.
    with _BUILD_LOCK:
        fingerprint = hashlib.sha256(json.dumps({'founder': research['founder'],
                      'works': research['works'], 'persona': research['persona']}, sort_keys=True).encode()).hexdigest()
        path = CACHE / 'icp' / (hashlib.sha256(selected.encode()).hexdigest()[:24] + '.json')
        if path.exists():
            cached = json.loads(path.read_text())
            if cached.get('fingerprint') == fingerprint:
                return Icp.model_validate(cached['icp'])
        try:
            result = build_icp(founder, research['works'], research['persona'])
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, 'ICP generation exceeded 180 seconds; retry') from exc
        except (ValueError, RuntimeError, OSError, ValidationError) as exc:
            raise HTTPException(502, 'ICP generation failed or returned invalid evidence') from exc
        _write(path, {'fingerprint': fingerprint, 'cached': True, 'icp': result.model_dump()})
        return result
