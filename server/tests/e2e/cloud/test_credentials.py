from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers import (
    PROVIDER_CASES,
    create_user_and_login,
    delete_cloud_credential,
    require_local_auth,
    status_for_provider,
    sync_cloud_credential,
)


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_sync_claude_credential_roundtrip(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Start from a real authenticated user who has usable local Claude auth.
    require_local_auth(cloud_test_config, "claude")

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-claude",
    )

    # Sync the credential through the control-plane API and verify it shows up
    # as available to cloud provisioning.
    statuses = await sync_cloud_credential(cloud_client, auth, cloud_test_config, "claude")
    assert status_for_provider(statuses, "claude")["synced"] is True

    # Delete the synced credential and confirm the control plane clears the
    # provider status for the same user.
    deleted_statuses = await delete_cloud_credential(cloud_client, auth, "claude")
    assert status_for_provider(deleted_statuses, "claude")["synced"] is False


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_sync_codex_credential_roundtrip(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Start from a real authenticated user who has usable local Codex auth.
    require_local_auth(cloud_test_config, "codex")

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-codex",
    )

    # Sync the credential through the control-plane API and verify it shows up
    # as available to cloud provisioning.
    statuses = await sync_cloud_credential(cloud_client, auth, cloud_test_config, "codex")
    assert status_for_provider(statuses, "codex")["synced"] is True

    # Delete the synced credential and confirm the control plane clears the
    # provider status for the same user.
    deleted_statuses = await delete_cloud_credential(cloud_client, auth, "codex")
    assert status_for_provider(deleted_statuses, "codex")["synced"] is False


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_sync_claude_invalid_path_rejected(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    provider_kind: str,
) -> None:
    # Create a real authenticated user, then submit a deliberately invalid file
    # path to prove the transport layer rejects unsafe Claude file sync inputs.
    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-claude-invalid",
    )
    response = await cloud_client.put(
        "/v1/cloud/credentials/claude",
        headers=auth.headers,
        json={
            "authMode": "file",
            "files": [
                {
                    "relativePath": ".claude/not-allowed.json",
                    "contentBase64": "e30=",
                }
            ],
        },
    )
    assert response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_sync_codex_invalid_path_rejected(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    provider_kind: str,
) -> None:
    # Create a real authenticated user, then submit a deliberately invalid file
    # path to prove the transport layer rejects unsafe Codex file sync inputs.
    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-codex-invalid",
    )
    response = await cloud_client.put(
        "/v1/cloud/credentials/codex",
        headers=auth.headers,
        json={
            "authMode": "file",
            "files": [
                {
                    "relativePath": ".codex/not-auth.json",
                    "contentBase64": "e30=",
                }
            ],
        },
    )
    assert response.status_code == 422
