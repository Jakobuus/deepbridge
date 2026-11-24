"""Stub; owned by its lane (see AGENTS.md). Replace the body, keep the router name."""
from fastapi import APIRouter, Depends
from .common import check_founder
router = APIRouter(dependencies=[Depends(check_founder)])
