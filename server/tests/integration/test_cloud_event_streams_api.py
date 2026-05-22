from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator
from contextlib import asynccontextmanager
from typing import cast
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.integrations.pubsub.models import PubSubMessage
from proliferate.integrations.pubsub.redis import get_pubsub_bus
from proliferate.server.cloud.live import service as live_service
from proliferate.server.cloud.live.domain.channels import session_channel, target_channel
from proliferate.server.cloud.live.service import (
    stream_session_events,
    stream_target_events,
    stream_workspace_events,
)
from proliferate.server.cloud.workspaces.service import get_cloud_workspace_detail
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.integration.cloud_event_helpers import (
    create_enrolled_target,
    mapping,
    next_stream_frame,
    seed_exposed_session_projection,
    seed_exposed_workspace,
    sse_data,
    sse_event,
    sse_id,
)


class TestCloudEventStreamsApi:
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
        target_id, worker_headers = await create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="stream",
        )
        await seed_exposed_session_projection(
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
            assert sse_event(snapshot_frame) == "snapshot"
            snapshot = sse_data(snapshot_frame)
            assert mapping(snapshot["session"])["sessionId"] == "session-stream"

            patch_task: asyncio.Task[str] = asyncio.create_task(next_stream_frame(stream))

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
            assert sse_event(patch_frame) == "patch"
            patch_envelope = sse_data(patch_frame)
            assert patch_envelope["kind"] == "projection_patch"
            patch = mapping(patch_envelope["patch"])
            assert patch["eventType"] == "item_completed"
            assert mapping(patch["transcriptItem"])["text"] == "streamed response"
            patch_event = mapping(patch["envelope"])
            assert patch_event["sessionId"] == "session-stream"
            assert patch_event["itemId"] == "item-stream"
            assert mapping(patch_event["event"])["type"] == "item_completed"
            assert mapping(mapping(patch_event["event"])["item"])["contentParts"] == [
                {"type": "text", "text": "streamed response"}
            ]
        finally:
            await stream.aclose()

    @pytest.mark.asyncio
    async def test_session_stream_command_status_does_not_advance_transcript_cursor(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-session-command-cursor",
        )
        target_id, worker_headers = await create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="session-command-cursor",
        )
        await seed_exposed_session_projection(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-command-cursor",
            session_id="session-command-cursor",
        )
        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-command-cursor",
                        "sessionId": "session-command-cursor",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:00Z",
                        "event": {
                            "type": "session_started",
                            "nativeSessionId": "native-command-cursor",
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
                session_id="session-command-cursor",
                after_seq=1,
            ),
        )
        try:
            snapshot_frame = await asyncio.wait_for(anext(stream), timeout=1)
            assert sse_event(snapshot_frame) == "snapshot"
            assert sse_id(snapshot_frame) == "1"

            bus = get_pubsub_bus()
            command_status_task: asyncio.Task[str] = asyncio.create_task(
                next_stream_frame(stream)
            )
            await bus.publish(
                session_channel(
                    target_id=UUID(target_id),
                    session_id="session-command-cursor",
                ),
                PubSubMessage(
                    event="command_status",
                    event_id="9999999999999",
                    data={"kind": "command_status"},
                ),
            )
            command_status_frame = await asyncio.wait_for(command_status_task, timeout=1)
            assert sse_event(command_status_frame) == "command_status"
            assert sse_id(command_status_frame) == "9999999999999"

            patch_task: asyncio.Task[str] = asyncio.create_task(next_stream_frame(stream))
            live_uploaded = await client.post(
                "/v1/cloud/worker/events/batches",
                headers=worker_headers,
                json={
                    "events": [
                        {
                            "workspaceId": "workspace-command-cursor",
                            "sessionId": "session-command-cursor",
                            "seq": 2,
                            "timestamp": "2026-05-13T00:00:01Z",
                            "turnId": "turn-command-cursor",
                            "itemId": "item-command-cursor",
                            "event": {
                                "type": "item_completed",
                                "item": {
                                    "kind": "assistant_message",
                                    "status": "completed",
                                    "sourceAgentKind": "codex",
                                    "contentParts": [
                                        {"type": "text", "text": "still visible"}
                                    ],
                                },
                            },
                        }
                    ]
                },
            )
            assert live_uploaded.status_code == 200

            patch_frame = await asyncio.wait_for(patch_task, timeout=2)
            assert sse_event(patch_frame) == "patch"
            assert sse_id(patch_frame) == "2"
            patch_envelope = sse_data(patch_frame)
            assert patch_envelope["kind"] == "projection_patch"
            assert mapping(patch_envelope["patch"])["eventType"] == "item_completed"
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
        target_id, worker_headers = await create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="workspace-stream",
        )
        cloud_workspace_uuid, exposure_id = await seed_exposed_workspace(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-live",
        )
        cloud_workspace_id = str(cloud_workspace_uuid)
        target_stream = cast(
            "AsyncGenerator[str, None]",
            stream_target_events(target_id=UUID(target_id), after_seq=0),
        )
        try:
            target_snapshot_frame = await asyncio.wait_for(anext(target_stream), timeout=1)
            assert sse_event(target_snapshot_frame) == "snapshot"
            assert mapping(sse_data(target_snapshot_frame)["target"])["id"] == target_id

            cursor_task: asyncio.Task[str] = asyncio.create_task(next_stream_frame(target_stream))
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
            assert sse_event(cursor_frame) == "patch"
            assert sse_id(cursor_frame) == "1"
            assert sse_data(cursor_frame)["kind"] == "fresh_patch"

            target_patch_task: asyncio.Task[str] = asyncio.create_task(
                next_stream_frame(target_stream)
            )
            heartbeat = await client.post(
                "/v1/cloud/worker/heartbeat",
                headers=worker_headers,
                json={"status": "online", "statusDetail": "ready"},
            )
            assert heartbeat.status_code == 200
            target_patch_frame = await asyncio.wait_for(target_patch_task, timeout=2)
            assert sse_event(target_patch_frame) == "patch"
            target_patch = sse_data(target_patch_frame)
            assert target_patch["kind"] == "target_projection_patch"
            assert mapping(target_patch["target"])["status"] == "online"

            command_status_task: asyncio.Task[str] = asyncio.create_task(
                next_stream_frame(target_stream)
            )
            command = await client.post(
                "/v1/cloud/commands",
                headers=auth.headers,
                json={
                    "idempotencyKey": "target-stream-command",
                    "targetId": target_id,
                    "workspaceId": "workspace-live",
                    "cloudWorkspaceId": cloud_workspace_id,
                    "kind": "backfill_exposed_workspace",
                    "payload": {},
                    "source": "desktop_cloud_view",
                },
            )
            assert command.status_code == 200
            command_status_frame = await asyncio.wait_for(command_status_task, timeout=2)
            assert sse_event(command_status_frame) == "command_status"
            command_status = sse_data(command_status_frame)
            assert command_status["kind"] == "command_status"
            assert mapping(command_status["command"])["status"] == "queued"
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
        assert backfill.json()["mappedWorkspaces"][0]["cloudWorkspaceId"] == cloud_workspace_id
        await projections_store.upsert_session_projection_metadata(
            db_session,
            target_id=UUID(target_id),
            session_id="session-live",
            exposure_id=exposure_id,
            cloud_workspace_id=UUID(cloud_workspace_id),
            workspace_id="workspace-live",
            projection_level="live",
            commandable=True,
        )
        await db_session.commit()

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
            assert sse_event(workspace_snapshot_frame) == "snapshot"
            workspace_snapshot = sse_data(workspace_snapshot_frame)
            assert mapping(workspace_snapshot["workspace"])["id"] == cloud_workspace_id
            assert mapping(workspace_snapshot["sessions"][0])["sessionId"] == "session-live"

            workspace_patch_task: asyncio.Task[str] = asyncio.create_task(
                next_stream_frame(workspace_stream)
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
            assert sse_event(workspace_patch_frame) == "patch"
            patch_envelope = sse_data(workspace_patch_frame)
            assert patch_envelope["kind"] == "workspace_projection_patch"
            workspace_patch = mapping(patch_envelope["patch"])
            assert workspace_patch["eventType"] == "turn_started"
            assert mapping(workspace_patch["envelope"])["sessionId"] == "session-live"
            assert mapping(mapping(workspace_patch["envelope"])["event"])["type"] == (
                "turn_started"
            )
        finally:
            await workspace_stream.aclose()

    @pytest.mark.asyncio
    async def test_workspace_stream_exits_cleanly_when_subscriber_closes(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-workspace-stream-close",
        )
        target_id, _worker_headers = await create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="workspace-stream-close",
        )
        cloud_workspace_uuid, _exposure_id = await seed_exposed_workspace(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-stream-close",
        )
        workspace = await get_cloud_workspace_detail(
            db_session,
            UUID(auth.user_id),
            cloud_workspace_uuid,
        )
        monkeypatch.setattr(live_service, "_live_bus", _ClosingPubSubBus())

        workspace_stream = cast(
            "AsyncGenerator[str, None]",
            stream_workspace_events(workspace=workspace, after_seq=0),
        )
        try:
            workspace_snapshot_frame = await asyncio.wait_for(
                anext(workspace_stream),
                timeout=1,
            )
            assert sse_event(workspace_snapshot_frame) == "snapshot"

            with pytest.raises(StopAsyncIteration):
                await asyncio.wait_for(anext(workspace_stream), timeout=1)
        finally:
            await workspace_stream.aclose()


class _ClosingPubSubBus:
    @asynccontextmanager
    async def subscribe(
        self,
        _channel: str,
    ) -> AsyncIterator[AsyncIterator[PubSubMessage]]:
        yield _closed_message_iterator()

    async def publish(self, _channel: str, _message: PubSubMessage) -> None:
        return None


async def _closed_message_iterator() -> AsyncIterator[PubSubMessage]:
    return
    yield PubSubMessage(event="patch", event_id="1", data={})
