from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, AsyncIterator
from typing import cast
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.server.cloud.live.service import stream_session_events
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    auth: AuthSession,
    *,
    suffix: str = "events",
) -> tuple[str, dict[str, str]]:
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
    return enrollment["target"]["id"], {"Authorization": f"Bearer {worker['workerToken']}"}


def _sse_event(frame: str) -> str:
    for line in frame.splitlines():
        if line.startswith("event: "):
            return line.removeprefix("event: ")
    raise AssertionError(f"SSE frame has no event line: {frame}")


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
        target_id, worker_headers = await _create_enrolled_target(client, auth)

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
            auth,
            suffix="stream",
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
