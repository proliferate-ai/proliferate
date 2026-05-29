from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.integration.cloud_event_helpers import (
    create_enrolled_target,
    seed_exposed_session_projection,
)


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
        target_id, worker_headers = await create_enrolled_target(client, db_session, auth)
        await seed_exposed_session_projection(
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
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 6,
                    "timestamp": "2026-05-13T00:00:05Z",
                    "turnId": "turn-1",
                    "event": {"type": "turn_ended", "stopReason": "end_turn"},
                },
                {
                    "workspaceId": "workspace-1",
                    "sessionId": "session-1",
                    "seq": 7,
                    "timestamp": "2026-05-13T00:00:06Z",
                    "event": {
                        "type": "pending_prompt_added",
                        "seq": 1,
                        "promptId": "prompt-1",
                        "text": "queued follow-up",
                        "contentParts": [{"type": "text", "text": "queued follow-up"}],
                        "queuedAt": "2026-05-13T00:00:06Z",
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
        assert uploaded.json()["acceptedEvents"] == 6
        assert uploaded.json()["liveOnlyEvents"] == 1
        assert uploaded.json()["sessionAcks"] == [
            {"sessionId": "session-1", "lastContiguousSeq": 7}
        ]

        duplicate = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json=batch,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["acceptedEvents"] == 0
        assert duplicate.json()["duplicateEvents"] == 6
        assert duplicate.json()["sessionAcks"] == [
            {"sessionId": "session-1", "lastContiguousSeq": 7}
        ]

        snapshot = await client.get(
            f"/v1/cloud/sessions/session-1/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        body = snapshot.json()
        assert body["session"]["sessionId"] == "session-1"
        assert body["session"]["sourceAgentKind"] == "codex"
        assert body["session"]["lastEventSeq"] == 7
        assert body["session"]["pendingInteractionCount"] == 1
        assert body["transcriptItems"][0]["text"] == "hello"
        assert body["transcriptItems"][0]["payload"]["event"]["item"]["rawInput"]["retention"] == (
            "stripped"
        )
        assert body["pendingInteractions"][0]["requestId"] == "interaction-1"
        assert body["pendingInteractions"][0]["title"] == "Approve command"

        workspaces = await client.get("/v1/cloud/workspaces", headers=auth.headers)
        assert workspaces.status_code == 200
        workspace_summary = workspaces.json()[0]
        assert workspace_summary["lastSessionSummary"]["sessionId"] == "session-1"
        assert workspace_summary["lastSessionSummary"]["pendingInteractionCount"] == 1

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
        event_rows = events.json()["events"]
        assert [event["seq"] for event in event_rows] == [1, 3, 4, 5, 6, 7]
        assert events.json()["nextCursor"] == 7
        event_by_seq = {event["seq"]: event for event in event_rows}
        item_completed_envelope = event_by_seq[4]["envelope"]
        assert item_completed_envelope["event"]["item"]["contentParts"] == [
            {"type": "text", "text": "hello"}
        ]
        assert item_completed_envelope["event"]["item"]["rawInput"]["retention"] == "stripped"
        assert event_by_seq[6]["envelope"]["turnId"] == "turn-1"
        assert event_by_seq[6]["envelope"]["event"] == {
            "type": "turn_ended",
            "stopReason": "end_turn",
        }
        assert event_by_seq[7]["envelope"]["event"]["type"] == "pending_prompt_added"
        assert event_by_seq[7]["envelope"]["event"]["contentParts"] == [
            {"type": "text", "text": "queued follow-up"}
        ]

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
    async def test_worker_error_event_unblocks_session_projection(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-event-sync-error",
        )
        target_id, worker_headers = await create_enrolled_target(client, db_session, auth)
        await seed_exposed_session_projection(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-error",
            session_id="session-error",
        )

        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-error",
                        "sessionId": "session-error",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:00Z",
                        "event": {
                            "type": "session_started",
                            "nativeSessionId": "native-error",
                            "sourceAgentKind": "codex",
                        },
                    },
                    {
                        "workspaceId": "workspace-error",
                        "sessionId": "session-error",
                        "seq": 2,
                        "timestamp": "2026-05-13T00:00:01Z",
                        "event": {"type": "turn_started"},
                    },
                    {
                        "workspaceId": "workspace-error",
                        "sessionId": "session-error",
                        "seq": 3,
                        "timestamp": "2026-05-13T00:00:02Z",
                        "event": {
                            "type": "error",
                            "message": "agent request failed",
                        },
                    },
                ]
            },
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["acceptedEvents"] == 3

        snapshot = await client.get(
            f"/v1/cloud/sessions/session-error/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        session = snapshot.json()["session"]
        assert session["status"] == "idle"
        assert session["phase"] == "idle"
        assert session["lastEventSeq"] == 3

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
        target_id, worker_headers = await create_enrolled_target(
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
        assert uploaded.json()["sessionAcks"] == []
        assert uploaded.json()["eventAcks"] == [
            {
                "sessionId": "session-revoked",
                "seq": 1,
                "action": "discarded",
                "reason": "inactive_projection",
            }
        ]
        assert (
            await events_store.get_ingest_cursor(
                db_session,
                target_id=target_uuid,
                session_id="session-revoked",
            )
            == 0
        )
        snapshot = await client.get(
            f"/v1/cloud/sessions/session-revoked/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        assert snapshot.json()["transcriptItems"] == []
        assert snapshot.json()["pendingInteractions"] == []

    @pytest.mark.asyncio
    async def test_user_prompt_echo_resolves_pending_prompt_interaction(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-event-pending-prompt",
        )
        target_id, worker_headers = await create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="pending-prompt",
        )
        await seed_exposed_session_projection(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-pending-prompt",
            session_id="session-pending-prompt",
        )
        await events_store.upsert_pending_interaction(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=None,
            workspace_id="workspace-pending-prompt",
            session_id="session-pending-prompt",
            request_id="web:pending-prompt-1",
            seq=0,
            occurred_at="2026-05-13T00:00:00Z",
            kind="send_prompt",
            title="Queued prompt",
            description="Waiting for response.",
            payload_json='{"text":"persist this prompt through reload"}',
        )
        await db_session.commit()

        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-pending-prompt",
                        "sessionId": "session-pending-prompt",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:01Z",
                        "turnId": "turn-pending-prompt",
                        "event": {
                            "type": "item_completed",
                            "item": {
                                "kind": "user_message",
                                "status": "completed",
                                "promptId": "web:pending-prompt-1",
                                "contentParts": [
                                    {
                                        "type": "text",
                                        "text": "persist this prompt through reload",
                                    }
                                ],
                            },
                        },
                    }
                ]
            },
        )

        assert uploaded.status_code == 200
        snapshot = await client.get(
            f"/v1/cloud/sessions/session-pending-prompt/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        body = snapshot.json()
        assert body["transcriptItems"][0]["text"] == "persist this prompt through reload"
        assert body["pendingInteractions"] == []

    @pytest.mark.asyncio
    async def test_worker_event_batch_discards_workspace_mismatch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-event-sync-workspace-mismatch",
        )
        target_id, worker_headers = await create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="workspace-mismatch",
        )
        target_uuid = UUID(target_id)
        await seed_exposed_session_projection(
            db_session,
            target_id=target_id,
            auth=auth,
            workspace_id="workspace-authorized",
            session_id="session-mismatch",
        )

        uploaded = await client.post(
            "/v1/cloud/worker/events/batches",
            headers=worker_headers,
            json={
                "events": [
                    {
                        "workspaceId": "workspace-other",
                        "sessionId": "session-mismatch",
                        "seq": 1,
                        "timestamp": "2026-05-13T00:00:00Z",
                        "itemId": "item-mismatch",
                        "event": {
                            "type": "item_completed",
                            "item": {
                                "kind": "assistant_message",
                                "status": "completed",
                                "contentParts": [{"type": "text", "text": "wrong workspace"}],
                            },
                        },
                    }
                ]
            },
        )

        assert uploaded.status_code == 200
        assert uploaded.json()["acceptedEvents"] == 0
        assert uploaded.json()["sessionAcks"] == []
        assert uploaded.json()["eventAcks"] == [
            {
                "sessionId": "session-mismatch",
                "seq": 1,
                "action": "discarded",
                "reason": "workspace_mismatch",
            }
        ]
        assert (
            await events_store.get_ingest_cursor(
                db_session,
                target_id=target_uuid,
                session_id="session-mismatch",
            )
            == 0
        )
