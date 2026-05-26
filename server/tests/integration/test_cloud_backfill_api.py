from __future__ import annotations

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_sync import exposures as exposures_store
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    suffix: str = "backfill",
    kind: str = "desktop_dispatch",
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
            "kind": kind,
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


async def _seed_exposed_workspace(
    db_session: AsyncSession,
    *,
    auth: AuthSession,
    target_id: str,
    anyharness_workspace_id: str,
    display_name: str = "Local Workspace",
    commandable: bool = True,
) -> str:
    user_id = UUID(auth.user_id)
    target_uuid = UUID(target_id)
    billing_subject = await ensure_personal_billing_subject(db_session, user_id)
    workspace = CloudWorkspace(
        user_id=user_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        created_by_user_id=user_id,
        billing_subject_id=billing_subject.id,
        target_id=target_uuid,
        display_name=display_name,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        normalized_repo_key="github/proliferate-ai/proliferate",
        git_branch="initial",
        git_base_branch="main",
        worktree_path=f"/workspace/{anyharness_workspace_id}",
        origin="manual_web",
        origin_json='{"kind":"human","entrypoint":"cloud"}',
        status="ready",
        status_detail="Ready",
        template_version="test",
        runtime_generation=0,
        anyharness_workspace_id=anyharness_workspace_id,
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db_session.add(workspace)
    await db_session.flush()
    await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_uuid,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=anyharness_workspace_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=commandable,
        origin="manual_web",
    )
    await db_session.commit()
    return str(workspace.id)


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
        seeded_cloud_workspace_id = await _seed_exposed_workspace(
            db_session,
            auth=auth,
            target_id=target_id,
            anyharness_workspace_id="local-workspace-1",
        )

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
        assert cloud_workspace_id == seeded_cloud_workspace_id
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

        exposures = await client.get(
            "/v1/cloud/worker/exposures",
            headers=worker_headers,
        )
        assert exposures.status_code == 200
        assert exposures.json()["exposures"][0]["anyharnessSessionId"] == "local-session-1"

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
            kind="ssh",
        )
        await _seed_exposed_workspace(
            db_session,
            auth=auth,
            target_id=first_target_id,
            anyharness_workspace_id="same-local-id",
            display_name="First Workspace",
        )
        await _seed_exposed_workspace(
            db_session,
            auth=auth,
            target_id=second_target_id,
            anyharness_workspace_id="same-local-id",
            display_name="Second Workspace",
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
    async def test_backfill_exposed_workspace_command_can_be_queued(
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
        cloud_workspace_id = await _seed_exposed_workspace(
            db_session,
            auth=auth,
            target_id=target_id,
            anyharness_workspace_id="local-workspace-1",
        )
        read_only_cloud_workspace_id = await _seed_exposed_workspace(
            db_session,
            auth=auth,
            target_id=target_id,
            anyharness_workspace_id="read-only-workspace",
            display_name="Read Only Workspace",
            commandable=False,
        )

        missing_cloud_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "backfill-missing-cloud-workspace",
                "targetId": target_id,
                "workspaceId": "local-workspace-1",
                "kind": "backfill_exposed_workspace",
                "payload": {},
                "source": "desktop_cloud_view",
            },
        )
        assert missing_cloud_workspace.status_code == 400
        assert (
            missing_cloud_workspace.json()["detail"]["code"]
            == "cloud_command_cloud_workspace_required"
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "backfill-local-workspace",
                "targetId": target_id,
                "workspaceId": "local-workspace-1",
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": "backfill_exposed_workspace",
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
                "supportedKinds": ["backfill_exposed_workspace"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        command = lease.json()["command"]
        assert command["commandId"] == command_id
        assert command["workspaceId"] == "local-workspace-1"

        read_only_created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "backfill-read-only-workspace",
                "targetId": target_id,
                "cloudWorkspaceId": read_only_cloud_workspace_id,
                "kind": "backfill_exposed_workspace",
                "payload": {},
                "source": "desktop_cloud_view",
            },
        )
        assert read_only_created.status_code == 200
        read_only_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["backfill_exposed_workspace"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert read_only_lease.status_code == 200
        assert (
            read_only_lease.json()["command"]["commandId"] == read_only_created.json()["commandId"]
        )
        assert read_only_lease.json()["command"]["workspaceId"] == "read-only-workspace"

    @pytest.mark.asyncio
    async def test_backfill_command_accepts_profile_tagged_desktop_dispatch_target(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-backfill-profile-tagged-desktop",
        )
        target_id, _worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="profile-tagged-desktop",
        )
        profile = await agent_auth_store.ensure_personal_sandbox_profile(
            db_session,
            user_id=UUID(auth.user_id),
            created_by_user_id=UUID(auth.user_id),
        )
        target = (
            await db_session.execute(
                select(CloudTarget).where(CloudTarget.id == UUID(target_id))
            )
        ).scalar_one()
        target.sandbox_profile_id = profile.id
        target.profile_target_role = "none"
        cloud_workspace_id = await _seed_exposed_workspace(
            db_session,
            auth=auth,
            target_id=target_id,
            anyharness_workspace_id="profile-tagged-local-workspace",
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "backfill-profile-tagged-desktop",
                "targetId": target_id,
                "workspaceId": "profile-tagged-local-workspace",
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": "backfill_exposed_workspace",
                "payload": {},
                "source": "desktop_cloud_view",
            },
        )

        assert created.status_code == 200
