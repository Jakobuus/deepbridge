"""Research-founder sign-up interview; never sends outreach."""
from fastapi import APIRouter
from ..lanes.mark.interview import InterviewRequest, InterviewResponse, turn

router = APIRouter()


@router.post('/interview', response_model=InterviewResponse)
def interview(request: InterviewRequest):
    return turn(request.session_id, request.answer)
