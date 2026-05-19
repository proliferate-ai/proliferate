"""Auth viewer endpoints shared by web and mobile."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_limited_user
from proliferate.auth.models import AuthViewerResponse
from proliferate.auth.service import auth_viewer_payload
from proliferate.db.models.auth import User

router = APIRouter(prefix="/auth")


@router.get("/viewer", response_model=AuthViewerResponse)
async def get_auth_viewer(
    user: User = Depends(current_limited_user),
) -> AuthViewerResponse:
    return auth_viewer_payload(user)
