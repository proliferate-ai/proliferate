from __future__ import annotations

from fastapi import APIRouter, Depends

from proliferate.auth.dependencies import current_active_user
from proliferate.constants.cloud import CloudAgentKind
from proliferate.db.models.auth import User
from proliferate.server.cloud.credentials.models import (
    CredentialStatus,
    SyncCloudCredentialRequest,
)
from proliferate.server.cloud.credentials.service import (
    delete_cloud_credential_for_user,
    list_cloud_credentials,
    sync_cloud_credential_for_user,
)
from proliferate.server.cloud.errors import CloudApiError, raise_cloud_error
from proliferate.utils.telemetry import track_cloud_event

router = APIRouter()


@router.get("/credentials", response_model=list[CredentialStatus])
async def list_cloud_credentials_endpoint(
    user: User = Depends(current_active_user),
) -> list[CredentialStatus]:
    return await list_cloud_credentials(user.id)


@router.put("/credentials/{provider}")
async def sync_cloud_credential_endpoint(
    provider: CloudAgentKind,
    body: SyncCloudCredentialRequest,
    user: User = Depends(current_active_user),
) -> dict[str, bool]:
    try:
        auth_mode = await sync_cloud_credential_for_user(user.id, provider, body)
    except CloudApiError as error:
        track_cloud_event(
            user,
            "cloud_api_credential_sync",
            {
                "outcome": "failure",
                "provider": provider,
                "auth_mode": body.auth_mode,
                "status_code": error.status_code,
                "error_code": error.code,
            },
        )
        raise_cloud_error(error)
    track_cloud_event(
        user,
        "cloud_api_credential_sync",
        {
            "outcome": "success",
            "provider": provider,
            "auth_mode": auth_mode,
        },
    )
    return {"ok": True}


@router.delete("/credentials/{provider}")
async def delete_cloud_credential_endpoint(
    provider: CloudAgentKind,
    user: User = Depends(current_active_user),
) -> dict[str, bool]:
    try:
        await delete_cloud_credential_for_user(user.id, provider)
    except CloudApiError as error:
        track_cloud_event(
            user,
            "cloud_api_credential_delete",
            {
                "outcome": "failure",
                "provider": provider,
                "status_code": error.status_code,
                "error_code": error.code,
            },
        )
        raise_cloud_error(error)
    track_cloud_event(
        user,
        "cloud_api_credential_delete",
        {
            "outcome": "success",
            "provider": provider,
        },
    )
    return {"ok": True}
