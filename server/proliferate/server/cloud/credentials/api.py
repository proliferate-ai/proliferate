from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.dependencies import current_product_user
from proliferate.constants.cloud import CloudAgentKind
from proliferate.db.engine import get_async_session
from proliferate.db.models.auth import User
from proliferate.server.cloud.credentials.models import (
    CloudCredentialMutationResponse,
    CredentialStatus,
    SyncCloudCredentialRequest,
    credential_status_payload,
)
from proliferate.server.cloud.credentials.service import (
    delete_cloud_credential_for_user,
    list_cloud_credentials,
    sync_cloud_credential_for_user,
)

router = APIRouter()


@router.get("/credentials", response_model=list[CredentialStatus])
async def list_cloud_credentials_endpoint(
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> list[CredentialStatus]:
    return [
        credential_status_payload(status) for status in await list_cloud_credentials(db, user.id)
    ]


@router.put("/credentials/{provider}")
async def sync_cloud_credential_endpoint(
    provider: CloudAgentKind,
    body: SyncCloudCredentialRequest,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudCredentialMutationResponse:
    changed = await sync_cloud_credential_for_user(db, user.id, provider, body)
    return CloudCredentialMutationResponse(changed=changed)


@router.delete("/credentials/{provider}")
async def delete_cloud_credential_endpoint(
    provider: CloudAgentKind,
    user: User = Depends(current_product_user),
    db: AsyncSession = Depends(get_async_session),
) -> CloudCredentialMutationResponse:
    changed = await delete_cloud_credential_for_user(db, user.id, provider)
    return CloudCredentialMutationResponse(changed=changed)
