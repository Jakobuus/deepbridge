"""Paper-grounded founder interview API."""
from fastapi import APIRouter

from ..lanes.mark.interview import InterviewRequest, InterviewResponse, turn

router = APIRouter()


@router.post('/interview', response_model=InterviewResponse)
def interview(request: InterviewRequest):
    return turn(request.session_id, request.answer, paper_links=request.paper_links, founder_id=request.founder_id)
