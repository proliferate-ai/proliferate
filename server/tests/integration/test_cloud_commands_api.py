from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CLOUD_WORKER_TOKEN_DOMAIN, CloudWorkspaceStatus
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.store import cloud_runtime_environments, cloud_workspaces
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.server.cloud.worker import service as worker_service
from proliferate.utils.time import utcnow
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account
from tests.e2e.cloud.helpers.shared import AuthSession


async def _create_enrolled_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    suffix: str = "command",
    kind: str = "ssh",
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
            "displayName": f"Command Target {suffix}",
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


async def _create_managed_profile_target(
    client: AsyncClient,
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    suffix: str,
) -> tuple[str, dict[str, str], object]:
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=auth.headers,
    )
    assert profile_response.status_code == 200
    profile_payload = profile_response.json()
    profile_id = UUID(profile_payload["id"])
    target_id = UUID(profile_payload["primaryTargetId"])
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker_token = f"managed-profile-{suffix}-{uuid4()}"
    await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=worker_service._hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint=f"managed-profile-{suffix}",
        hostname=f"managed-profile-{suffix}",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    rebound = await agent_auth_store.get_sandbox_profile(db_session, profile_id)
    assert rebound is not None
    return str(target_id), {"Authorization": f"Bearer {worker_token}"}, rebound


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


async def _create_ready_cloud_workspace(
    db_session: AsyncSession,
    auth: AuthSession,
    *,
    target_id: str,
    anyharness_workspace_id: str = "workspace-1",
) -> str:
    workspace = await cloud_workspaces.create_cloud_workspace_record(
        db_session,
        user_id=UUID(auth.user_id),
        display_name="Command Workspace",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch="main",
        git_base_branch="main",
        origin_json=None,
        template_version="test",
        commit=False,
    )
    workspace.status = CloudWorkspaceStatus.ready.value
    workspace.anyharness_workspace_id = anyharness_workspace_id
    runtime_environment = await cloud_runtime_environments.get_runtime_environment_for_workspace(
        db_session,
        workspace,
    )
    assert runtime_environment is not None
    await cloud_runtime_environments.attach_target_to_runtime_environment(
        db_session,
        runtime_environment_id=runtime_environment.id,
        target_id=UUID(target_id),
    )
    await db_session.commit()
    return str(workspace.id)


