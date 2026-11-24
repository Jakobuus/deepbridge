"""Prepare and retrieve an interview briefing, and accept live interview turns."""

from typing import Literal
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Response

from ..lanes.jakob.briefing import (
    INFERENCE_ERRORS, BriefForm, Briefing, SessionConflict, Turn, extract_turn,
    get_session, prepare_briefing, record_turn, sharpen_turn,
)
from ..lanes.jakob.sources import SourceError
from .categories import category_layer

router = APIRouter()


@router.post('/interview/brief', response_model=Briefing)
def create_briefing(form: BriefForm, response: Response, x_interview_session_id: str | None = Header(default=None)):
    # A client can supply its own fresh UUID and subscribe before the briefing returns.
    if x_interview_session_id is not None:
        try:
            identity = UUID(x_interview_session_id)
            if x_interview_session_id not in (identity.hex, str(identity)):
                raise ValueError
        except ValueError as exc:
            raise HTTPException(422, 'X-Interview-Session-Id must be a UUID') from exc
    try:
        briefing, replayed = prepare_briefing(form, x_interview_session_id)
        if replayed:
            response.headers['X-Briefing-Data'] = 'replay'
            response.headers['Access-Control-Expose-Headers'] = 'X-Briefing-Data'
        return briefing
    except SessionConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except SourceError as exc:
        raise HTTPException(422, str(exc)) from exc
    except INFERENCE_ERRORS as exc:
        raise HTTPException(502, 'Could not generate a grounded briefing') from exc


@router.get('/interview/brief/{session_id}', response_model=Briefing)
def fetch_briefing(session_id: str):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(404, 'Interview session not found')
    return session.briefing


def _buyer_categories():
    return category_layer()[0]


@router.post('/interview/turn')
def submit_turn(turn: Turn, background_tasks: BackgroundTasks) -> dict:
    recorded = record_turn(turn)
    if recorded is None:
        raise HTTPException(404, 'Interview session not found')
    session, index = recorded
    if turn.role == 'founder':  # interviewer lines are stored only: no topic change, no extraction, no sharpen
        sharpened = sharpen_turn(session, index)
        background_tasks.add_task(extract_turn, session, turn, index, _buyer_categories)
        if sharpened is not None:
            return {'ok': True, 'sharpen': sharpened}
    return {'ok': True}
