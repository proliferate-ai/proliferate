from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.server.cloud.mcp_connections.models import OkResponse
from proliferate.server.cloud.skills.models import (
    CreateSkillConfiguredItemRequest,
    PatchSkillConfiguredItemRequest,
    SkillConfiguredItemResponse,
    SkillConfiguredItemsResponse,
    skill_configured_item_payload,
)
from proliferate.server.cloud.skills.service import (
    create_configured_skill,
    delete_configured_skill,
    list_configured_skills,
    patch_configured_skill,
)

router = APIRouter(prefix="/skills", tags=["cloud-skills"])


@router.get("", response_model=SkillConfiguredItemsResponse)
async def list_configured_skills_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> SkillConfiguredItemsResponse:
    return SkillConfiguredItemsResponse(
        skills=[
            skill_configured_item_payload(item)
            for item in await list_configured_skills(db, user_id=user.id)
        ]
    )


@router.post("", response_model=SkillConfiguredItemResponse)
async def create_configured_skill_endpoint(
    body: CreateSkillConfiguredItemRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> SkillConfiguredItemResponse:
    try:
        return skill_configured_item_payload(
            await create_configured_skill(db, user_id=user.id, body=body)
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.patch("/{item_id}", response_model=SkillConfiguredItemResponse)
async def patch_configured_skill_endpoint(
    item_id: UUID,
    body: PatchSkillConfiguredItemRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> SkillConfiguredItemResponse:
    try:
        return skill_configured_item_payload(
            await patch_configured_skill(db, user_id=user.id, item_id=item_id, body=body)
        )
    except CloudApiError as error:
        raise_cloud_error(error)


@router.delete("/{item_id}", response_model=OkResponse)
async def delete_configured_skill_endpoint(
    item_id: UUID,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> OkResponse:
    try:
        await delete_configured_skill(db, user_id=user.id, item_id=item_id)
        return OkResponse()
    except CloudApiError as error:
        raise_cloud_error(error)
