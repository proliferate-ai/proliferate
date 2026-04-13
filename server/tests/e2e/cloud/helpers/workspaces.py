from __future__ import annotations

import asyncio
import time
from contextlib import suppress
from datetime import UTC, datetime, timedelta

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.db.store.cloud_workspaces import (
    delete_cloud_workspace_records_for_workspace,
)
from proliferate.integrations.sandbox import get_sandbox_provider
from tests.e2e.cloud.helpers.auth import (
    create_user_and_login,
    refresh_auth_session,
)
from tests.e2e.cloud.helpers.config import (
    ensure_cloud_runtime_binary_ready,
    ensure_provider_available,
)
from tests.e2e.cloud.helpers.credentials import sync_cloud_credential
from tests.e2e.cloud.helpers.github import link_github_account
from tests.e2e.cloud.helpers.shared import (
    AuthSession,
    CloudE2ETestError,
    CloudTestConfig,
    DEFAULT_CLOUD_TEST_TIMEOUT_SECONDS,
    WorkspaceHandle,
    unique_branch_name,
)


async def create_cloud_workspace(
    client: httpx.AsyncClient,
    auth: AuthSession,
    config: CloudTestConfig,
    *,
    branch_name: str,
) -> dict[str, object]:
    repo_config_response = await client.put(
        f"/v1/cloud/repos/{config.github_owner}/{config.github_repo}/config",
        headers=auth.headers,
        json={
            "configured": True,
            "defaultBranch": config.github_base_branch,
            "envVars": {},
            "setupScript": "",
            "files": [],
        },
    )
    if repo_config_response.status_code >= 400:
        detail = repo_config_response.text.strip() or "<empty response body>"
        raise CloudE2ETestError(
            f"Cloud repo config failed ({repo_config_response.status_code}): {detail}"
        )

    response = await client.post(
        "/v1/cloud/workspaces",
        headers=auth.headers,
        json={
            "gitProvider": "github",
            "gitOwner": config.github_owner,
            "gitRepoName": config.github_repo,
            "baseBranch": config.github_base_branch,
            "branchName": branch_name,
        },
    )
    if response.status_code >= 400:
        detail = response.text.strip() or "<empty response body>"
        raise CloudE2ETestError(
            f"Cloud workspace create failed ({response.status_code}): {detail}"
        )
    return response.json()


def _is_daytona_cpu_limit_error(exc: CloudE2ETestError) -> bool:
    return "Total CPU limit exceeded" in str(exc)


async def cleanup_stale_daytona_test_sandboxes(
    *,
    older_than: timedelta = timedelta(hours=1),
) -> int:
    def _cleanup() -> int:
        from daytona import Daytona, DaytonaConfig
        from proliferate.constants.sandbox.daytona import DAYTONA_DELETE_TIMEOUT_SECONDS

        client = Daytona(
            DaytonaConfig(
                api_key=settings.daytona_api_key,
                api_url=settings.daytona_server_url,
                target=settings.daytona_target,
            )
        )
        page = client.list()
        cutoff = datetime.now(UTC) - older_than
        deleted = 0
        for sandbox in page.items:
            created_at = getattr(sandbox, "created_at", None)
            labels = getattr(sandbox, "labels", None) or {}
            created = None
            if isinstance(created_at, str) and created_at:
                with suppress(ValueError):
                    created = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            if created is None or created > cutoff:
                continue
            if "cloud_sandbox_id" not in labels and "workspace_id" not in labels:
                continue
            with suppress(Exception):
                client.delete(sandbox, timeout=DAYTONA_DELETE_TIMEOUT_SECONDS)
                deleted += 1
        return deleted

    return await asyncio.to_thread(_cleanup)


async def get_cloud_workspace(
    client: httpx.AsyncClient,
    auth: AuthSession,
    workspace_id: str,
) -> dict[str, object]:
    response = await client.get(f"/v1/cloud/workspaces/{workspace_id}", headers=auth.headers)
    if response.status_code == 401:
        auth = await refresh_auth_session(client, auth=auth)
        response = await client.get(
            f"/v1/cloud/workspaces/{workspace_id}",
            headers=auth.headers,
        )
    response.raise_for_status()
    return response.json()


async def wait_for_cloud_workspace_status(
    client: httpx.AsyncClient,
    auth: AuthSession,
    workspace_id: str,
    *,
    target_status: str,
    timeout_seconds: float = DEFAULT_CLOUD_TEST_TIMEOUT_SECONDS,
) -> dict[str, object]:
    deadline = time.monotonic() + timeout_seconds
    last_payload: dict[str, object] | None = None
    while time.monotonic() < deadline:
        payload = await get_cloud_workspace(client, auth, workspace_id)
        last_payload = payload
        status = payload.get("status")
        if status == target_status:
            return payload
        if status == "error":
            raise CloudE2ETestError(
                f"Workspace {workspace_id} entered error state: {payload.get('lastError')}"
            )
        await asyncio.sleep(5.0)
    raise CloudE2ETestError(
        f"Timed out waiting for workspace {workspace_id} to reach {target_status}; "
        f"last status was {last_payload.get('status') if last_payload else 'unknown'}."
    )


