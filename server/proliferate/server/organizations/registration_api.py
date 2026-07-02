"""Invited self-registration route (single-org mode only).

Mounted under ``/auth`` next to the other auth transports, but only when
``single_org_mode`` is on (see ``create_app``); hosted deployments never expose
it. The /setup page stays claim-only: this is the registration path that
reopens for allowlisted (invited) emails after the instance is claimed.
"""

from __future__ import annotations

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field

from proliferate.constants.auth import PASSWORD_EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH
from proliferate.db.engine import AsyncSessionDep
from proliferate.server.organizations.self_registration import register_invited_account

router = APIRouter(prefix="/password", tags=["auth"])


class PasswordRegisterRequest(BaseModel):
    email: str = Field(max_length=PASSWORD_EMAIL_MAX_LENGTH)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class PasswordRegisterResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    organization_name: str = Field(serialization_alias="organizationName")


@router.post(
    "/register",
    response_model=PasswordRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_with_password(
    body: PasswordRegisterRequest,
    db: AsyncSessionDep,
) -> PasswordRegisterResponse:
    """Create an account for an invited email, joining the instance organization."""
    registration = await register_invited_account(
        db,
        email=body.email,
        password=body.password,
    )
    return PasswordRegisterResponse(
        email=registration.email,
        organization_name=registration.organization_name,
    )
