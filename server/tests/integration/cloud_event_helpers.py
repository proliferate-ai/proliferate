from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import cast
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def create_enrolled_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    suffix: str = "events",
) -> tuple[str, dict[str, str]]:
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token=f"gh-{suffix}-token",
    )
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=auth.headers,
        json={
            "displayName": f"Event Target {suffix}",
            "kind": "ssh",
            "ownerScope": "personal",
        },
    )
    assert create.status_code == 200
    enrollment = create.json()
    worker_enroll = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": enrollment["enrollmentToken"],
            "machineFingerprint": f"{suffix}-machine",
            "hostname": f"{suffix}-target",
            "workerVersion": "0.1.0",
        },
    )
    assert worker_enroll.status_code == 200
    worker = worker_enroll.json()
    worker_headers = {"Authorization": f"Bearer {worker['workerToken']}"}
    await accept_initial_git_identity_command(client, worker_headers)
    return enrollment["target"]["id"], worker_headers


async def accept_initial_git_identity_command(
    client: AsyncClient,
    worker_headers: dict[str, str],
) -> None:
    lease = await client.post(
        "/v1/cloud/worker/commands/lease",
        headers=worker_headers,
        json={"supportedKinds": ["configure_git_identity"], "leaseTimeoutSeconds": 300},
    )
    assert lease.status_code == 200
    command = lease.json()["command"]
    if command is None:
        return
    result = await client.post(
        f"/v1/cloud/worker/commands/{command['commandId']}/result",
        headers=worker_headers,
        json={
            "leaseId": command["leaseId"],
            "status": "accepted",
            "result": {"provider": "github"},
        },
    )
    assert result.status_code == 200


def sse_event(frame: str) -> str:
    for line in frame.splitlines():
        if line.startswith("event: "):
            return line.removeprefix("event: ")
    raise AssertionError(f"SSE frame has no event line: {frame}")


def sse_id(frame: str) -> str:
    for line in frame.splitlines():
        if line.startswith("id: "):
            return line.removeprefix("id: ")
    raise AssertionError(f"SSE frame has no id line: {frame}")


def sse_data(frame: str) -> dict[str, object]:
    for line in frame.splitlines():
        if line.startswith("data: "):
            value: object = json.loads(line.removeprefix("data: "))
            assert isinstance(value, dict)
            return cast("dict[str, object]", value)
    raise AssertionError(f"SSE frame has no data line: {frame}")


async def next_stream_frame(stream: AsyncIterator[str]) -> str:
    return await anext(stream)


def mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast("dict[str, object]", value)


async def seed_exposed_session_projection(
    db_session: AsyncSession,
    *,
    target_id: str,
    auth: AuthSession,
    workspace_id: str,
    session_id: str,
) -> None:
    target_uuid = UUID(target_id)
    billing_subject = await ensure_personal_billing_subject(db_session, auth.user_id)
    workspace = CloudWorkspace(
        user_id=auth.user_id,
        owner_scope="personal",
        owner_user_id=auth.user_id,
        organization_id=None,
        created_by_user_id=auth.user_id,
        billing_subject_id=billing_subject.id,
        target_id=target_uuid,
        display_name=f"Workspace {workspace_id}",
        git_provider="github",
        git_owner="acme",
        git_repo_name=workspace_id,
        normalized_repo_key=f"github/acme/{workspace_id}",
        git_branch="main",
        git_base_branch="main",
        worktree_path=f"/workspace/{workspace_id}",
        origin="manual_web",
        origin_json='{"kind":"human","entrypoint":"cloud"}',
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=0,
        anyharness_workspace_id=workspace_id,
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db_session.add(workspace)
    await db_session.flush()
    exposure = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_uuid,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace_id,
        owner_scope="personal",
        owner_user_id=auth.user_id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )
    await projections_store.upsert_session_projection_metadata(
        db_session,
        target_id=target_uuid,
        session_id=session_id,
        exposure_id=exposure.id,
        cloud_workspace_id=workspace.id,
        workspace_id=workspace_id,
        projection_level="live",
        commandable=True,
    )
    await db_session.commit()


async def seed_exposed_workspace(
    db_session: AsyncSession,
    *,
    target_id: str,
    auth: AuthSession,
    workspace_id: str,
) -> tuple[UUID, UUID]:
    target_uuid = UUID(target_id)
    billing_subject = await ensure_personal_billing_subject(db_session, auth.user_id)
    workspace = CloudWorkspace(
        user_id=auth.user_id,
        owner_scope="personal",
        owner_user_id=auth.user_id,
        organization_id=None,
        created_by_user_id=auth.user_id,
        billing_subject_id=billing_subject.id,
        target_id=target_uuid,
        display_name=f"Workspace {workspace_id}",
        git_provider="github",
        git_owner="acme",
        git_repo_name=workspace_id,
        normalized_repo_key=f"github/acme/{workspace_id}",
        git_branch="main",
        git_base_branch="main",
        worktree_path=f"/workspace/{workspace_id}",
        origin="manual_web",
        origin_json='{"kind":"human","entrypoint":"cloud"}',
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=0,
        anyharness_workspace_id=workspace_id,
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db_session.add(workspace)
    await db_session.flush()
    exposure = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_uuid,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace_id,
        owner_scope="personal",
        owner_user_id=auth.user_id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )
    await db_session.commit()
    return workspace.id, exposure.id
