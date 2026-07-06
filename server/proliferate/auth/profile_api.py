"""Authenticated user profile routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, TypeAdapter, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.auth.models import UserRead
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User

router = APIRouter(prefix="/users", tags=["users"])

_email_adapter = TypeAdapter(EmailStr)


class ProfileUpdateRequest(BaseModel):
    """Editable fields on the authenticated user's own profile.

    ``outreach_email`` is an optional override address for support/outreach
    follow-up. Sending ``null`` or an empty/whitespace string clears it (falls
    back to the account email); any other value must look like an email.
    """

    model_config = ConfigDict(populate_by_name=True)

    outreach_email: str | None = None

    @field_validator("outreach_email")
    @classmethod
    def _validate_outreach_email(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        # Raises pydantic ValidationError (-> 422) when it does not look like an
        # email. Normalize to the validated address.
        return str(_email_adapter.validate_python(cleaned))


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


@router.patch(
    "/me",
    response_model=UserRead,
    name="users:update_current_user",
    responses={
        401: {
            "description": "Missing token or inactive user.",
        },
        422: {
            "description": "outreach_email is not a valid email address.",
        },
    },
)
async def update_current_user_profile(
    body: ProfileUpdateRequest,
    user: User = Depends(current_active_user),
    db: AsyncSession = Depends(get_async_session),
) -> UserRead:
    if "outreach_email" in body.model_fields_set:
        user.outreach_email = body.outreach_email
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user)
