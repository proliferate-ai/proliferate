from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    suffix: str = "backfill",
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
            "displayName": f"Backfill Target {suffix}",
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


class TestCloudBackfillApi:
    @pytest.mark.asyncio
    async def test_worker_backfill_maps_workspace_and_session_read_models(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-backfill",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

        backfill = await client.post(
            "/v1/cloud/worker/backfill",
            headers=worker_headers,
            json={
                "workspaces": [
                    {
                        "workspaceId": "local-workspace-1",
                        "displayName": "Local Workspace",
                        "path": "/tmp/proliferate",
                        "repo": {
                            "provider": "github",
                            "owner": "proliferate-ai",
                            "name": "proliferate",
                            "branch": "worker-sync",
                            "baseBranch": "main",
                        },
                        "updatedAt": "2026-05-14T00:00:00Z",
                    }
                ],
                "sessions": [
                    {
                        "sessionId": "local-session-1",
                        "workspaceId": "local-workspace-1",
                        "nativeSessionId": "native-session-1",
                        "sourceAgentKind": "codex",
                        "title": "Synced session",
                        "status": "idle",
                        "phase": "awaiting_interaction",
                        "liveConfig": {"model": "gpt-5.4"},
                        "lastEventSeq": 0,
                        "lastEventAt": "2026-05-14T00:00:00Z",
                        "startedAt": "2026-05-14T00:00:00Z",
                        "pendingInteractions": [
                            {
                                "requestId": "interaction-1",
                                "kind": "permission",
                                "title": "Approve tests",
                                "description": "Agent wants to run tests.",
                                "payload": {"type": "permission"},
                            }
                        ],
                    }
                ],
            },
        )
        assert backfill.status_code == 200
        body = backfill.json()
        assert body["mappedWorkspaces"][0]["workspaceId"] == "local-workspace-1"
        cloud_workspace_id = body["mappedWorkspaces"][0]["cloudWorkspaceId"]
        assert body["mappedSessions"][0]["cloudWorkspaceId"] == cloud_workspace_id

        workspaces = await client.get("/v1/cloud/workspaces", headers=auth.headers)
        assert workspaces.status_code == 200
        workspace = workspaces.json()[0]
        assert workspace["id"] == cloud_workspace_id
        assert workspace["displayName"] == "Local Workspace"
        assert workspace["repo"]["branch"] == "worker-sync"

        sessions = await client.get(
            f"/v1/cloud/sessions?targetId={target_id}",
            headers=auth.headers,
        )
        assert sessions.status_code == 200
        session = sessions.json()[0]
        assert session["sessionId"] == "local-session-1"
        assert session["cloudWorkspaceId"] == cloud_workspace_id
        assert session["liveConfig"] == {"model": "gpt-5.4"}

        snapshot = await client.get(
            f"/v1/cloud/sessions/local-session-1/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert snapshot.status_code == 200
        assert snapshot.json()["pendingInteractions"][0]["requestId"] == "interaction-1"

        cleared = await client.post(
            "/v1/cloud/worker/backfill",
            headers=worker_headers,
            json={
                "workspaces": [],
                "sessions": [
                    {
                        "sessionId": "local-session-1",
                        "workspaceId": "local-workspace-1",
                        "status": "idle",
                        "lastEventSeq": 1,
                        "lastEventAt": "2026-05-14T00:01:00Z",
                        "pendingInteractions": [],
                    }
                ],
            },
        )
        assert cleared.status_code == 200
        cleared_snapshot = await client.get(
            f"/v1/cloud/sessions/local-session-1/snapshot?targetId={target_id}",
            headers=auth.headers,
        )
        assert cleared_snapshot.status_code == 200
        assert cleared_snapshot.json()["pendingInteractions"] == []

    @pytest.mark.asyncio
    async def test_backfill_keeps_same_repo_branch_distinct_per_target(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-backfill-target-scope",
        )
        first_target_id, first_worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="target-scope-1",
        )
        second_target_id, second_worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="target-scope-2",
        )

        payload = {
            "workspaces": [
                {
                    "workspaceId": "same-local-id",
                    "displayName": "Local Workspace",
                    "repo": {
                        "provider": "github",
                        "owner": "proliferate-ai",
                        "name": "proliferate",
                        "branch": "main",
                        "baseBranch": "main",
                    },
                }
            ],
            "sessions": [],
        }
        first = await client.post(
            "/v1/cloud/worker/backfill",
            headers=first_worker_headers,
            json=payload,
        )
        assert first.status_code == 200
        second = await client.post(
            "/v1/cloud/worker/backfill",
            headers=second_worker_headers,
            json=payload,
        )
        assert second.status_code == 200
        first_workspace_id = first.json()["mappedWorkspaces"][0]["cloudWorkspaceId"]
        second_workspace_id = second.json()["mappedWorkspaces"][0]["cloudWorkspaceId"]
        assert first_workspace_id != second_workspace_id

        first_sessions = await client.get(
            f"/v1/cloud/sessions?targetId={first_target_id}",
            headers=auth.headers,
        )
        assert first_sessions.status_code == 200
        second_sessions = await client.get(
            f"/v1/cloud/sessions?targetId={second_target_id}",
            headers=auth.headers,
        )
        assert second_sessions.status_code == 200

    @pytest.mark.asyncio
    async def test_sync_existing_workspace_command_can_be_queued(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-backfill-command",
        )
        target_id, worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="backfill-command",
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "sync-local-workspace",
                "targetId": target_id,
                "workspaceId": "local-workspace-1",
                "kind": "sync_existing_workspace",
                "payload": {},
                "source": "desktop_cloud_view",
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        legacy_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"leaseTimeoutSeconds": 30},
        )
        assert legacy_lease.status_code == 200
        assert legacy_lease.json()["command"] is None

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["sync_existing_workspace"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        command = lease.json()["command"]
        assert command["commandId"] == command_id
        assert command["workspaceId"] == "local-workspace-1"
