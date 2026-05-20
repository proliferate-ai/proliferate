from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
) -> tuple[UUID, dict[str, str]]:
    await seed_linked_github_account(
        db_session,
        user_id=auth.user_id,
        access_token="gh-worker-exposures-token",
    )
    create = await client.post(
        "/v1/cloud/targets/enrollments",
        headers=auth.headers,
        json={
            "displayName": "Worker Exposures Target",
            "kind": "desktop_dispatch",
            "ownerScope": "personal",
        },
    )
    assert create.status_code == 200
    enrollment = create.json()
    worker_enroll = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": enrollment["enrollmentToken"],
            "machineFingerprint": "worker-exposures-machine",
            "hostname": "worker-exposures-target",
            "workerVersion": "0.1.0",
        },
    )
    assert worker_enroll.status_code == 200
    worker = worker_enroll.json()
    return UUID(enrollment["target"]["id"]), {"Authorization": f"Bearer {worker['workerToken']}"}


@pytest.mark.asyncio
async def test_worker_exposures_returns_active_projection_cursors(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-exposures",
    )
    target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
    billing_subject = await ensure_personal_billing_subject(db_session, auth.user_id)
    workspace = CloudWorkspace(
        user_id=auth.user_id,
        owner_scope="personal",
        owner_user_id=auth.user_id,
        organization_id=None,
        created_by_user_id=auth.user_id,
        billing_subject_id=billing_subject.id,
        target_id=target_id,
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        normalized_repo_key="github/acme/rocket",
        git_branch="main",
        git_base_branch="main",
        worktree_path="/workspace/rocket",
        origin="manual_web",
        origin_json='{"kind":"human","entrypoint":"cloud"}',
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=0,
        anyharness_workspace_id="workspace-1",
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db_session.add(workspace)
    await db_session.flush()
    exposure = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        owner_scope="personal",
        owner_user_id=auth.user_id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )
    projection = await projections_store.upsert_session_projection_metadata(
        db_session,
        target_id=target_id,
        session_id="session-1",
        exposure_id=exposure.id,
        cloud_workspace_id=workspace.id,
        workspace_id="workspace-1",
        projection_level="live",
        commandable=True,
    )
    await projections_store.update_projection_last_uploaded_seq(
        db_session,
        target_id=target_id,
        session_id="session-1",
        last_uploaded_seq=7,
    )
    second_projection = await projections_store.upsert_session_projection_metadata(
        db_session,
        target_id=target_id,
        session_id="session-2",
        exposure_id=exposure.id,
        cloud_workspace_id=workspace.id,
        workspace_id="workspace-1",
        projection_level="live",
        commandable=True,
    )
    await projections_store.update_projection_last_uploaded_seq(
        db_session,
        target_id=target_id,
        session_id="session-2",
        last_uploaded_seq=3,
    )
    await projections_store.upsert_session_projection_metadata(
        db_session,
        target_id=target_id,
        session_id="session-unexposed",
        exposure_id=None,
        cloud_workspace_id=workspace.id,
        workspace_id="workspace-1",
        projection_level="live",
        commandable=True,
    )
    await db_session.commit()

    response = await client.get(
        "/v1/cloud/worker/exposures",
        headers=worker_headers,
    )

    assert response.status_code == 200
    body = response.json()
    exposures = sorted(body["exposures"], key=lambda row: row["anyharnessSessionId"])
    assert exposures == [
        {
            "exposureId": str(exposure.id),
            "targetId": str(target_id),
            "cloudWorkspaceId": str(workspace.id),
            "sessionProjectionId": str(projection.id),
            "anyharnessWorkspaceId": "workspace-1",
            "anyharnessSessionId": "session-1",
            "projectionLevel": "live",
            "commandable": True,
            "status": "active",
            "revision": 1,
            "lastUploadedSeq": 7,
        },
        {
            "exposureId": str(exposure.id),
            "targetId": str(target_id),
            "cloudWorkspaceId": str(workspace.id),
            "sessionProjectionId": str(second_projection.id),
            "anyharnessWorkspaceId": "workspace-1",
            "anyharnessSessionId": "session-2",
            "projectionLevel": "live",
            "commandable": True,
            "status": "active",
            "revision": 1,
            "lastUploadedSeq": 3,
        },
    ]

    gap = await client.post(
        "/v1/cloud/worker/events/gaps",
        headers=worker_headers,
        json={
            "exposureId": str(exposure.id),
            "sessionProjectionId": str(projection.id),
            "sessionId": "session-1",
            "expectedSeq": 8,
            "firstObservedSeq": 10,
            "lastUploadedSeq": 7,
        },
    )
    assert gap.status_code == 200
    assert gap.json() == {"updated": True}
    updated = await projections_store.get_session_projection_metadata(
        db_session,
        target_id=target_id,
        session_id="session-1",
    )
    assert updated is not None
    assert updated.gap_state_json is not None
    assert "anyharness_event_sequence_gap" in updated.gap_state_json

    await projections_store.clear_projection_gap_state(
        db_session,
        target_id=target_id,
        session_id="session-1",
    )
    await projections_store.update_projection_last_uploaded_seq(
        db_session,
        target_id=target_id,
        session_id="session-1",
        last_uploaded_seq=12,
    )
    await db_session.commit()
    stale_gap = await client.post(
        "/v1/cloud/worker/events/gaps",
        headers=worker_headers,
        json={
            "exposureId": str(exposure.id),
            "sessionProjectionId": str(projection.id),
            "sessionId": "session-1",
            "expectedSeq": 8,
            "firstObservedSeq": 10,
            "lastUploadedSeq": 7,
        },
    )
    assert stale_gap.status_code == 200
    assert stale_gap.json() == {"updated": False}
    repaired = await projections_store.get_session_projection_metadata(
        db_session,
        target_id=target_id,
        session_id="session-1",
    )
    assert repaired is not None
    assert repaired.gap_state_json is None
