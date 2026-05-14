from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

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
