"""Cloud capabilities API."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_product_user
from proliferate.db.models.auth import User
from proliferate.server.cloud.capabilities.models import CloudCapabilitiesResponse
from proliferate.server.cloud.capabilities.service import cloud_capabilities

router = APIRouter()


@router.get("/capabilities", response_model=CloudCapabilitiesResponse)
async def cloud_capabilities_endpoint(
    _user: User = Depends(current_product_user),
) -> CloudCapabilitiesResponse:
    return cloud_capabilities()