class TestCloudCommandsApi:
    @pytest.mark.asyncio
    async def test_user_command_is_leased_delivered_and_accepted_by_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-commands",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

        command_body = {
            "idempotencyKey": "prompt-1",
            "targetId": target_id,
            "workspaceId": "workspace-1",
            "sessionId": "session-1",
            "kind": "send_prompt",
            "payload": {
                "promptId": "cloud-prompt-1",
                "blocks": [{"type": "text", "text": "hello from web"}],
            },
            "observedEventSeq": 10,
            "source": "web",
        }
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json=command_body,
        )
        assert created.status_code == 200
        command = created.json()
        assert command["status"] == "queued"
        assert command["targetId"] == target_id

        duplicate = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json=command_body,
        )
        assert duplicate.status_code == 200
        assert duplicate.json()["commandId"] == command["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["send_prompt", "resolve_interaction"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased_command = lease.json()["command"]
        assert leased_command["commandId"] == command["commandId"]
        assert leased_command["payload"]["blocks"][0]["text"] == "hello from web"
        assert leased_command["observedEventSeq"] == 10

        delivery = await client.post(
            f"/v1/cloud/worker/commands/{command['commandId']}/delivery",
            headers=worker_headers,
            json={"leaseId": leased_command["leaseId"], "status": "delivered"},
        )
        assert delivery.status_code == 200
        assert delivery.json()["status"] == "delivered"

        result = await client.post(
            f"/v1/cloud/worker/commands/{command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_command["leaseId"],
                "status": "accepted",
                "result": {"anyharnessStatus": "running"},
            },
        )
        assert result.status_code == 200
        assert result.json()["status"] == "accepted"

        status = await client.get(
            f"/v1/cloud/commands/{command['commandId']}",
            headers=auth.headers,
        )
        assert status.status_code == 200
        assert status.json()["status"] == "accepted"

        duplicate_result = await client.post(
            f"/v1/cloud/worker/commands/{command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_command["leaseId"],
                "status": "rejected",
                "errorCode": "late_duplicate",
            },
        )
        assert duplicate_result.status_code == 200
        assert duplicate_result.json()["status"] == "accepted"

    @pytest.mark.asyncio
    async def test_start_session_command_requires_workspace_not_session(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-start-session",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
        cloud_workspace_id = await _create_ready_cloud_workspace(
            db_session,
            auth,
            target_id=target_id,
            anyharness_workspace_id="workspace-1",
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-1",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {"agentKind": "codex"},
                "source": "automation",
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["start_session"], "leaseTimeoutSeconds": 30},
        )
        assert lease.status_code == 200
        leased_command = lease.json()["command"]
        assert leased_command["commandId"] == command_id
        assert leased_command["sessionId"] is None
        assert leased_command["workspaceId"] == "workspace-1"
        assert leased_command["payload"]["workspaceId"] == "workspace-1"

        missing_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-missing-workspace",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {"agentKind": "codex"},
            },
        )
        assert missing_workspace.status_code == 400
        assert missing_workspace.json()["detail"]["code"] == "cloud_command_workspace_required"

        arbitrary_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-arbitrary-workspace",
                "targetId": target_id,
                "workspaceId": "workspace-1",
                "kind": "start_session",
                "payload": {"agentKind": "codex"},
            },
        )
        assert arbitrary_workspace.status_code == 404
        assert arbitrary_workspace.json()["detail"]["code"] == "cloud_command_workspace_not_found"

        first_result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={"leaseId": leased_command["leaseId"], "status": "accepted"},
        )
        assert first_result.status_code == 200

        direct_materialized_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "start-session-materialized-workspace",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {"workspaceId": "anyharness-workspace-1", "agentKind": "codex"},
            },
        )
        assert direct_materialized_workspace.status_code == 200
        direct_command_id = direct_materialized_workspace.json()["commandId"]

        direct_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["start_session"], "leaseTimeoutSeconds": 30},
        )
        assert direct_lease.status_code == 200
        direct_command = direct_lease.json()["command"]
        assert direct_command["commandId"] == direct_command_id
        assert direct_command["workspaceId"] == "anyharness-workspace-1"
        assert direct_command["payload"]["workspaceId"] == "anyharness-workspace-1"

    @pytest.mark.asyncio
    async def test_materialize_workspace_command_is_target_scoped(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-materialize-workspace",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-worktree-1",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "targetPath": "/workspace/feature",
                    "newBranchName": "proliferate/cloud-workspace",
                    "baseBranch": "main",
                },
                "source": "automation",
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]
        assert created.json()["workspaceId"] is None
        assert created.json()["sessionId"] is None

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["materialize_workspace"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        command = lease.json()["command"]
        assert command["commandId"] == command_id
        assert command["workspaceId"] is None
        assert command["sessionId"] is None
        assert command["payload"]["repoRootId"] == "repo-root-1"

        accepted = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={
                "leaseId": command["leaseId"],
                "status": "accepted",
                "result": {
                    "mode": "worktree",
                    "anyharnessWorkspaceId": "workspace-1",
                    "repoRootId": "repo-root-1",
                    "path": "/workspace/feature",
                    "kind": "worktree",
                    "currentBranch": "proliferate/cloud-workspace",
                    "originalBranch": "main",
                },
            },
        )
        assert accepted.status_code == 200

        status = await client.get(
            f"/v1/cloud/commands/{command_id}",
            headers=auth.headers,
        )
        assert status.status_code == 200
        assert status.json()["workspaceId"] == "workspace-1"
        assert status.json()["result"]["anyharnessWorkspaceId"] == "workspace-1"

        malformed = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-malformed-result",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {"mode": "existing_path", "path": "/workspace/proliferate"},
            },
        )
        assert malformed.status_code == 200
        malformed_id = malformed.json()["commandId"]
        malformed_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["materialize_workspace"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert malformed_lease.status_code == 200
        malformed_command = malformed_lease.json()["command"]
        assert malformed_command["commandId"] == malformed_id

        malformed_result = await client.post(
            f"/v1/cloud/worker/commands/{malformed_id}/result",
            headers=worker_headers,
            json={
                "leaseId": malformed_command["leaseId"],
                "status": "accepted",
                "result": {
                    "mode": "existing_path",
                    "repoRootId": "repo-root-1",
                    "path": "/workspace/proliferate",
                    "kind": "local",
                },
            },
        )
        assert malformed_result.status_code == 200
        assert malformed_result.json()["status"] == "rejected"

        malformed_status = await client.get(
            f"/v1/cloud/commands/{malformed_id}",
            headers=auth.headers,
        )
        assert malformed_status.status_code == 200
        assert malformed_status.json()["status"] == "rejected"
        assert malformed_status.json()["errorCode"] == "invalid_materialize_workspace_result"
        assert malformed_status.json()["workspaceId"] is None

        existing_path = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-existing-path-1",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "existing_path",
                    "path": "/workspace/proliferate",
                    "displayName": "Proliferate",
                },
            },
        )
        assert existing_path.status_code == 200

        session_scoped = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-session-scoped",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "materialize_workspace",
                "payload": {"mode": "existing_path", "path": "/workspace/proliferate"},
            },
        )
        assert session_scoped.status_code == 400
        assert session_scoped.json()["detail"]["code"] == "cloud_command_target_only"

        workspace_scoped = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-workspace-scoped",
                "targetId": target_id,
                "workspaceId": "workspace-1",
                "kind": "materialize_workspace",
                "payload": {"mode": "existing_path", "path": "/workspace/proliferate"},
            },
        )
        assert workspace_scoped.status_code == 400
        assert workspace_scoped.json()["detail"]["code"] == "cloud_command_target_only"

        missing_path = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-missing-path",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {"mode": "existing_path"},
            },
        )
        assert missing_path.status_code == 400
        assert (
            missing_path.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_path_required"
        )

        missing_worktree_branch = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-missing-branch",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "targetPath": "/workspace/feature",
                },
            },
        )
        assert missing_worktree_branch.status_code == 400
        assert (
            missing_worktree_branch.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_branch_required"
        )

        missing_repo_root = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-missing-repo-root",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "targetPath": "/workspace/feature",
                    "newBranchName": "feature",
                },
            },
        )
        assert missing_repo_root.status_code == 400
        assert (
            missing_repo_root.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_repo_root_required"
        )

        missing_target_path = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-missing-target-path",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "newBranchName": "feature",
                },
            },
        )
        assert missing_target_path.status_code == 400
        assert (
            missing_target_path.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_target_path_required"
        )

        unknown_mode = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-unknown-mode",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {"mode": "archive", "path": "/workspace/proliferate"},
            },
        )
        assert unknown_mode.status_code == 400
        assert (
            unknown_mode.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_mode_invalid"
        )

        unknown_field = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-unknown-field",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "existing_path",
                    "path": "/workspace/proliferate",
                    "unexpected": True,
                },
            },
        )
        assert unknown_field.status_code == 400
        assert (
            unknown_field.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_payload_unknown"
        )

        invalid_optional_type = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "materialize-invalid-optional",
                "targetId": target_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "targetPath": "/workspace/feature",
                    "newBranchName": "feature",
                    "baseBranch": 42,
                },
            },
        )
        assert invalid_optional_type.status_code == 400
        assert (
            invalid_optional_type.json()["detail"]["code"]
            == "cloud_command_materialize_workspace_payload_invalid"
        )

    @pytest.mark.asyncio
    async def test_close_session_command_requires_session(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-close-session",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)

        missing_session = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "close-session-missing-session",
                "targetId": target_id,
                "kind": "close_session",
                "payload": {},
            },
        )
        assert missing_session.status_code == 400
        assert missing_session.json()["detail"]["code"] == "cloud_command_session_required"

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "close-session-1",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "close_session",
                "payload": {},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["close_session"], "leaseTimeoutSeconds": 30},
        )
        assert lease.status_code == 200
        assert lease.json()["command"]["commandId"] == command_id

    @pytest.mark.asyncio
    async def test_stale_command_lease_can_be_recovered(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-lease",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "stale-lease",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        first = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["cancel_turn"], "leaseTimeoutSeconds": 0},
        )
        assert first.status_code == 200
        first_lease = first.json()["command"]["leaseId"]

        immediate_recovery = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["cancel_turn"], "leaseTimeoutSeconds": 30},
        )
        assert immediate_recovery.status_code == 200
        assert immediate_recovery.json()["command"] is None

        leased_row = await db_session.get(CloudCommand, UUID(command_id))
        assert leased_row is not None
        leased_row.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db_session.commit()

        recovered = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["cancel_turn"], "leaseTimeoutSeconds": 30},
        )
        assert recovered.status_code == 200
        recovered_command = recovered.json()["command"]
        assert recovered_command["commandId"] == command_id
        assert recovered_command["leaseId"] != first_lease

        stale_result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={"leaseId": first_lease, "status": "accepted"},
        )
        assert stale_result.status_code == 404
        assert stale_result.json()["detail"]["code"] == "cloud_worker_command_not_leased"

    @pytest.mark.asyncio
    async def test_delivered_command_is_not_released_after_lease_expires(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-delivered",
        )
        target_id, worker_headers = await _create_enrolled_target(client, db_session, auth)
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "delivered-lease",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "send_prompt",
                "payload": {"text": "do not duplicate"},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        first = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["send_prompt"], "leaseTimeoutSeconds": 0},
        )
        assert first.status_code == 200
        first_lease = first.json()["command"]["leaseId"]

        delivery = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/delivery",
            headers=worker_headers,
            json={"leaseId": first_lease, "status": "delivered"},
        )
        assert delivery.status_code == 200
        assert delivery.json()["status"] == "delivered"

        recovered = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["send_prompt"], "leaseTimeoutSeconds": 30},
        )
        assert recovered.status_code == 200
        assert recovered.json()["command"] is None

        result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={"leaseId": first_lease, "status": "accepted"},
        )
        assert result.status_code == 200
        assert result.json()["status"] == "accepted"

    @pytest.mark.asyncio
    async def test_idempotency_key_is_scoped_to_target(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-idempotency",
        )
        first_target_id, _first_worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="first",
        )
        second_target_id, _second_worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="second",
        )

        first = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "same-key",
                "targetId": first_target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert first.status_code == 200

        second = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "same-key",
                "targetId": second_target_id,
                "sessionId": "session-1",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert second.status_code == 200
        assert second.json()["commandId"] != first.json()["commandId"]
        assert second.json()["targetId"] == second_target_id

        same_target_different_session = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "same-key",
                "targetId": first_target_id,
                "sessionId": "session-2",
                "kind": "cancel_turn",
                "payload": {},
            },
        )
        assert same_target_different_session.status_code == 200
        assert same_target_different_session.json()["commandId"] != first.json()["commandId"]

    @pytest.mark.asyncio
    async def test_unsupported_command_kind_is_rejected(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-kind",
        )
        target_id, _worker_headers = await _create_enrolled_target(client, db_session, auth)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "unsupported-command-kind",
                "targetId": target_id,
                "kind": "archive_session",
                "payload": {},
            },
        )
        assert created.status_code == 400
        assert created.json()["detail"]["code"] == "cloud_command_kind_unsupported"

    @pytest.mark.asyncio
    async def test_agent_auth_refresh_command_is_internal_only(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-internal",
        )
        target_id, _worker_headers = await _create_enrolled_target(client, db_session, auth)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-refresh-direct",
                "targetId": target_id,
                "kind": "refresh_agent_auth_config",
                "payload": {
                    "sandboxProfileId": str(UUID(int=1)),
                    "revision": 1,
                    "reason": "direct_api",
                    "forceRestart": False,
                },
            },
        )
        assert created.status_code == 400
        assert created.json()["detail"]["code"] == "cloud_command_internal_only"

    @pytest.mark.asyncio
    async def test_managed_profile_preflight_blocks_revision_zero_without_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-revision-zero",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-revision-zero",
        )
        assert profile.agent_auth_revision == 0
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-revision-zero",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                },
            },
        )
        assert created.status_code == 409
        assert created.json()["detail"]["code"] == "cloud_command_agent_auth_not_ready"

    @pytest.mark.asyncio
    async def test_agent_auth_preflight_requires_applied_target_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-preflight",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-preflight",
        )
        target_uuid = UUID(target_id)
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_preflight",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await db_session.commit()

        missing_state = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-missing-state",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                },
            },
        )
        assert missing_state.status_code == 409
        assert missing_state.json()["detail"]["code"] == "cloud_command_agent_auth_not_ready"

        await agent_auth_store.upsert_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            desired_revision=profile.agent_auth_revision,
            applied_revision=None,
            status="pending",
            force_restart_required=False,
            last_command_id=None,
            last_worker_id=None,
            last_error_code=None,
            last_error_message=None,
        )
        await db_session.commit()

        pending = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-pending",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                    "sandboxProfileId": str(profile.id),
                    "requiredAgentAuthRevision": profile.agent_auth_revision,
                },
            },
        )
        assert pending.status_code == 409
        assert pending.json()["detail"]["code"] == "cloud_command_agent_auth_not_ready"

        await agent_auth_store.upsert_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            desired_revision=profile.agent_auth_revision,
            applied_revision=profile.agent_auth_revision,
            status="applied",
            force_restart_required=False,
            last_command_id=None,
            last_worker_id=None,
            last_error_code=None,
            last_error_message=None,
        )
        await db_session.commit()

        ready = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-ready",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                    "sandboxProfileId": str(profile.id),
                    "requiredAgentAuthRevision": profile.agent_auth_revision,
                },
            },
        )
        assert ready.status_code == 200

        auto_populated = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-auto-populated",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                },
            },
        )
        assert auto_populated.status_code == 200
        command = await db_session.get(
            CloudCommand,
            UUID(auto_populated.json()["commandId"]),
        )
        assert command is not None
        payload = json.loads(command.payload_json)
        assert payload["sandboxProfileId"] == str(profile.id)
        assert payload["requiredAgentAuthRevision"] == profile.agent_auth_revision
        assert payload["agentAuthScope"] == {
            "provider": "proliferate-cloud",
            "id": str(profile.id),
            "targetId": target_id,
        }

        untrusted_scope = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-untrusted-scope",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                    "sandboxProfileId": str(UUID(int=1)),
                    "requiredAgentAuthRevision": 0,
                    "agentAuthScope": {
                        "provider": "local",
                        "id": "default",
                        "targetId": "wrong-target",
                    },
                },
            },
        )
        assert untrusted_scope.status_code == 200
        command = await db_session.get(
            CloudCommand,
            UUID(untrusted_scope.json()["commandId"]),
        )
        assert command is not None
        payload = json.loads(command.payload_json)
        assert payload["sandboxProfileId"] == str(profile.id)
        assert payload["requiredAgentAuthRevision"] == profile.agent_auth_revision
        assert payload["agentAuthScope"] == {
            "provider": "proliferate-cloud",
            "id": str(profile.id),
            "targetId": target_id,
        }

        await agent_auth_store.upsert_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            desired_revision=profile.agent_auth_revision,
            applied_revision=profile.agent_auth_revision,
            status="applied",
            force_restart_required=True,
            last_command_id=None,
            last_worker_id=None,
            last_error_code=None,
            last_error_message=None,
        )
        await db_session.commit()

        restart_required = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-restart-required",
                "targetId": target_id,
                "kind": "send_prompt",
                "sessionId": "session-1",
                "payload": {
                    "text": "hello",
                },
            },
        )
        assert restart_required.status_code == 409
        assert (
            restart_required.json()["detail"]["code"]
            == "cloud_command_agent_auth_restart_required"
        )

    @pytest.mark.asyncio
    async def test_agent_auth_preflight_command_requires_refresh_capable_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-worker-capability",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-worker-capability",
        )
        target_uuid = UUID(target_id)
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_worker_capability",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await agent_auth_store.upsert_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            desired_revision=profile.agent_auth_revision,
            applied_revision=profile.agent_auth_revision,
            status="applied",
            force_restart_required=False,
            last_command_id=None,
            last_worker_id=None,
            last_error_code=None,
            last_error_message=None,
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-worker-capability",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                    "sandboxProfileId": str(profile.id),
                    "requiredAgentAuthRevision": profile.agent_auth_revision,
                },
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        old_worker_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["start_session"], "leaseTimeoutSeconds": 30},
        )
        assert old_worker_lease.status_code == 200
        assert old_worker_lease.json()["command"] is None

        refresh_capable_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["start_session", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert refresh_capable_lease.status_code == 200
        leased_command = refresh_capable_lease.json()["command"]
        assert leased_command["commandId"] == command_id

    @pytest.mark.asyncio
    async def test_preconditions_are_rejected_until_supported(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-preconditions",
        )
        target_id, _worker_headers = await _create_enrolled_target(client, db_session, auth)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "with-preconditions",
                "targetId": target_id,
                "sessionId": "session-1",
                "kind": "send_prompt",
                "payload": {"text": "hello"},
                "preconditions": {"interactionVersion": 1},
            },
        )
        assert created.status_code == 400
        assert created.json()["detail"]["code"] == "cloud_command_preconditions_unsupported"
