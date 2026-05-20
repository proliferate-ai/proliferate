from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, AsyncIterator
from typing import cast
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.integrations.pubsub.models import PubSubMessage
from proliferate.integrations.pubsub.redis import get_pubsub_bus
from proliferate.server.cloud.live.domain.channels import target_channel
from proliferate.server.cloud.live.service import (
    stream_session_events,
    stream_target_events,
    stream_workspace_events,
)
from proliferate.server.cloud.workspaces.service import get_cloud_workspace_detail
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
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
    await _accept_initial_git_identity_command(client, worker_headers)
    return enrollment["target"]["id"], worker_headers


async def _accept_initial_git_identity_command(
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


def _sse_event(frame: str) -> str:
    for line in frame.splitlines():
        if line.startswith("event: "):
            return line.removeprefix("event: ")
    raise AssertionError(f"SSE frame has no event line: {frame}")


def _sse_id(frame: str) -> str:
    for line in frame.splitlines():
        if line.startswith("id: "):
            return line.removeprefix("id: ")
    raise AssertionError(f"SSE frame has no id line: {frame}")


def _sse_data(frame: str) -> dict[str, object]:
    for line in frame.splitlines():
        if line.startswith("data: "):
            value: object = json.loads(line.removeprefix("data: "))
            assert isinstance(value, dict)
            return cast("dict[str, object]", value)
    raise AssertionError(f"SSE frame has no data line: {frame}")


async def _next_stream_frame(stream: AsyncIterator[str]) -> str:
    return await anext(stream)


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return cast("dict[str, object]", value)


async def _seed_exposed_session_projection(
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


class TestCloudEventSyncApi:
    @pytest.mark.asyncio
    async def test_worker_event_batch_dedupes_and_updates_session_snapshot(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-event-sync",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
        await _seed_exposed_session_projection(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-1",
            session_id="session-1",
        )

        batch = {
            "events": [
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 1,
                    "timestamp": "2026-05-13T00:00:00Z",
                    "event": {
                        "type": "session_started",
                        "nativeSessionId": "native-1",
                        "sourceAgentKind": "codex",
                    },
                },
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 2,
                    "timestamp": "2026-05-13T00:00:01Z",
                    "itemId": "item-1",
                    "event": {"type": "item_delta", "delta": {"appendText": "hel"}},
                },
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 3,
                    "timestamp": "2026-05-13T00:00:02Z",
                    "event": {"type": "turn_started"},
                },
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 4,
                    "timestamp": "2026-05-13T00:00:03Z",
                    "turnId": "turn-1",
                    "itemId": "item-1",
                    "event": {
                        "type": "item_completed",
                        "item": {
                            "kind": "assistant_message",
                            "status": "completed",
                            "sourceAgentKind": "codex",
                            "rawInput": {"secret": "do-not-store"},
                            "contentParts": [{"type": "text", "text": "hello"}],
                        },
                    },
                },
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 5,
                    "timestamp": "2026-05-13T00:00:04Z",
                    "event": {
                        "type": "interaction_requested",
                        "requestId": "interaction-1",
                        "kind": "permission",
                        "title": "Approve command",
                        "description": "Agent wants to run tests.",
                        "source": {},
                        "payload": {
                            "type": "permission",
                            "options": [
                                {
                                    "optionId": "allow_once",
                                    "label": "Allow",
                                    "kind": "allow_once",
                                }
                            ],
                        },
                    },
                },
            ]
        }
        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json=batch,
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["acceptedEvents"] == 4
        assert uploaded.json()["liveOnlyEvents"] == 1
        assert uploaded.json()["sessionAcks"] == [
            {"sessionId": "session-1", "lastContiguousSeq": 5}
        ]

        duplicate = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json=batch,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["acceptedEvents"] == 0
        assert duplicate.json()["duplicateEvents"] == 4
        assert duplicate.json()["sessionAcks"] == [
            {"sessionId": "session-1", "lastContiguousSeq": 5}
        ]

        snapshot = await client.get(
            f"/v1/cloud/sessions/session-1/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        body = snapshot.json()
        assert body["session"]["sessionId"] == "session-1"
        assert body["session"]["sourceAgentKind"] == "codex"
        assert body["session"]["lastEventSeq"] == 5
        assert body["transcriptItems"][0]["text"] == "hello"
        assert body["transcriptItems"][0]["payload"]["event"]["item"]["rawInput"]["retention"] == (
            "stripped"
        )
        assert body["pendingInteractions"][0]["requestId"] == "interaction-1"
        assert body["pendingInteractions"][0]["title"] == "Approve command"

        snapshot_alias = await client.get(
            f"/v1/cloud/sessions/session-1?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot_alias.status_code == 200
        assert snapshot_alias.json()["session"]["sessionId"] == "session-1"

        transcript = await client.get(
            f"/v1/cloud/sessions/session-1/transcript?targetId={target_id}",
            headers=auth.headers,
        )
        assert transcript.status_code == 200
        assert transcript.json()["transcriptItems"][0]["text"] == "hello"
        assert transcript.json()["pendingInteractions"][0]["requestId"] == "interaction-1"

        events = await client.get(
            f"/v1/cloud/sessions/session-1/events?targetId={target_id}&afterSeq=0",
            headers=auth.headers,
        )
        assert events.status_code == 200
        assert [event["seq"] for event in events.json()["events"]] == [1, 3, 4, 5]
        assert events.json()["nextCursor"] == 5

        mismatch = dict(batch)
        mismatch_events = list(batch["events"])
        mismatch_first = dict(mismatch_events[0])
        mismatch_first["event"] = {
            "type": "session_started",
            "nativeSessionId": "different-native",
            "sourceAgentKind": "codex",
        }
        mismatch_events[0] = mismatch_first
        mismatch["events"] = mismatch_events
        duplicate_mismatch = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json=mismatch,
        )
        assert duplicate_mismatch.status_code == 409
        assert duplicate_mismatch.json()["detail"]["code"] == "cloud_event_duplicate_mismatch"

    @pytest.mark.asyncio
    async def test_worker_event_batch_discards_revoked_exposure_projection(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-event-sync-revoked-exposure",
        )
        target_id, worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="revoked-exposure",
        )
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
            display_name="acme/revoked",
            git_provider="github",
            git_owner="acme",
            git_repo_name="revoked",
            normalized_repo_key="github/acme/revoked",
            git_branch="main",
            git_base_branch="main",
            worktree_path="/workspace/revoked",
            origin="manual_web",
            origin_json='{"kind":"human","entrypoint":"cloud"}',
            status="ready",
            status_detail="Ready",
            template_version="v1",
            runtime_generation=0,
            anyharness_workspace_id="workspace-revoked",
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
            anyharness_workspace_id="workspace-revoked",
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
            session_id="session-revoked",
            exposure_id=exposure.id,
            cloud_workspace_id=workspace.id,
            workspace_id="workspace-revoked",
            projection_level="live",
            commandable=True,
        )
        await exposures_store.archive_workspace_exposure(db_session, exposure_id=exposure.id)
        await db_session.commit()

        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-revoked",
                        "sessionId": "session-revoked",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:00Z",
                        "itemId": "item-revoked",
                        "event": {
                            "type": "item_completed",
                            "item": {
                                "kind": "assistant_message",
                                "status": "completed",
                                "contentParts": [{"type": "text", "text": "should-not-store"}],
                            },
                        },
                    }
                ]
            },
        )

        assert uploaded.status_code == 200
        assert uploaded.json()["acceptedEvents"] == 0
        assert uploaded.json()["liveOnlyEvents"] == 1
        assert uploaded.json()["sessionAcks"] == [
            {"sessionId": "session-revoked", "lastContiguousSeq": 1}
        ]
        snapshot = await client.get(
            f"/v1/cloud/sessions/session-revoked/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        assert snapshot.json()["transcriptItems"] == []
        assert snapshot.json()["pendingInteractions"] == []

    @pytest.mark.asyncio
    async def test_session_stream_emits_snapshot_and_live_projection_patch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-event-stream",
        )
        target_id, worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="stream",
        )
        await _seed_exposed_session_projection(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-stream",
            session_id="session-stream",
        )
        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-stream",
                        "sessionId": "session-stream",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:00Z",
                        "event": {
                            "type": "session_started",
                            "nativeSessionId": "native-stream",
                            "sourceAgentKind": "codex",
                        },
                    }
                ]
            },
        )
        assert uploaded.status_code == 200

        stream = cast(
            "AsyncGenerator[str, None]",
            stream_session_events(
                target_id=UUID(target_id),
                session_id="session-stream",
                after_seq=1,
            ),
        )
        try:
            snapshot_frame = await asyncio.wait_for(anext(stream), timeout=1)
            assert _sse_event(snapshot_frame) == "snapshot"
            snapshot = _sse_data(snapshot_frame)
            assert _mapping(snapshot["session"])["sessionId"] == "session-stream"

            patch_task: asyncio.Task[str] = asyncio.create_task(_next_stream_frame(stream))

            live_uploaded = await client.post(
                "/v1/cloud/worker/events/batches",
                headers=worker_headers,
                json={
                    "events": [
                        {
                            "workspaceId": "workspace-stream",
                            "sessionId": "session-stream",
                            "seq": 2,
                            "timestamp": "2026-05-13T00:00:01Z",
                            "turnId": "turn-stream",
                            "itemId": "item-stream",
                            "event": {
                                "type": "item_completed",
                                "item": {
                                    "kind": "assistant_message",
                                    "status": "completed",
                                    "sourceAgentKind": "codex",
                                    "contentParts": [
                                        {"type": "text", "text": "streamed response"}
                                    ],
                                },
                            },
                        }
                    ]
                },
            )
            assert live_uploaded.status_code == 200

            patch_frame = await asyncio.wait_for(patch_task, timeout=2)
            assert _sse_event(patch_frame) == "patch"
            patch_envelope = _sse_data(patch_frame)
            assert patch_envelope["kind"] == "projection_patch"
            patch = _mapping(patch_envelope["patch"])
            assert patch["eventType"] == "item_completed"
            assert _mapping(patch["transcriptItem"])["text"] == "streamed response"
        finally:
            await stream.aclose()

    @pytest.mark.asyncio
    async def test_workspace_and_target_streams_emit_snapshots_and_patches(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-workspace-stream",
        )
        target_id, worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="workspace-stream",
        )
        target_stream = cast(
            "AsyncGenerator[str, None]",
            stream_target_events(target_id=UUID(target_id), after_seq=0),
        )
        try:
            target_snapshot_frame = await asyncio.wait_for(anext(target_stream), timeout=1)
            assert _sse_event(target_snapshot_frame) == "snapshot"
            assert _mapping(_sse_data(target_snapshot_frame)["target"])["id"] == target_id

            cursor_task: asyncio.Task[str] = asyncio.create_task(_next_stream_frame(target_stream))
            bus = get_pubsub_bus()
            await bus.publish(
                target_channel(target_id=UUID(target_id)),
                PubSubMessage(event="patch", event_id="0", data={"kind": "stale_patch"}),
            )
            await asyncio.sleep(0.05)
            assert not cursor_task.done()
            await bus.publish(
                target_channel(target_id=UUID(target_id)),
                PubSubMessage(event="patch", event_id="1", data={"kind": "fresh_patch"}),
            )
            cursor_frame = await asyncio.wait_for(cursor_task, timeout=1)
            assert _sse_event(cursor_frame) == "patch"
            assert _sse_id(cursor_frame) == "1"
            assert _sse_data(cursor_frame)["kind"] == "fresh_patch"

            target_patch_task: asyncio.Task[str] = asyncio.create_task(
                _next_stream_frame(target_stream)
            )
            heartbeat = await client.post(
                "/v1/cloud/worker/heartbeat",
                headers=worker_headers,
                json={"status": "online", "statusDetail": "ready"},
            )
            assert heartbeat.status_code == 200
            target_patch_frame = await asyncio.wait_for(target_patch_task, timeout=2)
            assert _sse_event(target_patch_frame) == "patch"
            target_patch = _sse_data(target_patch_frame)
            assert target_patch["kind"] == "target_projection_patch"
            assert _mapping(target_patch["target"])["status"] == "online"

            command_status_task: asyncio.Task[str] = asyncio.create_task(
                _next_stream_frame(target_stream)
            )
            command = await client.post(
                "/v1/cloud/commands",
                headers=auth.headers,
                json={
                    "idempotencyKey": "target-stream-command",
                    "targetId": target_id,
                    "workspaceId": "workspace-live",
                    "kind": "backfill_exposed_workspace",
                    "payload": {},
                    "source": "desktop_cloud_view",
                },
            )
            assert command.status_code == 200
            command_status_frame = await asyncio.wait_for(command_status_task, timeout=2)
            assert _sse_event(command_status_frame) == "command_status"
            command_status = _sse_data(command_status_frame)
            assert command_status["kind"] == "command_status"
            assert _mapping(command_status["command"])["status"] == "queued"
        finally:
            await target_stream.aclose()

        backfill = await client.post(
            "/v1/cloud/worker/backfill",
            headers=worker_headers,
            json={
                "workspaces": [
                    {
                        "workspaceId": "workspace-live",
                        "displayName": "Live Workspace",
                        "repo": {
                            "provider": "github",
                            "owner": "proliferate-ai",
                            "name": "proliferate",
                            "branch": "main",
                            "baseBranch": "main",
                        },
                    }
                ],
                "sessions": [
                    {
                        "workspaceId": "workspace-live",
                        "sessionId": "session-live",
                        "sourceAgentKind": "codex",
                        "status": "running",
                    }
                ],
            },
        )
        assert backfill.status_code == 200
        cloud_workspace_id = backfill.json()["mappedWorkspaces"][0]["cloudWorkspaceId"]

        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-live",
                        "sessionId": "session-live",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:00Z",
                        "event": {
                            "type": "session_started",
                            "sourceAgentKind": "codex",
                        },
                    }
                ]
            },
        )
        assert uploaded.status_code == 200

        workspace_snapshot_response = await client.get(
            f"/v1/cloud/workspaces/{cloud_workspace_id}/snapshot",
            headers=auth.headers,
        )
        assert workspace_snapshot_response.status_code == 200
        workspace_snapshot = workspace_snapshot_response.json()
        assert workspace_snapshot["workspace"]["id"] == cloud_workspace_id
        assert workspace_snapshot["sessions"][0]["sessionId"] == "session-live"

        workspace = await get_cloud_workspace_detail(
            db_session,
            UUID(auth.user_id),
            UUID(cloud_workspace_id),
        )
        workspace_stream = cast(
            "AsyncGenerator[str, None]",
            stream_workspace_events(workspace=workspace, after_seq=1),
        )
        try:
            workspace_snapshot_frame = await asyncio.wait_for(anext(workspace_stream), timeout=1)
            assert _sse_event(workspace_snapshot_frame) == "snapshot"
            workspace_snapshot = _sse_data(workspace_snapshot_frame)
            assert _mapping(workspace_snapshot["workspace"])["id"] == cloud_workspace_id
            assert _mapping(workspace_snapshot["sessions"][0])["sessionId"] == "session-live"

            workspace_patch_task: asyncio.Task[str] = asyncio.create_task(
                _next_stream_frame(workspace_stream)
            )
            live_uploaded = await client.post(
                "/v1/cloud/worker/events/batches",
                headers=worker_headers,
                json={
                    "events": [
                        {
                            "workspaceId": "workspace-live",
                            "sessionId": "session-live",
                            "seq": 2,
                            "timestamp": "2026-05-13T00:00:01Z",
                            "event": {"type": "turn_started"},
                        }
                    ]
                },
            )
            assert live_uploaded.status_code == 200

            workspace_patch_frame = await asyncio.wait_for(workspace_patch_task, timeout=2)
            assert _sse_event(workspace_patch_frame) == "patch"
            patch_envelope = _sse_data(workspace_patch_frame)
            assert patch_envelope["kind"] == "workspace_projection_patch"
            assert _mapping(patch_envelope["patch"])["eventType"] == "turn_started"
        finally:
            await workspace_stream.aclose()
