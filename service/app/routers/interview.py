"""Paper-grounded founder interview API."""
from fastapi import APIRouter, Response

from ..lanes.mark.interview import (InterviewRequest, InterviewResponse, TranscriptRequest,
                                   TranscriptResponse, ingest_transcript, turn)

try:
    from ..activity import log
except ImportError:
    log = None

router = APIRouter()


@router.post('/interview', response_model=InterviewResponse)
def interview(request: InterviewRequest):
    return turn(request.session_id, request.answer, paper_links=request.paper_links, founder_id=request.founder_id)


@router.post('/interview/transcript', response_model=TranscriptResponse)
def interview_transcript(request: TranscriptRequest, response: Response):
    result, cached = ingest_transcript(request)
    response.headers['X-Interview-Data'] = 'cached' if cached else 'live'
    if log is not None:
        detail = 'Replayed demo transcript' if cached else 'Processed voice interview transcript'
        log('Interview agent', 'agent', 'interview.transcript', result.session_id, detail)
    return result
