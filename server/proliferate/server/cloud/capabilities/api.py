"""Cloud capabilities API."""

from __future__ import annotations

from fastapi import APIRouter

from proliferate.server.cloud.capabilities.models import CloudCapabilitiesResponse
from proliferate.server.cloud.capabilities.service import cloud_capabilities

router = APIRouter()


@router.get("/capabilities", response_model=CloudCapabilitiesResponse)
async def cloud_capabilities_endpoint() -> CloudCapabilitiesResponse:
    return cloud_capabilities()
