from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CLOUD_WORKER_TOKEN_DOMAIN,
    CloudCommandKind,
    CloudCommandStatus,
    CloudWorkspaceStatus,
)
from proliferate.db.models.cloud.agent_auth import SandboxProfileTargetState
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
from proliferate.db.models.cloud.sync import CloudPendingInteraction
from proliferate.db.store import cloud_runtime_environments, cloud_workspaces
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_runtime_config import revisions as runtime_config_store
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot, supersede_slot
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store
from proliferate.db.store.cloud_sync import target_config as target_config_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.server.cloud.agent_auth.service import (
    request_agent_auth_refresh_for_profile_target,
)
from proliferate.server.cloud.commands import service as command_service
from proliferate.server.cloud.runtime import wake as runtime_wake
from proliferate.server.cloud.worker import service as worker_service
from proliferate.utils.crypto import encrypt_json, encrypt_text
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


async def _mark_minimal_runtime_config_applied(
    db_session: AsyncSession,
    *,
    target_id: UUID,
    profile_id: UUID,
    user_id: UUID,
) -> None:
    await target_config_store.upsert_target_config(
        db_session,
        target_id=target_id,
        user_id=user_id,
        organization_id=None,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        workspace_root="~/proliferate-workspaces/proliferate",
        payload_ciphertext=encrypt_json({"pending": True}),
        summary_json=json.dumps(
            {
                "env_var_count": 0,
                "tracked_file_count": 0,
                "has_git_credential": False,
                "mcp_binding_count": 0,
                "mcp_warning_count": 0,
                "required_tools": [],
            }
        ),
        env_vars_version=0,
        files_version=0,
        mcp_materialization_version=1,
    )
    revision, _created = await runtime_config_store.upsert_revision_and_current(
        db_session,
        sandbox_profile_id=profile_id,
        content_hash=f"sha256:{profile_id.hex}:runtime-config",
        manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
        warnings_json=None,
        source="test",
        generated_by_user_id=user_id,
    )
    state = (
        await db_session.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
        )
    ).scalar_one()
    state.runtime_config_status = "applied"
    state.applied_runtime_config_revision_id = str(revision.id)
    state.applied_runtime_config_sequence = revision.sequence
    await db_session.flush()


async def _mark_agent_auth_applied(
    db_session: AsyncSession,
    *,
    target_id: UUID,
    profile,
) -> None:
    await agent_auth_store.upsert_target_state(
        db_session,
        sandbox_profile_id=profile.id,
        target_id=target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=profile.agent_auth_revision,
        status="applied",
        force_restart_required=False,
        last_command_id=None,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
    )


async def _mark_agent_and_runtime_config_applied(
    db_session: AsyncSession,
    *,
    target_id: UUID,
    profile,
    user_id: UUID,
) -> None:
    await _mark_agent_auth_applied(
        db_session,
        target_id=target_id,
        profile=profile,
    )
    await _mark_minimal_runtime_config_applied(
        db_session,
        target_id=target_id,
        profile_id=profile.id,
        user_id=user_id,
    )


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


async def _create_ready_managed_cloud_workspace(
    db_session: AsyncSession,
    *,
    profile_id: UUID,
    target_id: UUID,
    user_id: UUID,
    suffix: str,
) -> str:
    workspace = await cloud_workspaces.create_managed_cloud_workspace_for_profile(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        created_by_user_id=user_id,
        display_name=f"Managed Command Workspace {suffix}",
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
        git_branch=f"command-{suffix}",
        git_base_branch="main",
        worktree_path=f"/workspace/proliferate-{suffix}",
        origin_json=None,
        template_version="test",
    )
    workspace.status = CloudWorkspaceStatus.ready.value
    workspace.anyharness_workspace_id = f"anyharness-managed-{suffix}"
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    workspace.materialized_slot_generation = slot.slot_generation
    await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )
    await db_session.flush()
    return str(workspace.id)


