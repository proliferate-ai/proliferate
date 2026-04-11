from __future__ import annotations

from fastapi import APIRouter, status

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
) -> AnonymousTelemetryAcceptedResponse:
    await record_anonymous_telemetry(body.to_service_event())
    return AnonymousTelemetryAcceptedResponse()