async def create_ready_cloud_workspace(
    client: httpx.AsyncClient,
    auth: AuthSession,
    db_session: AsyncSession,
    config: CloudTestConfig,
    *,
    provider_kind: str,
    branch_prefix: str,
) -> tuple[str, dict[str, object]]:
    last_error: Exception | None = None
    for attempt in range(2):
        branch_name = unique_branch_name(branch_prefix)
        workspace: dict[str, object] | None = None
        try:
            workspace = await create_cloud_workspace(
                client,
                auth,
                config,
                branch_name=branch_name,
            )
            workspace = await wait_for_cloud_workspace_status(
                client,
                auth,
                str(workspace["id"]),
                target_status="ready",
            )
            return branch_name, workspace
        except CloudE2ETestError as exc:
            last_error = exc
            if provider_kind != "daytona" or not _is_daytona_cpu_limit_error(exc):
                raise
            if workspace is not None:
                await force_delete_cloud_workspace_records(db_session, str(workspace["id"]))
            await cleanup_stale_provider_test_workspaces(
                db_session,
                provider_kind=provider_kind,
                github_owner=config.github_owner,
                github_repo=config.github_repo,
            )
            await cleanup_stale_daytona_test_sandboxes()
            if attempt == 0:
                await asyncio.sleep(15.0)
                continue
            raise

    assert last_error is not None
    raise last_error


async def get_cloud_connection(
    client: httpx.AsyncClient,
    auth: AuthSession,
    workspace_id: str,
) -> dict[str, object]:
    response = await client.get(
        f"/v1/cloud/workspaces/{workspace_id}/connection",
        headers=auth.headers,
    )
    if response.status_code == 401:
        auth = await refresh_auth_session(client, auth=auth)
        response = await client.get(
            f"/v1/cloud/workspaces/{workspace_id}/connection",
            headers=auth.headers,
        )
    response.raise_for_status()
    return response.json()


async def delete_cloud_workspace_quietly(
    client: httpx.AsyncClient,
    auth: AuthSession,
    workspace_id: str,
    *,
    db_session: AsyncSession | None = None,
) -> None:
    response = await client.delete(f"/v1/cloud/workspaces/{workspace_id}", headers=auth.headers)
    if response.status_code == 401:
        auth = await refresh_auth_session(client, auth=auth)
        response = await client.delete(
            f"/v1/cloud/workspaces/{workspace_id}",
            headers=auth.headers,
        )
    if response.status_code == 409:
        try:
            workspace = await get_cloud_workspace(client, auth, workspace_id)
            if workspace.get("status") == "stopped":
                start = await client.post(
                    f"/v1/cloud/workspaces/{workspace_id}/start",
                    headers=auth.headers,
                )
                if start.status_code == 401:
                    auth = await refresh_auth_session(client, auth=auth)
                    start = await client.post(
                        f"/v1/cloud/workspaces/{workspace_id}/start",
                        headers=auth.headers,
                    )
                start.raise_for_status()
                start_payload = start.json()
                if start_payload.get("status") != "ready":
                    await wait_for_cloud_workspace_status(
                        client,
                        auth,
                        workspace_id,
                        target_status="ready",
                    )
                auth = await refresh_auth_session(client, auth=auth)
                response = await client.delete(
                    f"/v1/cloud/workspaces/{workspace_id}",
                    headers=auth.headers,
                )
        except Exception:
            if db_session is None:
                raise
            await force_delete_cloud_workspace_records(db_session, workspace_id)
            return
    if response.status_code not in {200, 404}:
        if db_session is not None:
            await force_delete_cloud_workspace_records(db_session, workspace_id)
            return
        response.raise_for_status()


async def force_delete_cloud_workspace_records(
    db_session: AsyncSession,
    workspace_id: str,
) -> None:
    import uuid

    workspace = await db_session.get(CloudWorkspace, uuid.UUID(workspace_id))
    if workspace is None:
        return
    await db_session.refresh(workspace)
    if workspace.active_sandbox_id is not None:
        sandbox = await db_session.get(CloudSandbox, workspace.active_sandbox_id)
        if sandbox is not None and sandbox.external_sandbox_id:
            await db_session.refresh(sandbox)
            provider = get_sandbox_provider(sandbox.provider)
            with suppress(Exception):
                await provider.destroy_sandbox(sandbox.external_sandbox_id)
    await delete_cloud_workspace_records_for_workspace(workspace)


async def cleanup_stale_provider_test_workspaces(
    db_session: AsyncSession,
    *,
    provider_kind: str,
    github_owner: str,
    github_repo: str,
) -> None:
    provider = get_sandbox_provider(provider_kind)
    result = await db_session.execute(
        select(CloudWorkspace).where(
            CloudWorkspace.git_owner == github_owner,
            CloudWorkspace.git_repo_name == github_repo,
        )
    )
    workspaces = list(result.scalars())
    for workspace in workspaces:
        if workspace.active_sandbox_id is not None:
            sandbox = await db_session.get(CloudSandbox, workspace.active_sandbox_id)
            if (
                sandbox is not None
                and sandbox.provider == provider_kind
                and sandbox.external_sandbox_id
            ):
                with suppress(Exception):
                    await provider.destroy_sandbox(sandbox.external_sandbox_id)
        await delete_cloud_workspace_records_for_workspace(workspace)


async def provision_workspace_with_credentials(
    client: httpx.AsyncClient,
    db_session: AsyncSession,
    config: CloudTestConfig,
    *,
    provider_kind: str,
    synced_providers: tuple[str, ...],
    email_prefix: str,
    branch_prefix: str,
) -> WorkspaceHandle:
    ensure_provider_available(config, provider_kind)
    ensure_cloud_runtime_binary_ready()
    auth = await create_user_and_login(client, db_session, email_prefix=email_prefix)
    await link_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=config.github_token or "",
    )
    for provider in synced_providers:
        await sync_cloud_credential(client, auth, config, provider)

    _, workspace = await create_ready_cloud_workspace(
        client,
        auth,
        db_session,
        config,
        provider_kind=provider_kind,
        branch_prefix=branch_prefix,
    )
    auth = await refresh_auth_session(client, auth=auth)
    connection = await get_cloud_connection(client, auth, str(workspace["id"]))
    return WorkspaceHandle(
        auth=auth,
        workspace=workspace,
        connection=connection,
        synced_providers=synced_providers,
    )
