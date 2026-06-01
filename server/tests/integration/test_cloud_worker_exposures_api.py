from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.db.store.cloud_sync import worker_exposures as worker_exposures_store
from proliferate.server.cloud.live.service import publish_worker_control_after_commit
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
    exposures = sorted(
        body["exposures"],
        key=lambda row: (
            row["anyharnessSessionId"] is None,
            row["anyharnessSessionId"] or "",
        ),
    )
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
        {
            "exposureId": str(exposure.id),
            "targetId": str(target_id),
            "cloudWorkspaceId": str(workspace.id),
            "sessionProjectionId": None,
            "anyharnessWorkspaceId": "workspace-1",
            "anyharnessSessionId": None,
            "projectionLevel": "live",
            "commandable": True,
            "status": "active",
            "revision": 1,
            "lastUploadedSeq": 0,
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


@pytest.mark.asyncio
async def test_worker_control_wait_returns_cursor_and_leases_commands(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-control",
    )
    target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

    initial = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={
            "supportedKinds": ["materialize_environment"],
            "leaseTimeoutSeconds": 30,
            "waitSeconds": 0,
        },
    )
    assert initial.status_code == 200, initial.text
    initial_body = initial.json()
    assert initial_body["reason"] == "exposures"
    assert initial_body["command"] is None
    assert initial_body["exposures"] == []
    assert initial_body["controlCursor"].startswith("v1:")

    command = await commands_store.create_command(
        db_session,
        idempotency_scope=f"test:{target_id}",
        idempotency_key="control-wait-command",
        target_id=target_id,
        organization_id=None,
        actor_user_id=auth.user_id,
        actor_kind="user",
        source="api",
        workspace_id=None,
        session_id=None,
        cloud_workspace_id=None,
        kind="materialize_environment",
        payload_json="{}",
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    await db_session.commit()

    leased = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={
            "supportedKinds": ["materialize_environment"],
            "leaseTimeoutSeconds": 30,
            "controlCursor": initial_body["controlCursor"],
            "waitSeconds": 0,
        },
    )
    assert leased.status_code == 200, leased.text
    leased_body = leased.json()
    assert leased_body["reason"] == "command"
    assert leased_body["exposures"] is None
    assert leased_body["command"]["commandId"] == str(command.id)
    assert leased_body["command"]["kind"] == "materialize_environment"
    assert leased_body["controlCursor"] != initial_body["controlCursor"]


@pytest.mark.asyncio
async def test_worker_control_wait_recovers_ahead_cursor_with_exposure_snapshot(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-control-ahead",
    )
    target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

    response = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={
            "supportedKinds": ["materialize_environment"],
            "controlCursor": f"v1:{target_id}:999:0",
            "waitSeconds": 0,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reason"] == "exposures"
    assert body["exposures"] == []


@pytest.mark.asyncio
async def test_worker_control_wait_long_poll_wakes_on_command_publish(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-control-long-poll",
    )
    target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
    initial = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={"supportedKinds": ["materialize_environment"], "waitSeconds": 0},
    )
    assert initial.status_code == 200, initial.text
    wait_task = asyncio.create_task(
        client.post(
            "/v1/cloud/worker/control/wait",
            headers=worker_headers,
            json={
                "supportedKinds": ["materialize_environment"],
                "leaseTimeoutSeconds": 30,
                "controlCursor": initial.json()["controlCursor"],
                "waitSeconds": 2,
            },
        )
    )
    await asyncio.sleep(0.1)
    command = await commands_store.create_command(
        db_session,
        idempotency_scope=f"test:{target_id}",
        idempotency_key="control-wait-long-poll-command",
        target_id=target_id,
        organization_id=None,
        actor_user_id=auth.user_id,
        actor_kind="user",
        source="api",
        workspace_id=None,
        session_id=None,
        cloud_workspace_id=None,
        kind="materialize_environment",
        payload_json="{}",
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    await publish_worker_control_after_commit(db_session, target_id=target_id, reason="command")
    await db_session.commit()

    response = await wait_task
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reason"] == "command"
    assert body["command"]["commandId"] == str(command.id)


@pytest.mark.asyncio
async def test_worker_control_wait_does_not_fetch_exposures_for_current_cursor(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-control-current",
    )
    _target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
    initial = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={"supportedKinds": ["materialize_environment"], "waitSeconds": 0},
    )
    assert initial.status_code == 200, initial.text
    cursor = initial.json()["controlCursor"]

    async def fail_exposure_fetch(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise AssertionError("current cursor should not fetch exposure snapshots")

    monkeypatch.setattr(
        worker_exposures_store,
        "list_worker_exposure_snapshots_for_target",
        fail_exposure_fetch,
    )

    response = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={
            "supportedKinds": ["materialize_environment"],
            "controlCursor": cursor,
            "waitSeconds": 1,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reason"] == "timeout"
    assert body["exposures"] is None
    assert body["controlCursor"] == cursor


@pytest.mark.asyncio
async def test_worker_control_wait_blocker_transition_advances_cursor(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-control-blocker",
    )
    target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
    initial = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={"supportedKinds": ["start_session"], "waitSeconds": 0},
    )
    assert initial.status_code == 200, initial.text

    command = await commands_store.create_command(
        db_session,
        idempotency_scope=f"test:{target_id}",
        idempotency_key="control-wait-invalid-start-session",
        target_id=target_id,
        organization_id=None,
        actor_user_id=auth.user_id,
        actor_kind="user",
        source="api",
        workspace_id=None,
        session_id=None,
        cloud_workspace_id=None,
        kind="start_session",
        payload_json="{",
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    await db_session.commit()

    response = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={
            "supportedKinds": ["start_session"],
            "controlCursor": initial.json()["controlCursor"],
            "waitSeconds": 0,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reason"] == "state_changed"
    assert body["controlCursor"] != initial.json()["controlCursor"]

    rejected = await commands_store.get_command_by_id(db_session, command.id)
    assert rejected is not None
    assert rejected.status == "rejected"
    assert rejected.error_code == "runtime_config_payload_invalid"


def test_worker_exposure_fingerprint_ignores_upload_progress() -> None:
    exposure_id = uuid4()
    target_id = uuid4()
    cloud_workspace_id = uuid4()
    projection_id = uuid4()
    base = worker_exposures_store.WorkerExposureSnapshot(
        exposure_id=exposure_id,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        session_projection_id=projection_id,
        anyharness_workspace_id="workspace-1",
        anyharness_session_id="session-1",
        projection_level="live",
        commandable=True,
        status="active",
        revision=1,
        last_uploaded_seq=7,
    )
    advanced = worker_exposures_store.WorkerExposureSnapshot(
        exposure_id=exposure_id,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        session_projection_id=projection_id,
        anyharness_workspace_id="workspace-1",
        anyharness_session_id="session-1",
        projection_level="live",
        commandable=True,
        status="active",
        revision=1,
        last_uploaded_seq=12,
    )
    assert worker_exposures_store.exposure_fingerprint_hash(
        (base,)
    ) == worker_exposures_store.exposure_fingerprint_hash((advanced,))
