"""Local development helper routes."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from proliferate.config import settings
from proliferate.server.devtools.models import (
    DevDesktopHandoffPollResponse,
    DevDesktopHandoffRecordResponse,
    DevDesktopHandoffRequest,
)
from proliferate.server.devtools.service import (
    DevDesktopHandoffRecord,
    enqueue_desktop_handoff,
    take_desktop_handoff,
)

router = APIRouter(prefix="/dev/desktop-handoff", tags=["devtools"])


@router.post("", response_model=DevDesktopHandoffRecordResponse)
async def enqueue_dev_desktop_handoff_endpoint(
    body: DevDesktopHandoffRequest,
) -> DevDesktopHandoffRecordResponse:
    _require_local_dev()
    try:
        record = await enqueue_desktop_handoff(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _record_response(record)


@router.get("", response_model=DevDesktopHandoffPollResponse)
async def take_dev_desktop_handoff_endpoint() -> DevDesktopHandoffPollResponse:
    _require_local_dev()
    record = await take_desktop_handoff()
    return DevDesktopHandoffPollResponse(
        handoff=_record_response(record) if record is not None else None,
    )


def _require_local_dev() -> None:
    if not settings.proliferate_dev:
        raise HTTPException(status_code=404, detail="Not found.")


def _record_response(record: DevDesktopHandoffRecord) -> DevDesktopHandoffRecordResponse:
    return DevDesktopHandoffRecordResponse(
        id=record.id,
        url=record.url,
        createdAt=record.created_at.isoformat(),
    )
