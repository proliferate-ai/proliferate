from __future__ import annotations

import asyncio

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
    load_active_sandbox_record,
    load_runtime_environment_record,
    load_workspace_record,
    provider_pause_native,
    provider_state,
    require_local_auth,
    seed_linked_github_account,
    status_for_provider,
    sync_cloud_credential,
    wait_for_cloud_workspace_status,
    workspace_status,
)


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_workspace_reconnect_after_stop_start(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Build a real ready workspace first: linked GitHub account, synced Claude
    # credential, and a provider-backed sandbox provisioned through the API.
    require_local_auth(cloud_test_config, "claude")
    assert cloud_test_config.github_token is not None

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-reconnect",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=cloud_test_config.github_token,
    )

    statuses = await sync_cloud_credential(cloud_client, auth, cloud_test_config, "claude")
    assert status_for_provider(statuses, "claude")["synced"] is True

    branch_name, workspace = await create_ready_cloud_workspace(
        cloud_client,
        auth,
        db_session,
        cloud_test_config,
        provider_kind=provider_kind,
        branch_prefix=f"cloud-reconnect-{provider_kind}",
    )

    try:
        # Stop the workspace through the control plane and confirm reconnect
        # metadata stays persisted on the runtime environment row.
        stop_response = await cloud_client.post(
            f"/v1/cloud/workspaces/{workspace['id']}/stop",
            headers=auth.headers,
        )
        stop_response.raise_for_status()
        assert workspace_status(stop_response.json()) == "archived"

        workspace_record = await load_workspace_record(db_session, str(workspace["id"]))
        assert workspace_record.runtime_environment_id is not None
        runtime_environment = await load_runtime_environment_record(
            db_session,
            str(workspace["id"]),
        )
        assert runtime_environment.runtime_url
        assert runtime_environment.runtime_token_ciphertext
        assert runtime_environment.root_anyharness_workspace_id

        # Start the same workspace again and wait until the control plane says
        # the runtime is usable.
        start_response = await cloud_client.post(
            f"/v1/cloud/workspaces/{workspace['id']}/start",
            headers=auth.headers,
        )
        start_response.raise_for_status()
        if workspace_status(start_response.json()) != "ready":
            await wait_for_cloud_workspace_status(
                cloud_client,
                auth,
                str(workspace["id"]),
                target_status="ready",
            )

        # Re-run the runtime sanity probe to prove stop/start preserves a usable
        # git-backed AnyHarness runtime, not just a status flip.
        connection = await get_cloud_connection(cloud_client, auth, str(workspace["id"]))
        await assert_workspace_sane(
            connection,
            expected_branch=branch_name,
            agent_kind="claude",
        )
    finally:
        # Lifecycle tests always own cleanup of the sandbox they created.
        await delete_cloud_workspace_quietly(
            cloud_client,
            auth,
            str(workspace["id"]),
            db_session=db_session,
        )


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_workspace_recovers_after_native_pause(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Build a real ready workspace first so the pause is happening to a live
    # provider sandbox, not to seeded local state.
    require_local_auth(cloud_test_config, "claude")
    assert cloud_test_config.github_token is not None

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-native-pause",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=cloud_test_config.github_token,
    )

    statuses = await sync_cloud_credential(cloud_client, auth, cloud_test_config, "claude")
    assert status_for_provider(statuses, "claude")["synced"] is True

    branch_name, workspace = await create_ready_cloud_workspace(
        cloud_client,
        auth,
        db_session,
        cloud_test_config,
        provider_kind=provider_kind,
        branch_prefix=f"cloud-native-pause-{provider_kind}",
    )

    try:
        # Pause the sandbox through the provider API to simulate an external
        # lifecycle event outside the normal control-plane stop flow.
        sandbox = await load_active_sandbox_record(db_session, str(workspace["id"]))
        assert sandbox.external_sandbox_id
        await provider_pause_native(provider_kind, sandbox.external_sandbox_id)

        # Ask the control plane to start the workspace again and wait until it
        # has recovered the runtime connection.
        start_response = await cloud_client.post(
            f"/v1/cloud/workspaces/{workspace['id']}/start",
            headers=auth.headers,
        )
        start_response.raise_for_status()
        if workspace_status(start_response.json()) != "ready":
            await wait_for_cloud_workspace_status(
                cloud_client,
                auth,
                str(workspace["id"]),
                target_status="ready",
            )

        # The post-pause success condition is the same as ordinary provisioning:
        # git works and the runtime can answer a basic Claude turn.
        connection = await get_cloud_connection(cloud_client, auth, str(workspace["id"]))
        await assert_workspace_sane(
            connection,
            expected_branch=branch_name,
            agent_kind="claude",
        )
    finally:
        # Lifecycle tests always own cleanup of the sandbox they created.
        await delete_cloud_workspace_quietly(
            cloud_client,
            auth,
            str(workspace["id"]),
            db_session=db_session,
        )


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.parametrize("provider_kind", PROVIDER_CASES)
async def test_workspace_delete_cleans_up(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
) -> None:
    # Build a real ready workspace first so delete is exercised against the same
    # fully provisioned shape the product exposes to users.
    require_local_auth(cloud_test_config, "claude")
    assert cloud_test_config.github_token is not None

    auth = await create_user_and_login(
        cloud_client,
        db_session,
        email_prefix=f"{provider_kind}-delete",
    )
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=cloud_test_config.github_token,
    )

    statuses = await sync_cloud_credential(cloud_client, auth, cloud_test_config, "claude")
    assert status_for_provider(statuses, "claude")["synced"] is True

    branch_name, workspace = await create_ready_cloud_workspace(
        cloud_client,
        auth,
        db_session,
        cloud_test_config,
        provider_kind=provider_kind,
        branch_prefix=f"cloud-delete-{provider_kind}",
    )

    deleted = False
    sandbox = await load_active_sandbox_record(db_session, str(workspace["id"]))
    try:
        # Sanity-check the live runtime before delete so the test proves cleanup
        # from a genuinely usable sandbox, not from a failed provision.
        await assert_workspace_sane(
            await get_cloud_connection(cloud_client, auth, str(workspace["id"])),
            expected_branch=branch_name,
            agent_kind="claude",
        )

        # Delete through the control plane and verify both API reads and
        # provider-side sandbox state converge to a terminal condition.
        await delete_cloud_workspace_quietly(
            cloud_client,
            auth,
            str(workspace["id"]),
            db_session=db_session,
        )
        deleted = True

        detail_response = await cloud_client.get(
            f"/v1/cloud/workspaces/{workspace['id']}",
            headers=auth.headers,
        )
        assert detail_response.status_code == 200
        assert workspace_status(detail_response.json()) == "archived"

        connection_response = await cloud_client.get(
            f"/v1/cloud/workspaces/{workspace['id']}/connection",
            headers=auth.headers,
        )
        assert connection_response.status_code == 409

        terminal_states = {
            "destroyed",
            "terminated",
            "killed",
            "archived",
            "stopped",
        }
        state = None
        for _ in range(12):
            try:
                state = await provider_state(provider_kind, sandbox.external_sandbox_id or "")
            except Exception:
                state = None
            if state is None or state.state in terminal_states:
                break
            await asyncio.sleep(5.0)
        if state is not None:
            assert state.state in terminal_states
    finally:
        # If the explicit delete path failed midway, do one last best-effort
        # cleanup so the suite does not leak sandboxes.
        if not deleted:
            await delete_cloud_workspace_quietly(
                cloud_client,
                auth,
                str(workspace["id"]),
                db_session=db_session,
            )
