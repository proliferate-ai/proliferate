from __future__ import annotations

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers import (
    PROVIDER_CASES,
    assert_workspace_sane,
    create_ready_cloud_workspace,
    create_user_and_login,
    delete_cloud_workspace_quietly,
    get_cloud_connection,
    require_local_auth,
    seed_linked_github_account,
    status_for_provider,
    sync_cloud_credential,
)


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_provisioned_workspace_is_sane(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Seed the exact user prerequisites the product relies on: local agent auth
    # plus a linked GitHub token that can access the test repo.
    require_local_auth(cloud_test_config, "claude")
    assert cloud_test_config.github_token is not None

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-provision",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=cloud_test_config.github_token,
    )
    repo_config_response = await cloud_client.put(
        f"/v1/cloud/repos/{cloud_test_config.github_owner}/{cloud_test_config.github_repo}/config",
        headers=auth.headers,
        json={
            "configured": True,
            "envVars": {},
            "setupScript": "",
            "files": [],
        },
    )
    repo_config_response.raise_for_status()

    # Sync Claude into the control plane before provisioning so the cloud
    # runtime should come up with at least one ready agent.
    statuses = await sync_cloud_credential(cloud_client, auth, cloud_test_config, "claude")
    assert status_for_provider(statuses, "claude")["synced"] is True

    # Create the workspace through the normal API, wait for the control plane to
    # finish provisioning, then fetch the runtime connection metadata.
    branch_name, workspace = await create_ready_cloud_workspace(
        cloud_client,
        auth,
        db_session,
        cloud_test_config,
        provider_kind=provider_kind,
        branch_prefix=f"cloud-sane-{provider_kind}",
    )
    connection = await get_cloud_connection(cloud_client, auth, str(workspace["id"]))

    try:
        # First assert the control plane's view of the runtime connection, then
        # probe the runtime itself for git and one-message sanity.
        assert workspace["status"] == "ready"
        assert connection["runtimeUrl"]
        assert connection["accessToken"]
        assert connection["anyharnessWorkspaceId"]
        assert connection["runtimeGeneration"] >= 1
        assert connection["allowedAgentKinds"] == ["claude", "codex", "gemini"]
        assert connection["readyAgentKinds"] == ["claude"]

        await assert_workspace_sane(
            connection,
            expected_branch=branch_name,
            agent_kind="claude",
        )
    finally:
        # Provisioning tests own their workspace lifecycle and always tear down
        # the sandbox, even when sanity assertions fail.
        await delete_cloud_workspace_quietly(
            cloud_client,
            auth,
            str(workspace["id"]),
            db_session=db_session,
        )