async def _seed_managed_session_projection(
    db_session: AsyncSession,
    *,
    target_id: UUID,
    cloud_workspace_id: str,
    user_id: UUID,
    session_id: str,
) -> None:
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(
        db_session,
        UUID(cloud_workspace_id),
    )
    assert workspace is not None
    assert workspace.anyharness_workspace_id is not None
    exposure = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace.anyharness_workspace_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )
    await projections_store.upsert_session_projection_metadata(
        db_session,
        target_id=target_id,
        session_id=session_id,
        exposure_id=exposure.id,
        cloud_workspace_id=workspace.id,
        workspace_id=workspace.anyharness_workspace_id,
        projection_level="live",
        commandable=True,
    )


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
        cloud_workspace_id = await _create_ready_cloud_workspace(
            db_session,
            auth,
            target_id=target_id,
            anyharness_workspace_id="workspace-1",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-1",
        )
        await db_session.commit()

        command_body = {
            "idempotencyKey": "prompt-1",
            "targetId": target_id,
            "cloudWorkspaceId": cloud_workspace_id,
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
        assert created.status_code == 200, created.text
        command = created.json()
        assert command["status"] == "queued"
        assert command["targetId"] == target_id

        immediate_status = await client.get(
            f"/v1/cloud/commands/{command['commandId']}",
            headers=auth.headers,
        )
        assert immediate_status.status_code == 200
        assert immediate_status.json()["status"] == "queued"

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
    async def test_worker_prune_command_reports_dehydrated_materialization(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-prune-worktree",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="prune-worktree",
        )
        target_uuid = UUID(target_id)
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="prune-worktree",
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "prune-worktree-command",
                "targetId": target_id,
                "workspaceId": "anyharness-managed-prune-worktree",
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": CloudCommandKind.prune_workspace_worktree.value,
                "payload": {
                    "workspaceId": "anyharness-managed-prune-worktree",
                    "cloudWorkspaceId": cloud_workspace_id,
                    "reason": "test",
                },
            },
        )
        assert created.status_code == 200, created.text
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
                "supportedKinds": [CloudCommandKind.prune_workspace_worktree.value],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased = lease.json()["command"]
        assert leased["commandId"] == command_id
        assert leased["kind"] == CloudCommandKind.prune_workspace_worktree.value
        assert leased["workspaceId"] == "anyharness-managed-prune-worktree"

        report = await client.post(
            "/v1/cloud/worker/materialization-reports",
            headers=worker_headers,
            json={
                "cloudWorkspaceId": cloud_workspace_id,
                "anyharnessWorkspaceId": "anyharness-managed-prune-worktree",
                "state": "dehydrated",
                "cleanupStatus": "completed",
                "worktreePath": "/workspace/proliferate-prune-worktree",
            },
        )
        assert report.status_code == 200, report.text

        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db_session,
            UUID(cloud_workspace_id),
        )
        assert workspace is not None
        assert workspace.anyharness_workspace_id is None
        assert workspace.status == CloudWorkspaceStatus.needs_rematerialization.value
        assert workspace.worktree_path is None
        assert workspace.cleanup_state == "complete"
        exposure = await exposures_store.get_active_workspace_exposure(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=UUID(cloud_workspace_id),
        )
        assert exposure is not None
        assert exposure.anyharness_workspace_id is None
        assert exposure.commandable is False

    @pytest.mark.asyncio
    async def test_worker_prune_command_result_records_dehydrated_materialization(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-prune-result",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="prune-result",
        )
        target_uuid = UUID(target_id)
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="prune-result",
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "prune-worktree-result-command",
                "targetId": target_id,
                "workspaceId": "anyharness-managed-prune-result",
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": CloudCommandKind.prune_workspace_worktree.value,
                "payload": {
                    "workspaceId": "anyharness-managed-prune-result",
                    "cloudWorkspaceId": cloud_workspace_id,
                    "reason": "test",
                },
            },
        )
        assert created.status_code == 200, created.text
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": [CloudCommandKind.prune_workspace_worktree.value],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased = lease.json()["command"]
        assert leased["commandId"] == command_id

        result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased["leaseId"],
                "slotGeneration": leased["slotGeneration"],
                "status": "accepted",
                "result": {
                    "cloudWorkspaceId": cloud_workspace_id,
                    "anyharnessWorkspaceId": "anyharness-managed-prune-result",
                    "materializationState": "dehydrated",
                    "cleanupStatus": "completed",
                    "anyharnessStatusCode": 200,
                    "body": {
                        "workspace": {"id": "anyharness-managed-prune-result"},
                    },
                },
            },
        )
        assert result.status_code == 200, result.text
        assert result.json()["status"] == "accepted"

        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db_session,
            UUID(cloud_workspace_id),
        )
        assert workspace is not None
        assert workspace.anyharness_workspace_id is None
        assert workspace.worktree_path is None
        assert workspace.status == CloudWorkspaceStatus.needs_rematerialization.value
        assert workspace.cleanup_state == "complete"
        exposure = await exposures_store.get_active_workspace_exposure(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=UUID(cloud_workspace_id),
        )
        assert exposure is not None
        assert exposure.anyharness_workspace_id is None
        assert exposure.commandable is False

    @pytest.mark.asyncio
    async def test_worker_prune_command_result_supersedes_stale_materialization_without_rejection(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-prune-stale",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="prune-stale",
        )
        target_uuid = UUID(target_id)
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="prune-stale",
        )
        await db_session.commit()

        current_workspace_id = "anyharness-managed-prune-stale"
        stale_workspace_id = "anyharness-managed-prune-stale-old"
        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "prune-worktree-stale-materialization",
                "targetId": target_id,
                "workspaceId": current_workspace_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": CloudCommandKind.prune_workspace_worktree.value,
                "payload": {
                    "workspaceId": current_workspace_id,
                    "cloudWorkspaceId": cloud_workspace_id,
                    "reason": "test",
                },
            },
        )
        assert created.status_code == 200, created.text
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": [CloudCommandKind.prune_workspace_worktree.value],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased = lease.json()["command"]
        assert leased["commandId"] == command_id

        result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased["leaseId"],
                "slotGeneration": leased["slotGeneration"],
                "status": "accepted",
                "result": {
                    "cloudWorkspaceId": cloud_workspace_id,
                    "anyharnessWorkspaceId": stale_workspace_id,
                    "materializationState": "dehydrated",
                    "cleanupStatus": "completed",
                    "anyharnessStatusCode": 200,
                    "body": {
                        "workspace": {"id": stale_workspace_id},
                    },
                },
            },
        )
        assert result.status_code == 200, result.text
        payload = result.json()
        assert payload["status"] == CloudCommandStatus.superseded.value

        row = (
            await db_session.execute(
                select(CloudCommand).where(CloudCommand.id == UUID(command_id))
            )
        ).scalar_one()
        assert row.status == CloudCommandStatus.superseded.value
        assert row.error_code == "stale_materialization"
        assert row.accepted_at is None
        assert row.rejected_at is None

        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db_session,
            UUID(cloud_workspace_id),
        )
        assert workspace is not None
        assert workspace.anyharness_workspace_id == current_workspace_id

    @pytest.mark.asyncio
    async def test_archive_supersedes_pending_workspace_commands(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-archive-supersede",
        )
        target_id, worker_headers = await _create_enrolled_target(
            client,
            db_session,
            auth,
            suffix="archive-supersede",
        )
        cloud_workspace_id = await _create_ready_cloud_workspace(
            db_session,
            auth,
            target_id=target_id,
            anyharness_workspace_id="workspace-archive-supersede",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-archive-supersede",
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "archive-supersedes-start-session",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": CloudCommandKind.start_session.value,
                "payload": {
                    "agentKind": "codex",
                },
            },
        )
        assert created.status_code == 200, created.text
        command_id = created.json()["commandId"]

        archived = await client.post(
            f"/v1/cloud/workspaces/{cloud_workspace_id}/archive",
            headers=auth.headers,
        )
        assert archived.status_code == 200, archived.text
        assert archived.json()["productLifecycle"] == "archived"

        status = await client.get(
            f"/v1/cloud/commands/{command_id}",
            headers=auth.headers,
        )
        assert status.status_code == 200
        payload = status.json()
        assert payload["status"] == CloudCommandStatus.superseded.value
        assert payload["errorCode"] == "cloud_workspace_archived"

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": [CloudCommandKind.start_session.value],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        assert lease.json()["command"] is None

    @pytest.mark.asyncio
    async def test_managed_materialize_restores_commandable_exposure_after_prune(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-rematerialize",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="rematerialize",
        )
        target_uuid = UUID(target_id)
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="rematerialize",
        )
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db_session,
            UUID(cloud_workspace_id),
        )
        assert workspace is not None
        workspace.anyharness_workspace_id = None
        workspace.status = CloudWorkspaceStatus.needs_rematerialization.value
        exposure = (
            await db_session.execute(
                select(CloudWorkspaceExposure).where(
                    CloudWorkspaceExposure.target_id == target_uuid,
                    CloudWorkspaceExposure.cloud_workspace_id == UUID(cloud_workspace_id),
                    CloudWorkspaceExposure.archived_at.is_(None),
                )
            )
        ).scalar_one()
        assert exposure is not None
        exposure.anyharness_workspace_id = None
        exposure.commandable = False
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "rematerialize-pruned-workspace",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": CloudCommandKind.materialize_workspace.value,
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "targetPath": "/workspace/proliferate-rematerialized",
                    "newBranchName": "command-rematerialize",
                    "baseBranch": "main",
                },
            },
        )
        assert created.status_code == 200, created.text
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": [CloudCommandKind.materialize_workspace.value],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased = lease.json()["command"]
        assert leased["commandId"] == command_id

        accepted = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased["leaseId"],
                "slotGeneration": leased["slotGeneration"],
                "cloudWorkspaceId": cloud_workspace_id,
                "status": "accepted",
                "result": {
                    "mode": "worktree",
                    "anyharnessWorkspaceId": "anyharness-managed-rematerialized",
                    "repoRootId": "repo-root-1",
                    "path": "/workspace/proliferate-rematerialized",
                    "kind": "worktree",
                    "currentBranch": "command-rematerialize",
                    "originalBranch": "main",
                },
            },
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["status"] == "accepted"

        db_session.expire_all()
        exposure = await exposures_store.get_active_workspace_exposure(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=UUID(cloud_workspace_id),
        )
        assert exposure is not None
        assert exposure.anyharness_workspace_id == "anyharness-managed-rematerialized"
        assert exposure.commandable is True

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
        await exposures_store.upsert_workspace_exposure(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=UUID(cloud_workspace_id),
            anyharness_workspace_id="workspace-1",
            owner_scope="personal",
            owner_user_id=UUID(auth.user_id),
            organization_id=None,
            visibility="private",
            default_projection_level="live",
            commandable=True,
            origin="manual_web",
        )
        await db_session.commit()

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
        assert created.status_code == 200, created.text
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
                "payload": {"workspaceId": "workspace-1", "agentKind": "codex"},
            },
        )
        assert direct_materialized_workspace.status_code == 200, direct_materialized_workspace.text
        direct_command_id = direct_materialized_workspace.json()["commandId"]

        direct_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["start_session"], "leaseTimeoutSeconds": 30},
        )
        assert direct_lease.status_code == 200
        direct_command = direct_lease.json()["command"]
        assert direct_command["commandId"] == direct_command_id
        assert direct_command["workspaceId"] == "workspace-1"
        assert direct_command["payload"]["workspaceId"] == "workspace-1"

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
        cloud_workspace_id = await _create_ready_cloud_workspace(
            db_session,
            auth,
            target_id=target_id,
            anyharness_workspace_id="workspace-1",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=UUID(target_id),
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-1",
        )
        await db_session.commit()

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
        assert created.status_code == 200, created.text
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
                "kind": "materialize_workspace",
                "payload": {"mode": "existing_path", "path": "/tmp/stale-lease"},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        first = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["materialize_workspace"], "leaseTimeoutSeconds": 0},
        )
        assert first.status_code == 200
        first_lease = first.json()["command"]["leaseId"]

        immediate_recovery = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["materialize_workspace"], "leaseTimeoutSeconds": 30},
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
            json={"supportedKinds": ["materialize_workspace"], "leaseTimeoutSeconds": 30},
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
                "kind": "materialize_workspace",
                "payload": {"mode": "existing_path", "path": "/tmp/delivered-lease"},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        first = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={"supportedKinds": ["materialize_workspace"], "leaseTimeoutSeconds": 0},
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
            json={"supportedKinds": ["materialize_workspace"], "leaseTimeoutSeconds": 30},
        )
        assert recovered.status_code == 200
        assert recovered.json()["command"] is None

        result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={
                "leaseId": first_lease,
                "status": "accepted",
                "result": {
                    "mode": "existing_path",
                    "anyharnessWorkspaceId": "workspace-1",
                    "repoRootId": "root-1",
                    "path": "/tmp/delivered-lease",
                    "kind": "existing_path",
                },
            },
        )
        assert result.status_code == 200
        assert result.json()["status"] == "accepted"

    @pytest.mark.asyncio
    async def test_managed_send_prompt_stamps_cloud_workspace_and_kicks_wake(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-managed-workspace",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="managed-workspace",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="stamp",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-managed-1",
        )
        await db_session.commit()

        wake_calls: list[tuple[UUID, UUID | None]] = []

        def _record_wake(target_id: UUID, command_id: UUID | None = None) -> None:
            wake_calls.append((target_id, command_id))

        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", _record_wake)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-send-prompt-workspace",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-managed-1",
                "kind": "send_prompt",
                "payload": {"blocks": [{"type": "text", "text": "hello"}]},
            },
        )

        assert created.status_code == 200
        payload = created.json()
        assert payload["cloudWorkspaceId"] == cloud_workspace_id
        assert wake_calls == [(target_uuid, UUID(payload["commandId"]))]
        command = await db_session.get(CloudCommand, UUID(payload["commandId"]))
        assert command is not None
        assert command.cloud_workspace_id == UUID(cloud_workspace_id)
        command_payload = json.loads(command.payload_json)
        assert command_payload["sandboxProfileId"] == str(profile.id)
        assert command_payload["requiredRuntimeConfigSequence"] == 1
        assert command_payload["requiredRuntimeConfigRevisionId"]
        assert command_payload["requiredRuntimeConfigContentHash"]

    @pytest.mark.asyncio
    async def test_web_send_prompt_records_pending_prompt_interaction(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-pending-prompt",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="pending-prompt",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="pending-prompt",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-pending-prompt",
        )
        await db_session.commit()

        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "web-pending-prompt",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-pending-prompt",
                "kind": "send_prompt",
                "source": "web",
                "payload": {
                    "text": "persist this prompt through reload",
                    "promptId": "web:pending-prompt-1",
                },
            },
        )

        assert created.status_code == 200
        pending = (
            await db_session.execute(
                select(CloudPendingInteraction).where(
                    CloudPendingInteraction.target_id == target_uuid,
                    CloudPendingInteraction.session_id == "session-pending-prompt",
                    CloudPendingInteraction.request_id == "web:pending-prompt-1",
                )
            )
        ).scalar_one()
        assert pending.cloud_workspace_id == UUID(cloud_workspace_id)
        assert pending.workspace_id == "anyharness-managed-pending-prompt"
        assert pending.kind == "send_prompt"
        assert pending.status == "pending"
        assert pending.description == "Waiting for response."
        assert json.loads(pending.payload_json or "{}")["text"] == (
            "persist this prompt through reload"
        )

    @pytest.mark.asyncio
    async def test_web_queued_command_status_expires_stale_command(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-web-expire",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="web-expire",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="web-expire",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-web-expire",
        )
        await db_session.commit()

        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "web-stale-command",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-web-expire",
                "kind": "send_prompt",
                "source": "web",
                "payload": {
                    "text": "stale web prompt",
                    "promptId": "web:stale-prompt",
                },
            },
        )
        assert created.status_code == 200
        command_id = UUID(created.json()["commandId"])
        command = await db_session.get(CloudCommand, command_id)
        assert command is not None
        command.created_at = datetime.now(UTC) - timedelta(minutes=5)
        command.updated_at = command.created_at
        await db_session.commit()

        status = await client.get(f"/v1/cloud/commands/{command_id}", headers=auth.headers)

        assert status.status_code == 200
        payload = status.json()
        assert payload["status"] == "expired"
        assert payload["errorCode"] == "web_command_queue_timeout"
        assert "timed out" in payload["errorMessage"]
        pending_interaction = (
            await db_session.execute(
                select(CloudPendingInteraction).where(
                    CloudPendingInteraction.request_id == "web:stale-prompt"
                )
            )
        ).scalar_one()
        assert pending_interaction.status == "failed"
        assert pending_interaction.payload_json is not None
        interaction_payload = json.loads(pending_interaction.payload_json)
        assert interaction_payload["commandId"] == str(command_id)
        assert interaction_payload["status"] == "expired"
        assert interaction_payload["errorCode"] == "web_command_queue_timeout"

    @pytest.mark.asyncio
    async def test_worker_lease_expires_stale_web_command(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-web-expire-lease",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="web-expire-lease",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="web-expire-lease",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-web-expire-lease",
        )
        await db_session.commit()

        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "web-stale-command-lease",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-web-expire-lease",
                "kind": "send_prompt",
                "source": "web",
                "payload": {
                    "text": "stale web prompt from lease",
                    "promptId": "web:stale-prompt-lease",
                },
            },
        )
        assert created.status_code == 200
        command_id = UUID(created.json()["commandId"])
        command = await db_session.get(CloudCommand, command_id)
        assert command is not None
        command.created_at = datetime.now(UTC) - timedelta(minutes=5)
        command.updated_at = command.created_at
        await db_session.commit()

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["send_prompt", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )

        assert lease.status_code == 200
        assert lease.json()["command"] is None
        await db_session.refresh(command)
        assert command.status == "expired"
        assert command.error_code == "web_command_queue_timeout"
        pending_interaction = (
            await db_session.execute(
                select(CloudPendingInteraction).where(
                    CloudPendingInteraction.request_id == "web:stale-prompt-lease"
                )
            )
        ).scalar_one()
        assert pending_interaction.status == "failed"

        leased_created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "web-stale-leased-command",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-web-expire-lease",
                "kind": "send_prompt",
                "source": "web",
                "payload": {
                    "text": "stale leased web prompt",
                    "promptId": "web:stale-leased-prompt",
                },
            },
        )
        assert leased_created.status_code == 200
        leased_command_id = UUID(leased_created.json()["commandId"])
        leased_command = await db_session.get(CloudCommand, leased_command_id)
        assert leased_command is not None
        leased_command.status = "leased"
        leased_command.lease_id = "stale-lease"
        leased_command.lease_expires_at = datetime.now(UTC) - timedelta(minutes=1)
        leased_command.created_at = datetime.now(UTC) - timedelta(minutes=5)
        leased_command.updated_at = leased_command.created_at
        await db_session.commit()

        leased_retry = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["send_prompt", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )

        assert leased_retry.status_code == 200
        assert leased_retry.json()["command"] is None
        await db_session.refresh(leased_command)
        assert leased_command.status == "expired"
        assert leased_command.error_code == "web_command_queue_timeout"

    @pytest.mark.asyncio
    async def test_managed_slot_wake_resumes_command_runtime_environment(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-wake-runtime",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="wake-runtime",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="wake-runtime",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-wake-runtime",
        )
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db_session,
            UUID(cloud_workspace_id),
        )
        assert workspace is not None
        runtime_environment = (
            await cloud_runtime_environments.ensure_runtime_environment_for_workspace(
                db_session,
                workspace,
            )
        )
        slot = await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        runtime_environment.active_sandbox_id = slot.id
        runtime_environment.target_id = target_uuid
        runtime_environment.runtime_token_ciphertext = encrypt_text("runtime-token")
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-wake-runtime",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-wake-runtime",
                "kind": "send_prompt",
                "payload": {"text": "wake runtime"},
            },
        )
        assert created.status_code == 200, created.text
        command_id = UUID(created.json()["commandId"])

        class _Allowed:
            allowed = True
            message = None
            start_block_reason = None

        async def _allow_sandbox_start(**_kwargs: object) -> _Allowed:
            return _Allowed()

        wake_calls: list[dict[str, object]] = []

        async def _record_runtime_ready(
            environment: object,
            *,
            workspace_id: UUID,
            allow_launcher_restart: bool,
            access_token: str,
            force_launcher_restart: bool,
            refresh_worker_enrollment_on_restart: bool,
        ) -> str:
            wake_calls.append(
                {
                    "environment_id": environment.id,
                    "workspace_id": workspace_id,
                    "allow_launcher_restart": allow_launcher_restart,
                    "access_token": access_token,
                    "force_launcher_restart": force_launcher_restart,
                    "refresh_worker_enrollment_on_restart": refresh_worker_enrollment_on_restart,
                }
            )
            return "https://runtime.example.test"

        monkeypatch.setattr(
            runtime_wake,
            "authorize_sandbox_start_for_billing_subject",
            _allow_sandbox_start,
        )
        monkeypatch.setattr(
            runtime_wake,
            "ensure_environment_runtime_ready",
            _record_runtime_ready,
        )

        await runtime_wake.run_managed_slot_wake_job(target_uuid, command_id=command_id)

        assert wake_calls == [
            {
                "environment_id": runtime_environment.id,
                "workspace_id": UUID(cloud_workspace_id),
                "allow_launcher_restart": True,
                "access_token": "runtime-token",
                "force_launcher_restart": True,
                "refresh_worker_enrollment_on_restart": True,
            }
        ]

    @pytest.mark.asyncio
    async def test_managed_slot_wake_hydrates_environment_from_runtime_access(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-wake-runtime-access",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="wake-runtime-access",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="wake-runtime-access",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-wake-runtime-access",
        )
        workspace = await cloud_workspaces.get_cloud_workspace_by_id(
            db_session,
            UUID(cloud_workspace_id),
        )
        assert workspace is not None
        runtime_environment = (
            await cloud_runtime_environments.ensure_runtime_environment_for_workspace(
                db_session,
                workspace,
            )
        )
        slot = await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        runtime_environment.active_sandbox_id = None
        runtime_environment.target_id = target_uuid
        runtime_environment.runtime_token_ciphertext = encrypt_text("stale-runtime-token")
        await targets_store.update_target_runtime_access(
            db_session,
            target_id=target_uuid,
            sandbox_profile_id=profile.id,
            active_sandbox_id=slot.id,
            slot_generation=slot.slot_generation,
            anyharness_base_url="https://runtime-access.example.test",
            runtime_token_ciphertext=encrypt_text("runtime-access-token"),
            anyharness_data_key_ciphertext=encrypt_text("runtime-access-data-key"),
            worker_id=None,
            heartbeat_at=utcnow(),
        )
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-wake-runtime-access",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-wake-runtime-access",
                "kind": "send_prompt",
                "payload": {"text": "wake runtime"},
            },
        )
        assert created.status_code == 200, created.text
        command_id = UUID(created.json()["commandId"])

        class _Allowed:
            allowed = True
            message = None
            start_block_reason = None

        async def _allow_sandbox_start(**_kwargs: object) -> _Allowed:
            return _Allowed()

        wake_calls: list[dict[str, object]] = []

        async def _record_runtime_ready(
            environment: object,
            *,
            workspace_id: UUID,
            allow_launcher_restart: bool,
            access_token: str,
            force_launcher_restart: bool,
            refresh_worker_enrollment_on_restart: bool,
        ) -> str:
            wake_calls.append(
                {
                    "environment_id": environment.id,
                    "workspace_id": workspace_id,
                    "active_sandbox_id": environment.active_sandbox_id,
                    "runtime_url": environment.runtime_url,
                    "access_token": access_token,
                }
            )
            return "https://runtime.example.test"

        monkeypatch.setattr(
            runtime_wake,
            "authorize_sandbox_start_for_billing_subject",
            _allow_sandbox_start,
        )
        monkeypatch.setattr(
            runtime_wake,
            "ensure_environment_runtime_ready",
            _record_runtime_ready,
        )

        await runtime_wake.run_managed_slot_wake_job(target_uuid, command_id=command_id)

        assert wake_calls == [
            {
                "environment_id": runtime_environment.id,
                "workspace_id": UUID(cloud_workspace_id),
                "active_sandbox_id": slot.id,
                "runtime_url": "https://runtime-access.example.test",
                "access_token": "runtime-access-token",
            }
        ]

    @pytest.mark.asyncio
    async def test_managed_materialize_and_start_session_create_exposure_cursor(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-exposure-cursor",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="exposure-cursor",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="exposure-cursor",
        )
        unexposed_cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="materialize-without-exposure",
        )
        unexposed = await exposures_store.get_active_workspace_exposure(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=UUID(unexposed_cloud_workspace_id),
        )
        assert unexposed is not None
        await exposures_store.archive_workspace_exposure(db_session, exposure_id=unexposed.id)
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        unexposed_materialize = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-materialize-without-exposure",
                "targetId": target_id,
                "cloudWorkspaceId": unexposed_cloud_workspace_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "targetPath": "/workspace/unexposed",
                    "newBranchName": "proliferate/unexposed",
                    "baseBranch": "main",
                },
            },
        )
        assert unexposed_materialize.status_code == 409
        assert (
            unexposed_materialize.json()["detail"]["code"] == "cloud_command_exposure_not_active"
        )

        materialize = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-materialize-exposure-cursor",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": "materialize_workspace",
                "payload": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "targetPath": "/workspace/proliferate",
                    "newBranchName": "command/exposure-cursor",
                    "baseBranch": "main",
                },
            },
        )
        assert materialize.status_code == 200
        materialize_id = materialize.json()["commandId"]
        materialize_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["materialize_workspace", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert materialize_lease.status_code == 200
        leased_materialize = materialize_lease.json()["command"]
        assert leased_materialize["commandId"] == materialize_id
        materialize_result = await client.post(
            f"/v1/cloud/worker/commands/{materialize_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_materialize["leaseId"],
                "slotGeneration": leased_materialize["slotGeneration"],
                "cloudWorkspaceId": cloud_workspace_id,
                "anyharnessWorkspaceId": "workspace-exposure-cursor",
                "status": "accepted",
                "result": {
                    "mode": "worktree",
                    "repoRootId": "repo-root-1",
                    "path": "/workspace/proliferate",
                    "kind": "worktree",
                    "anyharnessWorkspaceId": "workspace-exposure-cursor",
                    "cloudWorkspaceId": cloud_workspace_id,
                },
            },
        )
        assert materialize_result.status_code == 200
        exposure = await exposures_store.get_active_workspace_exposure(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=UUID(cloud_workspace_id),
        )
        assert exposure is not None
        assert exposure.anyharness_workspace_id == "workspace-exposure-cursor"

        direct_runtime_workspace = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-start-session-direct-runtime-workspace",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "workspace-exposure-cursor",
                    "agentKind": "claude",
                },
            },
        )
        assert direct_runtime_workspace.status_code == 400
        assert (
            direct_runtime_workspace.json()["detail"]["code"]
            == "cloud_command_cloud_workspace_required"
        )

        start = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-start-session-exposure-cursor",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {"agentKind": "claude"},
            },
        )
        assert start.status_code == 200
        start_id = start.json()["commandId"]
        start_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["start_session", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert start_lease.status_code == 200
        leased_start = start_lease.json()["command"]
        assert leased_start["commandId"] == start_id
        start_result = await client.post(
            f"/v1/cloud/worker/commands/{start_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_start["leaseId"],
                "slotGeneration": leased_start["slotGeneration"],
                "cloudWorkspaceId": cloud_workspace_id,
                "status": "accepted",
                "result": {"body": {"sessionId": "session-exposure-cursor"}},
            },
        )
        assert start_result.status_code == 200

        cursors = await projections_store.list_active_projection_cursors_for_target(
            db_session,
            target_id=target_uuid,
        )
        assert len(cursors) == 1
        assert cursors[0].exposure_id == exposure.id
        assert cursors[0].anyharness_workspace_id == "workspace-exposure-cursor"
        assert cursors[0].anyharness_session_id == "session-exposure-cursor"

        revoked_cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="exposure-revoked-before-result",
        )
        revoked_exposure = await exposures_store.get_active_workspace_exposure(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=UUID(revoked_cloud_workspace_id),
        )
        assert revoked_exposure is not None
        await db_session.commit()
        revoked_start = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-start-session-exposure-revoked-before-result",
                "targetId": target_id,
                "workspaceId": revoked_cloud_workspace_id,
                "kind": "start_session",
                "payload": {"agentKind": "claude"},
            },
        )
        assert revoked_start.status_code == 200
        revoked_start_id = revoked_start.json()["commandId"]
        revoked_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["start_session", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert revoked_lease.status_code == 200
        leased_revoked = revoked_lease.json()["command"]
        assert leased_revoked["commandId"] == revoked_start_id
        await exposures_store.archive_workspace_exposure(
            db_session,
            exposure_id=revoked_exposure.id,
        )
        await db_session.commit()
        revoked_result = await client.post(
            f"/v1/cloud/worker/commands/{revoked_start_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_revoked["leaseId"],
                "slotGeneration": leased_revoked["slotGeneration"],
                "cloudWorkspaceId": revoked_cloud_workspace_id,
                "status": "accepted",
                "result": {"body": {"sessionId": "session-exposure-revoked"}},
            },
        )
        assert revoked_result.status_code == 200
        assert (
            await projections_store.get_session_projection_metadata(
                db_session,
                target_id=target_uuid,
                session_id="session-exposure-revoked",
            )
            is None
        )

    @pytest.mark.asyncio
    async def test_managed_slot_fence_rejects_delivery_generation_mismatch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-delivery-slot",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="delivery-slot",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="delivery-slot",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-slot-delivery",
        )
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-delivery-slot-mismatch",
                "targetId": target_id,
                "sessionId": "session-slot-delivery",
                "kind": "send_prompt",
                "payload": {"text": "slot delivery"},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["send_prompt", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased = lease.json()["command"]
        assert leased["commandId"] == command_id
        assert leased["slotGeneration"] is not None

        delivery = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/delivery",
            headers=worker_headers,
            json={
                "leaseId": leased["leaseId"],
                "slotGeneration": leased["slotGeneration"] + 1,
                "status": "delivered",
            },
        )
        assert delivery.status_code == 200
        assert delivery.json()["status"] == "superseded"

    @pytest.mark.asyncio
    async def test_managed_slot_fence_rejects_result_generation_mismatch(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-result-slot",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="result-slot",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="result-slot",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-slot-result",
        )
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "managed-result-slot-mismatch",
                "targetId": target_id,
                "sessionId": "session-slot-result",
                "kind": "send_prompt",
                "payload": {"text": "slot result"},
            },
        )
        assert created.status_code == 200
        command_id = created.json()["commandId"]

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["send_prompt", "refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased = lease.json()["command"]
        assert leased["commandId"] == command_id

        result = await client.post(
            f"/v1/cloud/worker/commands/{command_id}/result",
            headers=worker_headers,
            json={
                "leaseId": leased["leaseId"],
                "slotGeneration": leased["slotGeneration"] + 1,
                "status": "accepted",
            },
        )
        assert result.status_code == 200
        assert result.json()["status"] == "superseded"

    @pytest.mark.asyncio
    async def test_runtime_config_preflight_fails_fast_when_not_applied(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-runtime-fast-fail",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="runtime-fast-fail",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_auth_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
        )
        await target_config_store.upsert_target_config(
            db_session,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            organization_id=None,
            git_provider="github",
            git_owner="proliferate-ai",
            git_repo_name="proliferate",
            workspace_root="~/proliferate-workspaces/proliferate",
            payload_ciphertext=encrypt_json({"pending": True}),
            summary_json=json.dumps(
                {
                    "env_var_count": 0,
                    "tracked_file_count": 0,
                    "has_git_credential": False,
                    "mcp_binding_count": 0,
                    "mcp_warning_count": 0,
                    "required_tools": [],
                }
            ),
            env_vars_version=0,
            files_version=0,
            mcp_materialization_version=1,
        )
        await runtime_config_store.upsert_revision_and_current(
            db_session,
            sandbox_profile_id=profile.id,
            content_hash=f"sha256:{profile.id.hex}:runtime-config-pending",
            manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
            warnings_json=None,
            source="test",
            generated_by_user_id=UUID(auth.user_id),
        )
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "runtime-config-not-applied",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                },
            },
        )

        assert created.status_code == 409
        assert created.json()["detail"]["code"] == "cloud_command_runtime_config_not_ready"
        queued = (
            (
                await db_session.execute(
                    select(CloudCommand).where(
                        CloudCommand.target_id == target_uuid,
                        CloudCommand.kind == CloudCommandKind.materialize_environment.value,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert queued == []

    @pytest.mark.asyncio
    async def test_runtime_config_preflight_does_not_overwrite_caller_revision(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-runtime-stale-preflight",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="runtime-stale-preflight",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        _current, first_revision = await runtime_config_store.get_current(
            db_session,
            sandbox_profile_id=profile.id,
        )
        assert first_revision is not None
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="runtime-stale-preflight",
        )
        await runtime_config_store.upsert_revision_and_current(
            db_session,
            sandbox_profile_id=profile.id,
            content_hash=f"sha256:{profile.id.hex}:runtime-config-next",
            manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
            warnings_json=None,
            source="test",
            generated_by_user_id=UUID(auth.user_id),
        )
        await db_session.commit()
        monkeypatch.setattr(
            command_service,
            "kick_off_managed_slot_wake",
            lambda _target_id, _command_id=None: None,
        )

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "runtime-config-stale-caller-revision",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
                    "agentKind": "claude",
                    "sandboxProfileId": str(profile.id),
                    "requiredRuntimeConfigRevisionId": str(first_revision.id),
                    "requiredRuntimeConfigSequence": first_revision.sequence,
                    "requiredRuntimeConfigContentHash": first_revision.content_hash,
                },
            },
        )

        assert created.status_code == 409
        assert created.json()["detail"]["code"] == "cloud_command_runtime_config_revision_stale"

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
            kind="desktop_dispatch",
        )
        cloud_workspace_id = await _create_ready_cloud_workspace(
            db_session,
            auth,
            target_id=first_target_id,
            anyharness_workspace_id="workspace-1",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=UUID(first_target_id),
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-1",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=UUID(first_target_id),
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-2",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=UUID(second_target_id),
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-1",
        )
        await db_session.commit()

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
    async def test_agent_auth_refresh_result_marks_target_state_applied(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-result-state",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-result-state",
        )
        target_uuid = UUID(target_id)
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_result_state",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_result_state",
            force_restart=False,
        )
        await db_session.commit()

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased_command = lease.json()["command"]
        assert leased_command["kind"] == "refresh_agent_auth_config"

        result = await client.post(
            f"/v1/cloud/worker/commands/{leased_command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_command["leaseId"],
                "slotGeneration": leased_command["slotGeneration"],
                "status": "accepted",
                "result": {
                    "applied": True,
                    "revision": profile.agent_auth_revision,
                    "currentRevision": profile.agent_auth_revision,
                    "selectionCount": 0,
                    "syncedFileCount": 0,
                    "appliedCleanupPaths": [],
                },
            },
        )
        assert result.status_code == 200

        await db_session.rollback()
        state = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert state is not None
        assert state.status == "applied"
        assert state.applied_revision == profile.agent_auth_revision
        assert state.last_command_id == UUID(leased_command["commandId"])
        assert state.last_worker_id is not None

    @pytest.mark.asyncio
    async def test_agent_auth_refresh_requeues_when_terminal_command_state_is_pending(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-result-requeue",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-result-requeue",
        )
        target_uuid = UUID(target_id)
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_result_requeue",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_result_requeue",
            force_restart=False,
        )
        await db_session.commit()

        first_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert first_lease.status_code == 200
        first_command = first_lease.json()["command"]

        first_result = await client.post(
            f"/v1/cloud/worker/commands/{first_command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": first_command["leaseId"],
                "slotGeneration": first_command["slotGeneration"],
                "status": "accepted",
                "result": {
                    "applied": True,
                    "currentRevision": profile.agent_auth_revision,
                },
            },
        )
        assert first_result.status_code == 200

        await db_session.rollback()
        await agent_auth_store.upsert_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            desired_revision=profile.agent_auth_revision,
            applied_revision=None,
            status="pending",
            force_restart_required=False,
            last_command_id=UUID(first_command["commandId"]),
            last_worker_id=None,
            last_error_code=None,
            last_error_message=None,
        )
        await db_session.commit()

        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_result_requeue",
            force_restart=False,
        )
        await db_session.commit()

        second_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert second_lease.status_code == 200
        second_command = second_lease.json()["command"]
        assert second_command["kind"] == "refresh_agent_auth_config"
        assert second_command["commandId"] != first_command["commandId"]

        await db_session.rollback()
        state = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert state is not None
        assert state.status == "pending"
        assert state.applied_revision is None
        assert state.last_command_id == UUID(second_command["commandId"])

    @pytest.mark.asyncio
    async def test_agent_auth_refresh_requeues_when_applied_state_belongs_to_stale_slot(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-stale-slot-requeue",
        )
        target_id, first_worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-stale-slot-requeue",
        )
        target_uuid = UUID(target_id)
        first_slot = await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_stale_slot_requeue",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_stale_slot_requeue",
            force_restart=False,
        )
        await db_session.commit()

        first_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=first_worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert first_lease.status_code == 200
        first_command = first_lease.json()["command"]
        assert first_command["kind"] == "refresh_agent_auth_config"
        first_result = await client.post(
            f"/v1/cloud/worker/commands/{first_command['commandId']}/result",
            headers=first_worker_headers,
            json={
                "leaseId": first_command["leaseId"],
                "slotGeneration": first_command["slotGeneration"],
                "status": "accepted",
                "result": {
                    "applied": True,
                    "currentRevision": profile.agent_auth_revision,
                },
            },
        )
        assert first_result.status_code == 200

        await db_session.rollback()
        applied_to_first_slot = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert applied_to_first_slot is not None
        assert applied_to_first_slot.status == "applied"
        assert applied_to_first_slot.applied_revision == profile.agent_auth_revision
        assert applied_to_first_slot.active_sandbox_id == first_slot.id
        assert applied_to_first_slot.slot_generation == first_slot.slot_generation

        await supersede_slot(db_session, sandbox_id=first_slot.id)
        second_slot = await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        second_worker_token = f"managed-profile-stale-slot-requeue-{uuid4()}"
        second_worker = await worker_auth_store.create_worker(
            db_session,
            target_id=target_uuid,
            cloud_sandbox_id=second_slot.id,
            slot_generation=second_slot.slot_generation,
            token_hash=worker_service._hash_token(
                domain=CLOUD_WORKER_TOKEN_DOMAIN,
                token=second_worker_token,
            ),
            machine_fingerprint="managed-profile-stale-slot-requeue-second",
            hostname="managed-profile-stale-slot-requeue-second",
            worker_version="0.1.0",
            anyharness_version="0.1.0",
            supervisor_version=None,
            now=utcnow(),
        )
        stale_state = (
            await db_session.execute(
                select(SandboxProfileTargetState).where(
                    SandboxProfileTargetState.sandbox_profile_id == profile.id,
                    SandboxProfileTargetState.target_id == target_uuid,
                )
            )
        ).scalar_one()
        stale_state.agent_auth_status = "applied"
        stale_state.applied_agent_auth_revision = profile.agent_auth_revision
        stale_state.active_sandbox_id = first_slot.id
        stale_state.slot_generation = first_slot.slot_generation
        stale_state.last_agent_auth_command_id = UUID(first_command["commandId"])
        stale_state.last_agent_auth_worker_id = applied_to_first_slot.last_worker_id
        stale_state.updated_at = utcnow()
        await db_session.commit()

        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_stale_slot_requeue",
            force_restart=False,
        )
        await db_session.commit()

        await db_session.rollback()
        pending_second_slot = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert pending_second_slot is not None
        assert pending_second_slot.status == "pending"
        assert pending_second_slot.applied_revision is None
        assert pending_second_slot.last_command_id != UUID(first_command["commandId"])

        second_worker_headers = {"Authorization": f"Bearer {second_worker_token}"}
        second_lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=second_worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert second_lease.status_code == 200
        second_command = second_lease.json()["command"]
        assert second_command["commandId"] == str(pending_second_slot.last_command_id)
        materialization = await client.get(
            f"/v1/cloud/worker/agent-auth-configs/{profile.id}/materialization",
            headers=second_worker_headers,
            params={
                "command_id": second_command["commandId"],
                "revision": second_command["payload"]["revision"],
                "lease_id": second_command["leaseId"],
            },
        )
        assert materialization.status_code == 200
        materialization_plan = materialization.json()
        assert materialization_plan["applied"] is True
        assert materialization_plan["slotGeneration"] == second_slot.slot_generation
        assert materialization_plan["slotGeneration"] == second_command["slotGeneration"]

        second_result = await client.post(
            f"/v1/cloud/worker/commands/{second_command['commandId']}/result",
            headers=second_worker_headers,
            json={
                "leaseId": second_command["leaseId"],
                "slotGeneration": second_command["slotGeneration"],
                "status": "accepted",
                "result": {
                    "applied": True,
                    "currentRevision": profile.agent_auth_revision,
                },
            },
        )
        assert second_result.status_code == 200

        await db_session.rollback()
        applied_to_second_slot = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert applied_to_second_slot is not None
        assert applied_to_second_slot.status == "applied"
        assert applied_to_second_slot.applied_revision == profile.agent_auth_revision
        assert applied_to_second_slot.active_sandbox_id == second_slot.id
        assert applied_to_second_slot.slot_generation == second_slot.slot_generation
        assert applied_to_second_slot.last_worker_id == second_worker.id

    @pytest.mark.asyncio
    async def test_stale_agent_auth_refresh_result_does_not_regress_target_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-stale-result",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-stale-result",
        )
        target_uuid = UUID(target_id)
        first_profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_stale_result_first",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert first_profile is not None
        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_stale_result_first",
            force_restart=False,
        )
        await db_session.commit()

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        first_command = lease.json()["command"]
        assert first_command["kind"] == "refresh_agent_auth_config"

        second_profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_stale_result_second",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert second_profile is not None
        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_stale_result_second",
            force_restart=False,
        )
        newer_state = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert newer_state is not None
        assert newer_state.desired_revision == second_profile.agent_auth_revision
        second_command_id = newer_state.last_command_id
        await db_session.commit()

        result = await client.post(
            f"/v1/cloud/worker/commands/{first_command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": first_command["leaseId"],
                "slotGeneration": first_command["slotGeneration"],
                "status": "accepted",
                "result": {
                    "applied": True,
                    "revision": first_profile.agent_auth_revision,
                    "currentRevision": first_profile.agent_auth_revision,
                    "selectionCount": 0,
                    "syncedFileCount": 0,
                    "appliedCleanupPaths": [],
                },
            },
        )
        assert result.status_code == 200

        await db_session.rollback()
        state = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert state is not None
        assert state.desired_revision == second_profile.agent_auth_revision
        assert state.applied_revision is None
        assert state.status == "pending"
        assert state.last_command_id == second_command_id

    @pytest.mark.asyncio
    async def test_stale_slot_agent_auth_refresh_result_does_not_apply_target_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-stale-slot-result",
        )
        target_id, worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-stale-slot-result",
        )
        target_uuid = UUID(target_id)
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_stale_slot_result",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await request_agent_auth_refresh_for_profile_target(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
            actor_user_id=UUID(auth.user_id),
            reason="test_stale_slot_result",
            force_restart=False,
        )
        await db_session.commit()

        lease = await client.post(
            "/v1/cloud/worker/commands/lease",
            headers=worker_headers,
            json={
                "supportedKinds": ["refresh_agent_auth_config"],
                "leaseTimeoutSeconds": 30,
            },
        )
        assert lease.status_code == 200
        leased_command = lease.json()["command"]
        assert leased_command["kind"] == "refresh_agent_auth_config"

        old_slot = await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        old_slot_id = old_slot.id
        await supersede_slot(db_session, sandbox_id=old_slot_id)
        await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        await db_session.commit()

        result = await client.post(
            f"/v1/cloud/worker/commands/{leased_command['commandId']}/result",
            headers=worker_headers,
            json={
                "leaseId": leased_command["leaseId"],
                "slotGeneration": leased_command["slotGeneration"],
                "status": "accepted",
                "result": {
                    "applied": True,
                    "revision": profile.agent_auth_revision,
                    "currentRevision": profile.agent_auth_revision,
                    "selectionCount": 0,
                    "syncedFileCount": 0,
                    "appliedCleanupPaths": [],
                },
            },
        )
        assert result.status_code == 200
        assert result.json()["status"] == "superseded"

        await db_session.rollback()
        state = await agent_auth_store.get_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=target_uuid,
        )
        assert state is not None
        assert state.desired_revision == profile.agent_auth_revision
        assert state.applied_revision is None
        assert state.status == "pending"
        assert state.last_command_id == UUID(leased_command["commandId"])

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
    async def test_managed_runtime_config_preflight_requires_target_config(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-runtime-config-target-config",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="runtime-config-target-config",
        )
        await agent_auth_store.upsert_target_state(
            db_session,
            sandbox_profile_id=profile.id,
            target_id=UUID(target_id),
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
                "idempotencyKey": "runtime-config-target-config-required",
                "targetId": target_id,
                "kind": "start_session",
                "payload": {
                    "workspaceId": "anyharness-workspace-1",
                    "agentKind": "claude",
                },
            },
        )

        assert created.status_code == 409
        assert created.json()["detail"]["code"] == "cloud_command_target_config_required"

    @pytest.mark.asyncio
    async def test_managed_start_session_with_cloud_workspace_uses_runtime_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-runtime-config-cloud-workspace",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="runtime-config-cloud-workspace",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_auth_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
        )
        revision, _created = await runtime_config_store.upsert_revision_and_current(
            db_session,
            sandbox_profile_id=profile.id,
            content_hash=f"sha256:{profile.id.hex}:runtime-config-cloud-workspace",
            manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
            warnings_json=None,
            source="test",
            generated_by_user_id=UUID(auth.user_id),
        )
        state = (
            await db_session.execute(
                select(SandboxProfileTargetState).where(
                    SandboxProfileTargetState.sandbox_profile_id == profile.id,
                    SandboxProfileTargetState.target_id == target_uuid,
                )
            )
        ).scalar_one()
        state.runtime_config_status = "applied"
        state.applied_runtime_config_revision_id = str(revision.id)
        state.applied_runtime_config_sequence = revision.sequence
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="runtime-config-cloud-workspace",
        )
        assert not await target_config_store.list_target_configs(
            db_session,
            target_id=target_uuid,
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "runtime-config-cloud-workspace",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {"agentKind": "claude"},
            },
        )

        assert created.status_code == 200
        command = await db_session.get(
            CloudCommand,
            UUID(created.json()["commandId"]),
        )
        assert command is not None
        payload = json.loads(command.payload_json)
        assert payload["workspaceId"] == "anyharness-managed-runtime-config-cloud-workspace"
        assert payload["requiredRuntimeConfigRevisionId"] == str(revision.id)
        assert command.cloud_workspace_id == UUID(cloud_workspace_id)
        await db_session.rollback()

    @pytest.mark.asyncio
    async def test_managed_send_prompt_with_cloud_workspace_uses_runtime_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-send-prompt-runtime-state",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="send-prompt-runtime-state",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_auth_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
        )
        revision, _created = await runtime_config_store.upsert_revision_and_current(
            db_session,
            sandbox_profile_id=profile.id,
            content_hash=f"sha256:{profile.id.hex}:send-prompt-runtime-state",
            manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
            warnings_json=None,
            source="test",
            generated_by_user_id=UUID(auth.user_id),
        )
        state = (
            await db_session.execute(
                select(SandboxProfileTargetState).where(
                    SandboxProfileTargetState.sandbox_profile_id == profile.id,
                    SandboxProfileTargetState.target_id == target_uuid,
                )
            )
        ).scalar_one()
        state.runtime_config_status = "applied"
        state.applied_runtime_config_revision_id = str(revision.id)
        state.applied_runtime_config_sequence = revision.sequence
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="send-prompt-runtime-state",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-send-prompt-runtime-state",
        )
        assert not await target_config_store.list_target_configs(
            db_session,
            target_id=target_uuid,
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "send-prompt-runtime-state",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-send-prompt-runtime-state",
                "kind": "send_prompt",
                "payload": {"blocks": [{"type": "text", "text": "hello"}]},
            },
        )

        assert created.status_code == 200, created.text
        command = await db_session.get(
            CloudCommand,
            UUID(created.json()["commandId"]),
        )
        assert command is not None
        payload = json.loads(command.payload_json)
        assert payload["sandboxProfileId"] == str(profile.id)
        assert payload["requiredRuntimeConfigRevisionId"] == str(revision.id)
        assert command.cloud_workspace_id == UUID(cloud_workspace_id)
        await db_session.rollback()

    @pytest.mark.asyncio
    async def test_managed_update_session_config_with_cloud_workspace_uses_runtime_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-update-config-runtime-state",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="update-config-runtime-state",
        )
        target_uuid = UUID(target_id)
        await _mark_agent_auth_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
        )
        revision, _created = await runtime_config_store.upsert_revision_and_current(
            db_session,
            sandbox_profile_id=profile.id,
            content_hash=f"sha256:{profile.id.hex}:update-config-runtime-state",
            manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
            warnings_json=None,
            source="test",
            generated_by_user_id=UUID(auth.user_id),
        )
        state = (
            await db_session.execute(
                select(SandboxProfileTargetState).where(
                    SandboxProfileTargetState.sandbox_profile_id == profile.id,
                    SandboxProfileTargetState.target_id == target_uuid,
                )
            )
        ).scalar_one()
        state.runtime_config_status = "applied"
        state.applied_runtime_config_revision_id = str(revision.id)
        state.applied_runtime_config_sequence = revision.sequence
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="update-config-runtime-state",
        )
        await _seed_managed_session_projection(
            db_session,
            target_id=target_uuid,
            cloud_workspace_id=cloud_workspace_id,
            user_id=UUID(auth.user_id),
            session_id="session-update-config-runtime-state",
        )
        assert not await target_config_store.list_target_configs(
            db_session,
            target_id=target_uuid,
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "update-config-runtime-state",
                "targetId": target_id,
                "cloudWorkspaceId": cloud_workspace_id,
                "sessionId": "session-update-config-runtime-state",
                "kind": "update_session_config",
                "payload": {"configId": "model", "value": "gpt-5.4-mini"},
            },
        )

        assert created.status_code == 200, created.text
        command = await db_session.get(
            CloudCommand,
            UUID(created.json()["commandId"]),
        )
        assert command is not None
        assert json.loads(command.payload_json) == {
            "configId": "model",
            "value": "gpt-5.4-mini",
        }
        assert command.cloud_workspace_id == UUID(cloud_workspace_id)
        await db_session.rollback()

    @pytest.mark.asyncio
    async def test_agent_auth_preflight_requires_applied_target_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)
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
        await _mark_minimal_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile_id=profile.id,
            user_id=UUID(auth.user_id),
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
        await _mark_minimal_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile_id=profile.id,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="agent-auth-preflight",
        )
        await db_session.commit()

        ready = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-ready",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
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
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
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
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
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
        await _mark_minimal_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile_id=profile.id,
            user_id=UUID(auth.user_id),
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
    async def test_agent_auth_preflight_rejects_stale_slot_state(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
    ) -> None:
        auth = await create_user_and_login(
            client,
            db_session,
            email_prefix="cloud-command-agent-auth-stale-slot",
        )
        target_id, _worker_headers, profile = await _create_managed_profile_target(
            client,
            db_session,
            auth,
            suffix="agent-auth-stale-slot",
        )
        target_uuid = UUID(target_id)
        profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
            db_session,
            sandbox_profile_id=profile.id,
            reason="test_stale_slot",
            actor_user_id=UUID(auth.user_id),
            force_restart=False,
        )
        assert profile is not None
        await _mark_agent_and_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile=profile,
            user_id=UUID(auth.user_id),
        )
        stale_state = (
            await db_session.execute(
                select(SandboxProfileTargetState).where(
                    SandboxProfileTargetState.sandbox_profile_id == profile.id,
                    SandboxProfileTargetState.target_id == target_uuid,
                )
            )
        ).scalar_one()
        stale_state.active_sandbox_id = None
        stale_state.slot_generation = None
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="agent-auth-stale-slot",
        )
        await db_session.commit()

        response = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-stale-slot",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
                    "agentKind": "claude",
                    "sandboxProfileId": str(profile.id),
                    "requiredAgentAuthRevision": profile.agent_auth_revision,
                },
            },
        )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "cloud_command_agent_auth_not_ready"
        await db_session.rollback()
        refresh_commands = (
            (
                await db_session.execute(
                    select(CloudCommand)
                    .where(
                        CloudCommand.target_id == target_uuid,
                        CloudCommand.kind == CloudCommandKind.refresh_agent_auth_config.value,
                    )
                    .order_by(CloudCommand.created_at.asc())
                )
            )
            .scalars()
            .all()
        )
        assert len(refresh_commands) == 1
        assert refresh_commands[0].status == CloudCommandStatus.queued.value

        repeated_response = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-stale-slot-repeat",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
                    "agentKind": "claude",
                    "sandboxProfileId": str(profile.id),
                    "requiredAgentAuthRevision": profile.agent_auth_revision,
                },
            },
        )
        assert repeated_response.status_code == 409
        await db_session.rollback()
        repeated_refresh_commands = (
            (
                await db_session.execute(
                    select(CloudCommand).where(
                        CloudCommand.target_id == target_uuid,
                        CloudCommand.kind == CloudCommandKind.refresh_agent_auth_config.value,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(repeated_refresh_commands) == 1

    @pytest.mark.asyncio
    async def test_agent_auth_preflight_command_requires_refresh_capable_worker(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(command_service, "kick_off_managed_slot_wake", lambda *_args: None)
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
        await _mark_minimal_runtime_config_applied(
            db_session,
            target_id=target_uuid,
            profile_id=profile.id,
            user_id=UUID(auth.user_id),
        )
        cloud_workspace_id = await _create_ready_managed_cloud_workspace(
            db_session,
            profile_id=profile.id,
            target_id=target_uuid,
            user_id=UUID(auth.user_id),
            suffix="agent-auth-worker-capability",
        )
        await db_session.commit()

        created = await client.post(
            "/v1/cloud/commands",
            headers=auth.headers,
            json={
                "idempotencyKey": "agent-auth-preflight-worker-capability",
                "targetId": target_id,
                "workspaceId": cloud_workspace_id,
                "kind": "start_session",
                "payload": {
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
