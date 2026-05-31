"""Read-only authenticated user profile routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.auth.models import UserRead
from proliferate.db.models.auth import User

router = APIRouter(prefix="/users", tags=["users"])


@router.get(
    "/me",
    response_model=UserRead,
    name="users:current_user",
    responses={
        401: {
            "description": "Missing token or inactive user.",
        },
    },
)
async def current_user_profile(
    user: User = Depends(current_active_user),
) -> UserRead:
    return UserRead.model_validate(user)
