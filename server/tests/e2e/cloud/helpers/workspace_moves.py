"""HTTP + resource helpers for the workspace-move (migration v2) e2e round-trip.

Relocated verbatim from ``test_workspace_moves.py`` to keep that test module
under the repo-shape line budget -- pure helpers, no behavior change. The test
drives the whole saga as the Desktop executor through these thin wrappers over
the server API, plus the DB/resource lookups and teardown it needs.
"""

from __future__ import annotations

import contextlib
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as cloud_sandbox_store
from proliferate.db.store import repositories as repositories_store
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.mobility import export_runtime_mobility_archive
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from tests.e2e.cloud.helpers.auth import refresh_auth_session
from tests.e2e.cloud.helpers.local_runtime import (
    cleanup_claude_project_slugs,
    cleanup_codex_rollouts,
    delete_remote_branch,
)
from tests.e2e.cloud.helpers.shared import AuthSession, CloudE2ETestError
from tests.e2e.cloud.helpers.workspaces import delete_cloud_workspace_quietly

_LONG_OP_TIMEOUT_SECONDS = 900.0


# --- server API helpers ------------------------------------------------------


async def _server_json(
    client: httpx.AsyncClient,
    auth: AuthSession,
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    timeout: float = _LONG_OP_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    for attempt in range(2):
        response = await client.request(
            method, path, headers=auth.headers, json=body, timeout=timeout
        )
        if response.status_code == 401 and attempt == 0:
            await refresh_auth_session(client, auth=auth)
            continue
        if response.status_code >= 400:
            raise CloudE2ETestError(
                f"{method} {path} failed ({response.status_code}): {response.text.strip()}"
            )
        if response.status_code == 204 or not response.content:
            return {}
        return response.json()
    raise CloudE2ETestError(f"{method} {path} kept returning 401 after refresh.")


def local_ref(run_id: str, anyharness_workspace_id: str) -> dict[str, Any]:
    return {
        "kind": "local",
        "desktopInstallId": f"e2e-{run_id}",
        "anyharnessWorkspaceId": anyharness_workspace_id,
    }


async def start_move(
    client: httpx.AsyncClient,
    auth: AuthSession,
    *,
    repo_config_id: str,
    branch: str,
    base_commit_sha: str,
    source: dict[str, Any],
    destination: dict[str, Any],
    idempotency_key: str,
) -> dict[str, Any]:
    return await _server_json(
        client,
        auth,
        "POST",
        "/v1/cloud/workspace-moves",
        body={
            "repoConfigId": repo_config_id,
            "branch": branch,
            "baseCommitSha": base_commit_sha,
            "source": source,
            "destination": destination,
            "idempotencyKey": idempotency_key,
        },
    )


async def move_phase(
    client: httpx.AsyncClient,
    auth: AuthSession,
    move_id: str,
    phase: str,
    *,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return await _server_json(
        client, auth, "POST", f"/v1/cloud/workspace-moves/{move_id}/{phase}", body=body or {}
    )


async def get_move(client: httpx.AsyncClient, auth: AuthSession, move_id: str) -> dict[str, Any]:
    return await _server_json(
        client, auth, "GET", f"/v1/cloud/workspace-moves/{move_id}", timeout=60.0
    )


async def put_repo_config(
    client: httpx.AsyncClient, auth: AuthSession, *, owner: str, repo: str, base_branch: str
) -> None:
    # Saving the cloud repo environment upserts the underlying repo_config and
    # the cloud RepoEnvironment the move needs (``_require_cloud_repo_environment``).
    # This is the same call ``create_cloud_workspace`` makes; running it here just
    # pins the repo_config before we read its id, and the later warmup re-upserts
    # it idempotently.
    await _server_json(
        client,
        auth,
        "PUT",
        f"/v1/cloud/repositories/{owner}/{repo}/environment",
        body={
            "kind": "cloud",
            "gitProvider": "github",
            "defaultBranch": base_branch,
            "setupScript": "",
            "runCommand": "",
        },
        timeout=120.0,
    )


async def _seed_sandbox_api_key_route(
    client: httpx.AsyncClient,
    auth: AuthSession,
    *,
    title: str,
    secret: str,
    harness_kind: str,
    env_var_name: str,
) -> None:
    """Route a harness through an api-key credential on the ``cloud`` surface,
    via the agent-auth vault API (#907 titled-key vault + env-var selections):
    create a titled key, then select it for the harness. Done through the
    product API, not raw file injection.
    """
    key = await _server_json(
        client,
        auth,
        "POST",
        "/v1/cloud/agent-gateway/keys",
        body={"title": title, "value": secret},
        timeout=60.0,
    )
    await _server_json(
        client,
        auth,
        "PUT",
        f"/v1/cloud/agent-gateway/selections/{harness_kind}?surface=cloud",
        body={
            "sources": [
                {
                    "sourceKind": "api_key",
                    "apiKeyId": key["id"],
                    "envVarName": env_var_name,
                    "enabled": True,
                }
            ]
        },
        timeout=60.0,
    )


async def seed_sandbox_claude_api_key(
    client: httpx.AsyncClient, auth: AuthSession, anthropic_api_key: str
) -> None:
    """Give the user's cloud sandbox a Claude api-key route so the migrated
    session can run Claude there (the authorized fallback from the spec's
    §3 sandbox agent-auth path). Local turns use native ~/.claude and need
    nothing here."""
    await _seed_sandbox_api_key_route(
        client,
        auth,
        title="mig-e2e-claude",
        secret=anthropic_api_key,
        harness_kind="claude",
        env_var_name="ANTHROPIC_API_KEY",
    )


async def seed_sandbox_codex_api_key(
    client: httpx.AsyncClient, auth: AuthSession, openai_api_key: str
) -> None:
    """Codex twin of :func:`seed_sandbox_claude_api_key`.

    The migrated Codex rollout is only visible to ``resume`` when the sandbox
    launch scans the runtime-local ``codex-local`` CODEX_HOME (where the install
    mirror lands). The api_key route is exactly the route that keeps that home:
    it sets ``OPENAI_API_KEY`` and does NOT override ``CODEX_HOME`` (the gateway
    route would repoint CODEX_HOME at a revision dir the install can't pre-seed).
    So route Codex through api_key/openai, mirroring the Claude api_key seed.
    Local Codex turns use the machine's native ~/.codex login and need nothing
    here."""
    await _seed_sandbox_api_key_route(
        client,
        auth,
        title="mig-e2e-codex",
        secret=openai_api_key,
        harness_kind="codex",
        env_var_name="OPENAI_API_KEY",
    )


async def assert_export_guard_rejects_mismatch(
    runtime_url: str, access_token: str, workspace_id: str, base_sha: str, branch: str
) -> None:
    """E1b guard chain: a mismatched handoff-op is refused even when frozen+clean."""
    with pytest.raises(CloudRuntimeReconnectError):
        await export_runtime_mobility_archive(
            runtime_url,
            access_token,
            anyharness_workspace_id=workspace_id,
            expected_handoff_op_id="not-the-real-handoff-op",
            expected_base_commit_sha=base_sha,
            expected_branch_name=branch,
        )


# --- database + resource helpers ---------------------------------------------


async def require_repo_config_id(
    db: AsyncSession, user_id: uuid.UUID, *, owner: str, repo: str
) -> str:
    config = await repositories_store.get_repo_config_for_user(
        db, user_id=user_id, git_provider="github", git_owner=owner, git_repo_name=repo
    )
    if config is None:
        raise CloudE2ETestError("Repo config was not created for the test user.")
    return str(config.id)


async def _sandbox_row(db: AsyncSession, user_id: uuid.UUID) -> CloudSandbox | None:
    return (
        await db.execute(
            select(CloudSandbox).where(
                CloudSandbox.owner_user_id == user_id,
                CloudSandbox.destroyed_at.is_(None),
            )
        )
    ).scalar_one_or_none()


async def sandbox_provider_id(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    row = await _sandbox_row(db, user_id)
    return row.provider_sandbox_id if row is not None else None


async def sandbox_runtime_access(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, str]:
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        raise CloudE2ETestError("Personal cloud sandbox is missing after the move.")
    (
        runtime_url,
        runtime_token,
        _data_key,
    ) = await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)
    return runtime_url, runtime_token


async def teardown(
    client: httpx.AsyncClient,
    auth: AuthSession,
    db: AsyncSession,
    *,
    provider_kind: str,
    local_runtime: Any,
    slug_markers: list[str],
    codex_native_session_ids: list[str],
    provider_sandbox_id: str | None,
    workspace_ids: list[str | None],
    owner: str,
    repo: str,
    branch: str,
    token: str | None,
    clone_path: Path,
) -> None:
    if local_runtime is not None:
        _safely(local_runtime.close)
    _safely(lambda: cleanup_claude_project_slugs(slug_markers))
    _safely(lambda: cleanup_codex_rollouts(codex_native_session_ids))

    for workspace_id in workspace_ids:
        if workspace_id:
            await _safely_async(
                delete_cloud_workspace_quietly(client, auth, workspace_id, db_session=db)
            )

    await _safely_async(
        _server_json(client, auth, "DELETE", "/v1/cloud/cloud-sandbox", timeout=120.0)
    )
    if provider_sandbox_id:
        provider = get_sandbox_provider(provider_kind)
        await _safely_async(provider.destroy_sandbox(provider_sandbox_id))

    if token:
        _safely(
            lambda: delete_remote_branch(
                owner=owner, repo=repo, branch=branch, token=token, cwd=clone_path
            )
        )


def _safely(fn: Any) -> None:
    # Cleanup must never mask the test result.
    with contextlib.suppress(Exception):
        fn()


async def _safely_async(awaitable: Any) -> None:
    # Cleanup must never mask the test result.
    with contextlib.suppress(Exception):
        await awaitable
