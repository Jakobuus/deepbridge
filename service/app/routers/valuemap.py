"""Current and interview-enriched value maps for a founder."""
import json
import logging
import subprocess
from threading import Lock
from urllib.error import URLError

from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field

from ..lanes.jakob.icp import FounderNotFound, fetch_founder, load_research
from ..lanes.jakob.valuemap import ValueMap, build_value_map
from ..lanes.mark.interview import InterviewRequest, _session
from ..models import Founder
from ..store import FIXTURES, store

router = APIRouter()
_BUILD_LOCK = Lock()
_CACHE: dict[str, tuple[str | None, ValueMap]] = {}
_LOG = logging.getLogger(__name__)
_DEMO = FIXTURES / 'value_map.json'


class ValueMapRequest(BaseModel):
    session_id: str | None = Field(default=None, min_length=1, max_length=128)


def _interview(session_id):
    _, session = _session(session_id, InterviewRequest(session_id=session_id))
    with session.lock:
        if session.question is not None or session.value is None or session.founder is None:
            raise HTTPException(409, 'Finish the interview before building a value map')
        return session.founder, [paper.work for paper in session.papers], {
            'value_proposition': session.value.model_dump(),
            'transcript': session.form.get('interview_transcript'),
            'turns': {str(index): exchange.answer
                      for index, exchange in enumerate(session.exchanges, start=1)},
        }


def _research(founder_id, interview_founder, interview_works):
    try:
        research = load_research(founder_id)
    except ValueError as exc:
        if interview_founder is None and founder_id != store.founder.id:
            raise HTTPException(404, 'Founder research not found; submit intake first') from exc
        research = None
    founder = (interview_founder or (Founder.model_validate(research['founder']) if research else store.founder))
    works = {work['id']: work for work in research['works']} if research else {}
    if founder.openalex_id:
        for work in interview_works:
            if any(entry['author']['id'] == founder.openalex_id for entry in work.get('authorships', [])):
                works.setdefault(work['id'], work)
        if not works:
            try:
                fetch_founder(founder.openalex_id)
                works = {work['id']: work for work in load_research(founder_id)['works']}
            except FounderNotFound as exc:
                raise HTTPException(422, 'No publication evidence was found for this founder') from exc
            except (TimeoutError, URLError) as exc:
                raise HTTPException(503, 'OpenAlex research unavailable; retry shortly') from exc
    if not works:
        raise HTTPException(422, 'The founder needs at least one verified publication')
    return founder, list(works.values())


def _respond(response, result, source):
    with store.lock:
        store.evidence.update((item.id, item) for item in result.evidence)
    response.headers['X-Value-Map-Data'] = source
    response.headers['Access-Control-Expose-Headers'] = 'X-Value-Map-Data'
    return result


def _value_map(response, founder_id=None, session_id=None):
    interview_founder, interview_works, interview = _interview(session_id) if session_id else (None, [], None)
    if interview_founder is not None and founder_id is not None and founder_id != interview_founder.id:
        raise HTTPException(409, 'Interview belongs to a different founder')
    selected = founder_id or (interview_founder.id if interview_founder else
                              getattr(store, 'jakob_active_founder_id', store.founder.id))

    cached = _CACHE.get(selected)
    if cached and (session_id is None or session_id == cached[0]):
        return _respond(response, cached[1], 'cached generation')
    if session_id is None and selected == store.founder.id and _DEMO.is_file():
        snapshot = json.loads(_DEMO.read_text())
        if snapshot['_meta']['founder_id'] == selected:
            return _respond(response, ValueMap.model_validate(snapshot), 'Lightmatter fixture replay')

    with _BUILD_LOCK:
        cached = _CACHE.get(selected)
        if cached and (session_id is None or session_id == cached[0]):
            return _respond(response, cached[1], 'cached generation')
        founder, works = _research(selected, interview_founder, interview_works)
        try:
            result = build_value_map(founder, works, session_id=session_id, interview=interview)
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(504, 'Value-map generation timed out; retry') from exc
        except (ValueError, RuntimeError, OSError) as exc:
            _LOG.warning('Value-map generation failed (%s)', type(exc).__name__)
            raise HTTPException(502, 'Value-map generation failed or returned invalid evidence') from exc
        _CACHE[selected] = session_id, result
        return _respond(response, result, 'generated from founder research')


@router.get('/value-map', response_model=ValueMap)
def get_value_map(response: Response, founder_id: str | None = None):
    return _value_map(response, founder_id)


@router.post('/value-map', response_model=ValueMap)
def post_value_map(response: Response, body: ValueMapRequest, founder_id: str | None = None):
    return _value_map(response, founder_id, body.session_id)
