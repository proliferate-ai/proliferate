"""Decisive end-to-end round-trip for the workspace-move (migration v2) stack.

One scenario, acting as the Desktop executor over HTTP, exercises the whole
local<->cloud<->local handoff on real infrastructure (a spawned local macOS
AnyHarness runtime + a real E2B sandbox driven through the real server API):

  1. Local: real Claude session on a plain-dir workspace learns a codeword.
  2. Move local->cloud via the server API (server provisions the sandbox
     worktree; the test freezes+exports the local runtime and hands the archive
     to ``/install``, then ``/cutover`` + ``/complete``).
  3. "Use it there": the migrated session keeps its native session id and its
     imported events in the sandbox, and recalls the codeword when prompted.
  4. Move cloud->local back (server exports from the sandbox; the test
     re-adopts the original local workspace with
     ``installMode=preserve_native_sessions``); the session recalls the
     codeword locally again.
  5. Both ``workspace_move`` rows end ``completed`` with
     ``canonical_side=destination``.

Skips cleanly without ``RUN_CLOUD_E2E=1`` (via the ``cloud_client`` fixture's
``require_live_cloud`` gate) and without an ``ANTHROPIC_API_KEY`` for the
sandbox's Claude. Runs under ``make test-cloud-e2b``. Follows the real-E2B
harness conventions in ``test_provisioning.py`` / ``helpers/``.
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
from proliferate.db.store import cloud_workspaces as cloud_workspace_store
from proliferate.db.store import repositories as repositories_store
from proliferate.integrations.anyharness.errors import CloudRuntimeReconnectError
from proliferate.integrations.anyharness.mobility import (
    export_runtime_mobility_archive,
    install_runtime_mobility_archive,
    set_runtime_mobility_state,
)
from proliferate.integrations.sandbox import get_sandbox_provider
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from tests.e2e.cloud.helpers.auth import create_user_and_login, refresh_auth_session
from tests.e2e.cloud.helpers.config import ensure_cloud_runtime_binary_ready
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.local_runtime import (
    cleanup_claude_project_slugs,
    clone_repo_on_new_branch,
    delete_remote_branch,
    spawn_local_runtime,
)
from tests.e2e.cloud.helpers.mobility_runtime import (
    runtime_create_plain_workspace,
    runtime_create_session,
    runtime_get_session,
    runtime_list_events,
    runtime_list_sessions,
    runtime_prompt_and_collect,
    turn_contains_text,
)
from tests.e2e.cloud.helpers.shared import AuthSession, CloudE2ETestError
from tests.e2e.cloud.helpers.workspaces import (
    create_ready_cloud_workspace,
    delete_cloud_workspace_quietly,
)

_LONG_OP_TIMEOUT_SECONDS = 900.0
_PROMPT_TIMEOUT_SECONDS = 180.0


@pytest.mark.asyncio
@pytest.mark.cloud_e2e
@pytest.mark.e2b
@pytest.mark.parametrize("provider_kind", ["e2b"])
async def test_workspace_move_round_trip_local_cloud_local(
    cloud_client: httpx.AsyncClient,
    db_session: AsyncSession,
    cloud_test_config,
    provider_kind: str,
    tmp_path: Path,
) -> None:
    if not cloud_test_config.anthropic_api_key:
        pytest.skip(
            "ANTHROPIC_API_KEY is required so the migrated session's Claude can "
            "run inside the sandbox (local turns use native ~/.claude)."
        )
    ensure_cloud_runtime_binary_ready()

    run_id = uuid.uuid4().hex[:10]
    branch = f"mig-e2e-{run_id}"
    codeword = f"PLUM-{run_id.upper()}"
    owner = cloud_test_config.github_owner
    repo = cloud_test_config.github_repo
    token = cloud_test_config.github_token
    assert token is not None

    scratch_root = tmp_path / f"mig-e2e-{run_id}"
    scratch_root.mkdir(parents=True, exist_ok=True)
    clone_path = scratch_root / f"clone-{run_id}"

    auth = await create_user_and_login(cloud_client, db_session, email_prefix=f"mig-{run_id}")
    user_uuid = uuid.UUID(auth.user_id)

    local_runtime = None
    warmup_workspace_id: str | None = None
    destination_workspace_id: str | None = None
    provider_sandbox_id: str | None = None
    slug_markers = [run_id, scratch_root.name, clone_path.name]

    try:
        # --- Prereqs: linked GitHub, sandbox Claude auth, repo config + cloud env ---
        await seed_linked_github_account(db_session, user_id=auth.user_id, access_token=token)
        await _seed_sandbox_claude_api_key(cloud_client, auth, cloud_test_config.anthropic_api_key)
        await _put_repo_config(cloud_client, auth, owner=owner, repo=repo)
        repo_config_id = await _require_repo_config_id(
            db_session, user_uuid, owner=owner, repo=repo
        )

        # A warmup cloud workspace boots the user's personal sandbox and
        # materializes its agent-auth (the move reuses that same sandbox).
        _, warmup = await create_ready_cloud_workspace(
            cloud_client,
            auth,
            db_session,
            cloud_test_config,
            provider_kind=provider_kind,
            branch_prefix=f"mig-warmup-{run_id}",
        )
        warmup_workspace_id = str(warmup["id"])
        provider_sandbox_id = await _sandbox_provider_id(db_session, user_uuid)

        # --- Local side: clone + branch + a real Claude session that learns the codeword ---
        base_sha = clone_repo_on_new_branch(
            owner=owner,
            repo=repo,
            base_branch=cloud_test_config.github_base_branch,
            branch=branch,
            token=token,
            dest=clone_path,
        )
        local_runtime = spawn_local_runtime("local", scratch_root=scratch_root)
        slug_markers.extend(local_runtime.markers)
        local_url, local_token = local_runtime.base_url, local_runtime.access_token

        resolved = await runtime_create_plain_workspace(
            local_url, local_token, path=str(clone_path)
        )
        local_ws_id = str(resolved["workspace"]["id"])
        session = await runtime_create_session(local_url, local_token, workspace_id=local_ws_id)
        session_id = str(session["id"])

        teach = await runtime_prompt_and_collect(
            local_url,
            local_token,
            session_id,
            f"Remember this codeword for later: {codeword}. Do not edit any files. "
            "Reply with exactly: STORED",
            timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
        )
        assert turn_contains_text(teach, "STORED"), "Local Claude did not store the codeword."
        local_session = await runtime_get_session(local_url, local_token, session_id)
        native_session_id = str(local_session["nativeSessionId"])
        assert native_session_id

        # --- Move 1: local -> cloud ------------------------------------------
        move1 = await _start_move(
            cloud_client,
            auth,
            repo_config_id=repo_config_id,
            branch=branch,
            base_commit_sha=base_sha,
            source=_local_ref(run_id, local_ws_id),
            destination={"kind": "cloud"},
            idempotency_key=f"{run_id}-local-to-cloud",
        )
        assert move1["phase"] == "destination_ready"
        move1_id = move1["id"]
        destination_workspace_id = str(move1["destinationRef"]["cloudWorkspaceId"])
        sandbox_ws_id = str(move1["destinationRef"]["anyharnessWorkspaceId"])

        # Freeze + export on the local runtime (requireCleanGitState + expected guards).
        await set_runtime_mobility_state(
            local_url, local_token,
            anyharness_workspace_id=local_ws_id, mode="frozen_for_handoff", handoff_op_id=move1_id,
        )
        await _assert_export_guard_rejects_mismatch(
            local_url, local_token, local_ws_id, base_sha, branch
        )
        archive1 = await export_runtime_mobility_archive(
            local_url, local_token,
            anyharness_workspace_id=local_ws_id,
            expected_handoff_op_id=move1_id,
            expected_base_commit_sha=base_sha,
            expected_branch_name=branch,
        )

        install1 = await _move_phase(
            cloud_client, auth, move1_id, "install", body={"archive": archive1}
        )
        assert install1["phase"] == "installed"
        cutover1 = await _move_phase(cloud_client, auth, move1_id, "cutover")
        assert cutover1["phase"] == "cutover" and cutover1["canonicalSide"] == "destination"

        # Source fate: the local ws is a plain directory -> remote_owned only (files untouched).
        await set_runtime_mobility_state(
            local_url, local_token, anyharness_workspace_id=local_ws_id, mode="remote_owned"
        )
        complete1 = await _move_phase(cloud_client, auth, move1_id, "complete")
        assert complete1["phase"] == "completed" and complete1["canonicalSide"] == "destination"

        # --- Use it there: the migrated session resumes natively in the sandbox ---
        sandbox_url, sandbox_token = await _sandbox_runtime_access(db_session, user_uuid)
        sandbox_session = await runtime_get_session(sandbox_url, sandbox_token, session_id)
        assert sandbox_session["nativeSessionId"] == native_session_id
        assert len(await runtime_list_events(sandbox_url, sandbox_token, session_id)) > 0

        recall_cloud = await runtime_prompt_and_collect(
            sandbox_url, sandbox_token, session_id,
            "What is the codeword I asked you to remember? Do not edit any files. "
            "Reply with exactly that word and nothing else.",
            timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
        )
        assert turn_contains_text(recall_cloud, codeword), (
            "Migrated session did not recall the codeword in the sandbox."
        )

        # --- Move 2: cloud -> local (round trip home via re-adopt) -----------
        move2 = await _start_move(
            cloud_client,
            auth,
            repo_config_id=repo_config_id,
            branch=branch,
            base_commit_sha=base_sha,
            source={
                "kind": "cloud",
                "cloudWorkspaceId": destination_workspace_id,
                "anyharnessWorkspaceId": sandbox_ws_id,
            },
            destination=_local_ref(run_id, local_ws_id),
            idempotency_key=f"{run_id}-cloud-to-local",
        )
        assert move2["phase"] == "destination_ready"
        move2_id = move2["id"]

        export2 = await _move_phase(cloud_client, auth, move2_id, "export")
        archive2 = export2["archive"]

        # Re-adopt the original local workspace (still remote_owned) in place.
        readopt = await install_runtime_mobility_archive(
            local_url, local_token,
            anyharness_workspace_id=local_ws_id,
            archive=archive2,
            operation_id=move2_id,
            install_mode="preserve_native_sessions",
        )
        assert session_id in readopt.imported_session_ids

        install2 = await _move_phase(cloud_client, auth, move2_id, "install", body={})
        assert install2["phase"] == "installed"
        cutover2 = await _move_phase(cloud_client, auth, move2_id, "cutover")
        assert cutover2["canonicalSide"] == "destination"
        complete2 = await _move_phase(cloud_client, auth, move2_id, "complete")
        assert complete2["phase"] == "completed" and complete2["canonicalSide"] == "destination"

        # Install leaves the workspace remote_owned; flip to normal to prompt.
        await set_runtime_mobility_state(
            local_url, local_token, anyharness_workspace_id=local_ws_id, mode="normal"
        )
        sessions_local = await runtime_list_sessions(
            local_url, local_token, workspace_id=local_ws_id
        )
        assert any(str(item.get("id")) == session_id for item in sessions_local)
        home_session = await runtime_get_session(local_url, local_token, session_id)
        assert str(home_session["nativeSessionId"]) == native_session_id

        recall_local = await runtime_prompt_and_collect(
            local_url, local_token, session_id,
            "One more time: what is the codeword? Do not edit any files. "
            "Reply with exactly that word and nothing else.",
            timeout_seconds=_PROMPT_TIMEOUT_SECONDS,
        )
        assert turn_contains_text(recall_local, codeword), (
            "Re-adopted session did not recall the codeword locally."
        )

        # --- Ledger + cloud-source cleanup assertions ------------------------
        for move_id in (move1_id, move2_id):
            row = await _get_move(cloud_client, auth, move_id)
            assert row["phase"] == "completed", move_id
            assert row["canonicalSide"] == "destination", move_id

        archived = await cloud_workspace_store.get_cloud_workspace_for_user(
            db_session, user_uuid, uuid.UUID(destination_workspace_id)
        )
        assert archived is None or archived.archived_at is not None, (
            "cloud->local complete should archive the source cloud workspace."
        )

    finally:
        await _teardown(
            cloud_client,
            auth,
            db_session,
            provider_kind=provider_kind,
            local_runtime=local_runtime,
            slug_markers=slug_markers,
            provider_sandbox_id=provider_sandbox_id,
            workspace_ids=[warmup_workspace_id, destination_workspace_id],
            owner=owner,
            repo=repo,
            branch=branch,
            token=token,
            clone_path=clone_path,
        )


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


def _local_ref(run_id: str, anyharness_workspace_id: str) -> dict[str, Any]:
    return {
        "kind": "local",
        "desktopInstallId": f"e2e-{run_id}",
        "anyharnessWorkspaceId": anyharness_workspace_id,
    }


async def _start_move(
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


async def _move_phase(
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


async def _get_move(client: httpx.AsyncClient, auth: AuthSession, move_id: str) -> dict[str, Any]:
    return await _server_json(
        client, auth, "GET", f"/v1/cloud/workspace-moves/{move_id}", timeout=60.0
    )


async def _put_repo_config(
    client: httpx.AsyncClient, auth: AuthSession, *, owner: str, repo: str
) -> None:
    await _server_json(
        client,
        auth,
        "PUT",
        f"/v1/cloud/repos/{owner}/{repo}/config",
        body={"configured": True, "envVars": {}, "setupScript": "", "files": []},
        timeout=120.0,
    )


async def _seed_sandbox_claude_api_key(
    client: httpx.AsyncClient, auth: AuthSession, anthropic_api_key: str
) -> None:
    """Give the user's cloud sandbox a Claude api-key route so the migrated
    session can run Claude there (the authorized fallback from the spec's
    §3 sandbox agent-auth path -- done via the product API, not raw file
    injection). Local turns use native ~/.claude and need nothing here."""
    key = await _server_json(
        client,
        auth,
        "POST",
        "/v1/cloud/agent-gateway/api-keys",
        body={"provider": "anthropic", "displayName": "mig-e2e", "secret": anthropic_api_key},
        timeout=60.0,
    )
    await _server_json(
        client,
        auth,
        "PUT",
        "/v1/cloud/agent-gateway/route-selections/claude/cloud",
        body={"route": "api_key", "apiKeyId": key["id"], "slot": "primary"},
        timeout=60.0,
    )


async def _assert_export_guard_rejects_mismatch(
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


async def _require_repo_config_id(
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


async def _sandbox_provider_id(db: AsyncSession, user_id: uuid.UUID) -> str | None:
    row = await _sandbox_row(db, user_id)
    return row.provider_sandbox_id if row is not None else None


async def _sandbox_runtime_access(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, str]:
    sandbox = await cloud_sandbox_store.load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        raise CloudE2ETestError("Personal cloud sandbox is missing after the move.")
    runtime_url, runtime_token, _data_key = (
        await cloud_sandboxes_service.load_cloud_sandbox_runtime_access(sandbox)
    )
    return runtime_url, runtime_token


async def _teardown(
    client: httpx.AsyncClient,
    auth: AuthSession,
    db: AsyncSession,
    *,
    provider_kind: str,
    local_runtime: Any,
    slug_markers: list[str],
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
