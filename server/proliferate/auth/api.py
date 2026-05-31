"""Auth viewer endpoints shared by web and mobile."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_limited_user
from proliferate.auth.identity.service import auth_viewer_payload
from proliferate.auth.models import AuthViewerResponse, UserRead
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User

router = APIRouter(prefix="/auth")


@router.get("/viewer", response_model=AuthViewerResponse)
async def get_auth_viewer(
    user: User = Depends(current_limited_user),
    db: AsyncSession = Depends(get_async_session),
) -> AuthViewerResponse:
    (
        github_connected,
        onboarding_state,
        linked_providers,
        provider_availability,
        password_credential,
    ) = await auth_viewer_payload(db, user=user)
    return AuthViewerResponse(
        user=UserRead.model_validate(user),
        github_connected=github_connected,
        onboarding_state=onboarding_state,
        linked_providers=linked_providers,
        provider_availability=provider_availability,
        password_credential=password_credential,
    )
