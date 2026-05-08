from __future__ import annotations

from fastapi import APIRouter, Depends, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.engine import get_async_session
from proliferate.server.anonymous_telemetry.models import (
    AnonymousTelemetryAcceptedResponse,
    AnonymousTelemetryRequest,
)
from proliferate.server.anonymous_telemetry.service import record_anonymous_telemetry

router = APIRouter(prefix="/telemetry", tags=["anonymous_telemetry"])


@router.post(
    "/anonymous",
    response_model=AnonymousTelemetryAcceptedResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def record_anonymous_telemetry_endpoint(
    body: AnonymousTelemetryRequest,
    db: AsyncSession = Depends(get_async_session),
) -> AnonymousTelemetryAcceptedResponse:
    try:
        event = body.to_service_event()
    except ValidationError as exc:
        raise RequestValidationError(exc.errors()) from exc

    await record_anonymous_telemetry(db, event)
    return AnonymousTelemetryAcceptedResponse()
