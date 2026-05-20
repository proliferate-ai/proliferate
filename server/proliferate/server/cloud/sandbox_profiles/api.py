"""HTTP routes for managed cloud sandbox profiles."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_active_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.sandbox_profiles.models import (
    SandboxProfileResponse,
    SandboxProfileTargetStateResponse,
    runtime_access_payload,
    sandbox_profile_payload,
    slot_payload,
    target_payload,
)
from proliferate.server.cloud.sandbox_profiles.service import (
    enable_cloud,
    ensure_organization,
    ensure_personal,
    get_profile,
    get_target_state,
)

router = APIRouter(tags=["cloud-sandbox-profiles"])


@router.post("/sandbox-profiles/personal", response_model=SandboxProfileResponse)
async def ensure_personal_sandbox_profile_endpoint(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SandboxProfileResponse:
    try:
        profile = await ensure_personal(db, user=user)
    except CloudApiError as error:
        raise_cloud_error(error)
    return sandbox_profile_payload(profile)


@router.post(
    "/organizations/{organization_id}/sandbox-profile",
    response_model=SandboxProfileResponse,
)
async def ensure_organization_sandbox_profile_endpoint(
    organization_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SandboxProfileResponse:
    try:
        profile = await ensure_organization(db, user=user, organization_id=organization_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return sandbox_profile_payload(profile)


@router.get("/sandbox-profiles/{sandbox_profile_id}", response_model=SandboxProfileResponse)
async def get_sandbox_profile_endpoint(
    sandbox_profile_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SandboxProfileResponse:
    try:
        profile = await get_profile(db, user=user, sandbox_profile_id=sandbox_profile_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return sandbox_profile_payload(profile)


@router.get(
    "/sandbox-profiles/{sandbox_profile_id}/target-state",
    response_model=SandboxProfileTargetStateResponse,
)
async def get_sandbox_profile_target_state_endpoint(
    sandbox_profile_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SandboxProfileTargetStateResponse:
    try:
        state = await get_target_state(db, user=user, sandbox_profile_id=sandbox_profile_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return SandboxProfileTargetStateResponse(
        profile=sandbox_profile_payload(state.profile),
        target=target_payload(state.target),
        slot=slot_payload(state.slot),
        runtime_access=runtime_access_payload(state.runtime_access),
        ready=state.ready,
    )


@router.post(
    "/sandbox-profiles/{sandbox_profile_id}/enable-cloud",
    response_model=SandboxProfileTargetStateResponse,
)
async def enable_sandbox_profile_cloud_endpoint(
    sandbox_profile_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user),
) -> SandboxProfileTargetStateResponse:
    try:
        state = await enable_cloud(db, user=user, sandbox_profile_id=sandbox_profile_id)
    except CloudApiError as error:
        raise_cloud_error(error)
    return SandboxProfileTargetStateResponse(
        profile=sandbox_profile_payload(state.profile),
        target=target_payload(state.target),
        slot=slot_payload(state.slot),
        runtime_access=runtime_access_payload(state.runtime_access),
        ready=state.ready,
    )
