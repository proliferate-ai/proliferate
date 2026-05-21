from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import (
    CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
    CLOUD_WORKER_TOKEN_DOMAIN,
    CloudCommandKind,
    CloudCommandStatus,
)
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.models.cloud.agent_auth import SandboxProfile, SandboxProfileTargetState
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot, supersede_slot
from proliferate.db.store.cloud_runtime_config import store as runtime_config_store
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_workspaces import create_managed_cloud_workspace_for_profile
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker import service as worker_service
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.models import WorkerInventoryRequest
from proliferate.utils.time import utcnow
from tests.e2e.cloud.helpers.auth import create_user_and_login


async def _create_personal_profile(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    email_prefix: str,
) -> tuple[object, uuid.UUID, uuid.UUID]:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix=email_prefix,
    )
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=auth.headers,
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    return auth, uuid.UUID(profile["id"]), uuid.UUID(profile["primaryTargetId"])


async def _create_profile_slot_worker(
    db_session: AsyncSession,
    *,
    profile_id: uuid.UUID,
    target_id: uuid.UUID,
    worker_name: str,
) -> tuple[object, object]:
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=f"{worker_name}-token-hash",
        machine_fingerprint=worker_name,
        hostname=worker_name,
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    return slot, worker


@pytest.mark.asyncio
async def test_personal_profile_ensure_is_idempotent_and_does_not_create_slot(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="sandbox-profile-personal",
    )

    first, second = await asyncio.gather(
        client.post("/v1/cloud/sandbox-profiles/personal", headers=auth.headers),
        client.post("/v1/cloud/sandbox-profiles/personal", headers=auth.headers),
    )

    assert first.status_code == 200
    assert second.status_code == 200
    first_payload = first.json()
    second_payload = second.json()
    assert first_payload["id"] == second_payload["id"]
    assert first_payload["primaryTargetId"] == second_payload["primaryTargetId"]
    assert first_payload["ownerScope"] == "personal"
    assert first_payload["ownerUserId"] == auth.user_id
    assert first_payload["organizationId"] is None

    profile_count = await db_session.scalar(select(func.count(SandboxProfile.id)))
    target_count = await db_session.scalar(select(func.count(CloudTarget.id)))
    slot_count = await db_session.scalar(select(func.count(CloudSandbox.id)))
    assert profile_count == 1
    assert target_count == 1
    assert slot_count == 0

    target = await db_session.get(CloudTarget, uuid.UUID(first_payload["primaryTargetId"]))
    assert target is not None
    assert target.sandbox_profile_id == uuid.UUID(first_payload["id"])
    assert target.profile_target_role == "primary"
    assert target.kind == "managed_cloud"
    assert target.owner_scope == "personal"
    assert target.owner_user_id == uuid.UUID(auth.user_id)
    assert target.organization_id is None


@pytest.mark.asyncio
async def test_org_profile_primary_target_uses_org_scope_and_no_eager_slot(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="sandbox-profile-org",
    )
    organization = Organization(name="Sandbox Profile Org")
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(auth.user_id),
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
        )
    )
    await db_session.commit()

    response = await client.post(
        f"/v1/cloud/organizations/{organization.id}/sandbox-profile",
        headers=auth.headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["ownerScope"] == "organization"
    assert payload["ownerUserId"] is None
    assert payload["organizationId"] == str(organization.id)
    assert payload["createdByUserId"] == auth.user_id
    assert payload["primaryTargetId"] is not None

    target = await db_session.get(CloudTarget, uuid.UUID(payload["primaryTargetId"]))
    assert target is not None
    assert target.owner_scope == "organization"
    assert target.owner_user_id is None
    assert target.organization_id == organization.id
    assert target.created_by_user_id == uuid.UUID(auth.user_id)
    assert target.sandbox_profile_id == uuid.UUID(payload["id"])
    assert target.profile_target_role == "primary"

    slot_count = await db_session.scalar(select(func.count(CloudSandbox.id)))
    assert slot_count == 0


@pytest.mark.asyncio
async def test_slot_generation_and_runtime_access_reject_stale_slot_reports(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="sandbox-profile-slot",
    )
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=auth.headers,
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    profile_id = uuid.UUID(profile["id"])
    target_id = uuid.UUID(profile["primaryTargetId"])

    first_slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert first_slot.slot_generation == 1
    same_slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert same_slot.id == first_slot.id
    assert same_slot.slot_generation == 1

    heartbeat_at = utcnow()
    first_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        active_sandbox_id=first_slot.id,
        slot_generation=first_slot.slot_generation or 0,
        anyharness_base_url="http://127.0.0.1:11000",
        runtime_token_ciphertext="token-1",
        anyharness_data_key_ciphertext="key-1",
        worker_id=None,
        heartbeat_at=heartbeat_at,
    )
    assert first_access is not None
    assert first_access.active_sandbox_id == first_slot.id
    assert first_access.slot_generation == 1

    await supersede_slot(db_session, sandbox_id=first_slot.id)
    second_slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert second_slot.id != first_slot.id
    assert second_slot.slot_generation == 2

    stale_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        active_sandbox_id=first_slot.id,
        slot_generation=first_slot.slot_generation or 0,
        anyharness_base_url="http://127.0.0.1:11001",
        runtime_token_ciphertext="token-stale",
        anyharness_data_key_ciphertext="key-stale",
        worker_id=None,
        heartbeat_at=heartbeat_at,
    )
    assert stale_access is None

    current_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        active_sandbox_id=second_slot.id,
        slot_generation=second_slot.slot_generation or 0,
        anyharness_base_url="http://127.0.0.1:11002",
        runtime_token_ciphertext="token-2",
        anyharness_data_key_ciphertext="key-2",
        worker_id=None,
        heartbeat_at=heartbeat_at,
    )
    assert current_access is not None
    assert current_access.active_sandbox_id == second_slot.id
    assert current_access.slot_generation == 2

    touched_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        active_sandbox_id=second_slot.id,
        slot_generation=second_slot.slot_generation or 0,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        worker_id=None,
        heartbeat_at=utcnow(),
    )
    assert touched_access is not None
    assert touched_access.anyharness_base_url == "http://127.0.0.1:11002"
    assert touched_access.runtime_token_ciphertext == "token-2"
    assert touched_access.anyharness_data_key_ciphertext == "key-2"

    state = await agent_auth_store.upsert_target_state(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        desired_revision=3,
        applied_revision=3,
        status="applied",
        force_restart_required=False,
        last_command_id=None,
        last_worker_id=None,
        last_error_code=None,
        last_error_message=None,
    )
    assert state.active_sandbox_id == second_slot.id
    assert state.slot_generation == second_slot.slot_generation

    await supersede_slot(db_session, sandbox_id=second_slot.id)
    invalidated_state = await agent_auth_store.get_target_state(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert invalidated_state is not None
    assert invalidated_state.active_sandbox_id is None
    assert invalidated_state.slot_generation is None
    assert invalidated_state.agent_auth_status == "pending"

    third_slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert third_slot.id != second_slot.id
    assert third_slot.slot_generation == 3
    changed_slot_touch = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        active_sandbox_id=third_slot.id,
        slot_generation=third_slot.slot_generation or 0,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        worker_id=None,
        heartbeat_at=utcnow(),
    )
    assert changed_slot_touch is not None
    assert changed_slot_touch.active_sandbox_id == third_slot.id
    assert changed_slot_touch.slot_generation == third_slot.slot_generation
    assert changed_slot_touch.anyharness_base_url is None
    assert changed_slot_touch.runtime_token_ciphertext is None
    assert changed_slot_touch.anyharness_data_key_ciphertext is None


@pytest.mark.asyncio
async def test_materialize_workspace_rejects_mismatched_cloud_workspace_result(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="sandbox-profile-command",
    )
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=auth.headers,
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    profile_id = uuid.UUID(profile["id"])
    target_id = uuid.UUID(profile["primaryTargetId"])
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash="worker-token-hash",
        machine_fingerprint="machine-1",
        hostname="worker-1",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    workspace = await create_managed_cloud_workspace_for_profile(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        created_by_user_id=uuid.UUID(auth.user_id),
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/sandbox-foundation",
        git_base_branch="main",
        worktree_path="/workspace/rocket",
        origin_json=None,
        template_version="managed-cloud-v1",
    )
    command = await commands_store.create_command(
        db_session,
        idempotency_scope="test",
        idempotency_key="materialize-mismatch",
        target_id=target_id,
        organization_id=None,
        actor_user_id=uuid.UUID(auth.user_id),
        actor_kind="user",
        source="api",
        workspace_id=None,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "worktree"}),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    now = utcnow()
    leased = await commands_store.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(CloudCommandKind.materialize_workspace.value,),
        lease_id="lease-1",
        lease_expires_at=now + timedelta(minutes=5),
        now=now,
    )
    assert leased is not None
    assert leased.id == command.id
    assert leased.leased_cloud_sandbox_id == slot.id
    assert leased.leased_slot_generation == slot.slot_generation

    mismatched_cloud_workspace_id = uuid.uuid4()
    result = await commands_store.record_command_result(
        db_session,
        command_id=command.id,
        worker_id=worker.id,
        lease_id="lease-1",
        status=CloudCommandStatus.accepted.value,
        error_code=None,
        error_message=None,
        result_json=json.dumps(
            {
                "mode": "worktree",
                "anyharnessWorkspaceId": "anyharness-workspace-1",
                "repoRootId": "repo-root-1",
                "path": "/workspace/rocket",
                "kind": "worktree",
                "cloudWorkspaceId": str(mismatched_cloud_workspace_id),
            }
        ),
        cloud_workspace_id=mismatched_cloud_workspace_id,
        slot_generation=slot.slot_generation,
        anyharness_workspace_id="anyharness-workspace-1",
        now=utcnow(),
    )

    assert result is not None
    assert result.status == CloudCommandStatus.rejected.value
    assert result.error_code == "cloud_workspace_not_found"
    await db_session.refresh(workspace)
    assert workspace.anyharness_workspace_id is None
    assert workspace.materialized_slot_generation is None
    workspace_count = await db_session.scalar(select(func.count(CloudWorkspace.id)))
    assert workspace_count == 1


@pytest.mark.asyncio
async def test_managed_materialize_workspace_requires_cloud_workspace_id(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-materialize-requires-cloud-workspace",
    )
    _slot, worker = await _create_profile_slot_worker(
        db_session,
        profile_id=profile_id,
        target_id=target_id,
        worker_name="materialize-cloud-workspace-worker",
    )

    response = await client.post(
        "/v1/cloud/commands",
        headers=auth.headers,
        json={
            "idempotencyKey": "missing-cloud-workspace",
            "targetId": str(target_id),
            "kind": "materialize_workspace",
            "payload": {
                "mode": "worktree",
                "repoRootId": "repo-root-1",
                "targetPath": "/workspace/feature",
                "newBranchName": "proliferate/missing-cloud-workspace",
            },
            "source": "automation",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "cloud_command_cloud_workspace_required"

    with pytest.raises(RuntimeError):
        await commands_store.create_command(
            db_session,
            idempotency_scope="missing-cloud-workspace",
            idempotency_key="store-create",
            target_id=target_id,
            organization_id=None,
            actor_user_id=uuid.UUID(auth.user_id),
            actor_kind="user",
            source="api",
            workspace_id=None,
            cloud_workspace_id=None,
            session_id=None,
            kind=CloudCommandKind.materialize_workspace.value,
            payload_json=json.dumps({"mode": "worktree"}),
            observed_event_seq=None,
            preconditions_json=None,
            authorization_context_json=None,
        )

    now = utcnow()
    legacy_command = CloudCommand(
        idempotency_scope="missing-cloud-workspace",
        idempotency_key="legacy-row",
        target_id=target_id,
        organization_id=None,
        actor_user_id=uuid.UUID(auth.user_id),
        actor_kind="user",
        source="api",
        workspace_id=None,
        cloud_workspace_id=None,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "worktree"}),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
        status=CloudCommandStatus.queued.value,
        attempt_count=0,
        created_at=now,
        updated_at=now,
    )
    db_session.add(legacy_command)
    await db_session.flush()
    leased = await commands_store.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(CloudCommandKind.materialize_workspace.value,),
        lease_id="missing-cloud-workspace-lease",
        lease_expires_at=now + timedelta(minutes=5),
        now=now,
    )
    assert leased is None
    await db_session.refresh(legacy_command)
    assert legacy_command.status == CloudCommandStatus.rejected.value
    assert legacy_command.error_code == "cloud_workspace_required"


@pytest.mark.asyncio
async def test_managed_materialize_workspace_keeps_cloud_metadata_out_of_payload(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-materialize-payload",
    )
    workspace = await create_managed_cloud_workspace_for_profile(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        created_by_user_id=uuid.UUID(auth.user_id),
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        git_branch="feature/payload",
        git_base_branch="main",
        worktree_path="/workspace/payload",
        origin_json=None,
        template_version="managed-cloud-v1",
    )
    await db_session.commit()

    response = await client.post(
        "/v1/cloud/commands",
        headers=auth.headers,
        json={
            "idempotencyKey": "managed-materialize-payload",
            "targetId": str(target_id),
            "cloudWorkspaceId": str(workspace.id),
            "kind": "materialize_workspace",
            "payload": {
                "mode": "worktree",
                "repoRootId": "repo-root-1",
                "targetPath": "/workspace/payload",
                "newBranchName": "proliferate/payload",
                "baseBranch": "main",
            },
            "source": "automation",
        },
    )

    assert response.status_code == 200
    command = await db_session.get(CloudCommand, uuid.UUID(response.json()["commandId"]))
    assert command is not None
    assert command.cloud_workspace_id == workspace.id
    payload = json.loads(command.payload_json)
    assert payload["repoRootId"] == "repo-root-1"
    assert "cloudWorkspaceId" not in payload
    assert "sandboxProfileId" not in payload


@pytest.mark.asyncio
async def test_stale_managed_worker_agent_auth_side_channel_fails_closed(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-side-channel-stale",
    )
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker_token = "stale-side-channel-worker-token"
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=worker_service._hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint="stale-side-channel",
        hostname="stale-side-channel",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
        db_session,
        sandbox_profile_id=profile_id,
        reason="side_channel_test",
        actor_user_id=uuid.UUID(auth.user_id),
        force_restart=False,
    )
    assert profile is not None
    command = await commands_store.create_command(
        db_session,
        idempotency_scope="side-channel-stale",
        idempotency_key="agent-auth-refresh",
        target_id=target_id,
        organization_id=None,
        actor_user_id=uuid.UUID(auth.user_id),
        actor_kind="system",
        source="api",
        workspace_id=None,
        cloud_workspace_id=None,
        session_id=None,
        kind=CloudCommandKind.refresh_agent_auth_config.value,
        payload_json=json.dumps(
            {
                "sandboxProfileId": str(profile_id),
                "revision": profile.agent_auth_revision,
                "reason": "side_channel_test",
                "forceRestart": False,
            }
        ),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    lease_id = "side-channel-lease"
    leased = await commands_store.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(CloudCommandKind.refresh_agent_auth_config.value,),
        lease_id=lease_id,
        lease_expires_at=utcnow() + timedelta(minutes=5),
        now=utcnow(),
    )
    assert leased is not None
    assert leased.id == command.id
    await agent_auth_store.upsert_target_state(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=None,
        status="materializing",
        force_restart_required=False,
        last_command_id=command.id,
        last_worker_id=worker.id,
        last_error_code=None,
        last_error_message=None,
    )
    await supersede_slot(db_session, sandbox_id=slot.id)
    await db_session.commit()

    response = await client.get(
        f"/v1/cloud/worker/agent-auth-configs/{profile_id}/materialization",
        headers={"Authorization": f"Bearer {worker_token}"},
        params={
            "command_id": str(command.id),
            "revision": profile.agent_auth_revision,
            "lease_id": lease_id,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "cloud_worker_slot_stale"


@pytest.mark.asyncio
async def test_lease_supersedes_launch_when_agent_auth_revision_stales(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="stale-agent-auth-lease",
    )
    slot, worker = await _create_profile_slot_worker(
        db_session,
        profile_id=profile_id,
        target_id=target_id,
        worker_name="stale-agent-auth-lease-worker",
    )
    profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
        db_session,
        sandbox_profile_id=profile_id,
        reason="initial",
        actor_user_id=uuid.UUID(auth.user_id),
        force_restart=False,
    )
    assert profile is not None
    await agent_auth_store.upsert_target_state(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=profile.agent_auth_revision,
        status="applied",
        force_restart_required=False,
        last_command_id=None,
        last_worker_id=worker.id,
        last_error_code=None,
        last_error_message=None,
    )
    command = await commands_store.create_command(
        db_session,
        idempotency_scope="stale-agent-auth-lease",
        idempotency_key="stale-agent-auth-lease",
        target_id=target_id,
        organization_id=None,
        actor_user_id=uuid.UUID(auth.user_id),
        actor_kind="user",
        source="api",
        workspace_id=None,
        cloud_workspace_id=None,
        session_id=None,
        kind=CloudCommandKind.start_session.value,
        payload_json=json.dumps(
            {
                "workspaceId": "workspace-auth-stale",
                "agent": "claude",
                "sandboxProfileId": str(profile_id),
                "requiredAgentAuthRevision": profile.agent_auth_revision,
            }
        ),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    stale_profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
        db_session,
        sandbox_profile_id=profile_id,
        reason="revoked",
        actor_user_id=uuid.UUID(auth.user_id),
        force_restart=True,
    )
    assert stale_profile is not None
    leased = await commands_store.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(
            CloudCommandKind.start_session.value,
            CloudCommandKind.refresh_agent_auth_config.value,
        ),
        lease_id="stale-agent-auth-lease",
        lease_expires_at=utcnow() + timedelta(minutes=5),
        now=utcnow(),
    )
    assert leased is None
    row = await db_session.get(CloudCommand, command.id)
    assert row is not None
    assert row.status == CloudCommandStatus.superseded.value
    assert row.error_code == "agent_auth_revision_stale"
    assert row.leased_cloud_sandbox_id is None
    assert slot.slot_generation is not None


@pytest.mark.asyncio
async def test_lease_supersedes_launch_when_runtime_config_revision_stales(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="stale-runtime-config-lease",
    )
    _slot, worker = await _create_profile_slot_worker(
        db_session,
        profile_id=profile_id,
        target_id=target_id,
        worker_name="stale-runtime-config-lease-worker",
    )
    profile = await agent_auth_store.bump_sandbox_profile_agent_auth_revision(
        db_session,
        sandbox_profile_id=profile_id,
        reason="initial",
        actor_user_id=uuid.UUID(auth.user_id),
        force_restart=False,
    )
    assert profile is not None
    await agent_auth_store.upsert_target_state(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        desired_revision=profile.agent_auth_revision,
        applied_revision=profile.agent_auth_revision,
        status="applied",
        force_restart_required=False,
        last_command_id=None,
        last_worker_id=worker.id,
        last_error_code=None,
        last_error_message=None,
    )
    revision, _created = await runtime_config_store.upsert_revision_and_current(
        db_session,
        sandbox_profile_id=profile_id,
        content_hash="sha256:runtime-config-v1",
        manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
        warnings_json=None,
        source="test",
        generated_by_user_id=uuid.UUID(auth.user_id),
    )
    state = (
        await db_session.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
        )
    ).scalar_one()
    state.applied_runtime_config_revision_id = str(revision.id)
    state.applied_runtime_config_sequence = revision.sequence
    state.runtime_config_status = "applied"
    command = await commands_store.create_command(
        db_session,
        idempotency_scope="stale-runtime-config-lease",
        idempotency_key="stale-runtime-config-lease",
        target_id=target_id,
        organization_id=None,
        actor_user_id=uuid.UUID(auth.user_id),
        actor_kind="user",
        source="api",
        workspace_id=None,
        cloud_workspace_id=None,
        session_id=None,
        kind=CloudCommandKind.start_session.value,
        payload_json=json.dumps(
            {
                "workspaceId": "workspace-runtime-stale",
                "agent": "claude",
                "sandboxProfileId": str(profile_id),
                "requiredAgentAuthRevision": profile.agent_auth_revision,
                "requiredRuntimeConfigRevisionId": str(revision.id),
                "requiredRuntimeConfigSequence": revision.sequence,
                "requiredRuntimeConfigContentHash": revision.content_hash,
            }
        ),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )
    await runtime_config_store.upsert_revision_and_current(
        db_session,
        sandbox_profile_id=profile_id,
        content_hash="sha256:runtime-config-v2",
        manifest_json='{"mcpServers":[],"skills":[],"blockingErrors":[]}',
        warnings_json=None,
        source="test",
        generated_by_user_id=uuid.UUID(auth.user_id),
    )

    leased = await commands_store.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(
            CloudCommandKind.start_session.value,
            CloudCommandKind.refresh_agent_auth_config.value,
        ),
        lease_id="stale-runtime-config-lease",
        lease_expires_at=utcnow() + timedelta(minutes=5),
        now=utcnow(),
    )

    assert leased is None
    row = await db_session.get(CloudCommand, command.id)
    assert row is not None
    assert row.status == CloudCommandStatus.superseded.value
    assert row.error_code == "runtime_config_revision_stale"
    assert row.leased_cloud_sandbox_id is None


@pytest.mark.asyncio
async def test_stale_worker_runtime_config_status_does_not_regress_target_state(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="stale-runtime-config-status",
    )
    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    worker_token = "stale-runtime-config-status-token"
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=slot.id,
        slot_generation=slot.slot_generation,
        token_hash=worker_service._hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint="stale-runtime-config-status",
        hostname="stale-runtime-config-status",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    first_revision, _created = await runtime_config_store.upsert_revision_and_current(
        db_session,
        sandbox_profile_id=profile_id,
        content_hash="sha256:stale-status-v1",
        manifest_json='{"mcpServers":[],"skills":[],"artifacts":[],"warnings":[]}',
        warnings_json=None,
        source="test",
        generated_by_user_id=uuid.UUID(auth.user_id),
    )
    second_revision, _created = await runtime_config_store.upsert_revision_and_current(
        db_session,
        sandbox_profile_id=profile_id,
        content_hash="sha256:stale-status-v2",
        manifest_json='{"mcpServers":[],"skills":[],"artifacts":[],"warnings":[]}',
        warnings_json=None,
        source="test",
        generated_by_user_id=uuid.UUID(auth.user_id),
    )
    await agent_auth_store.upsert_target_state(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        desired_revision=0,
        applied_revision=0,
        status="applied",
        force_restart_required=False,
        last_command_id=None,
        last_worker_id=worker.id,
        last_error_code=None,
        last_error_message=None,
    )
    state = (
        await db_session.execute(
            select(SandboxProfileTargetState).where(
                SandboxProfileTargetState.sandbox_profile_id == profile_id,
                SandboxProfileTargetState.target_id == target_id,
            )
        )
    ).scalar_one()
    state.runtime_config_status = "pending"
    state.applied_runtime_config_sequence = second_revision.sequence
    state.applied_runtime_config_revision_id = str(second_revision.id)
    await db_session.commit()

    response = await client.post(
        f"/v1/cloud/worker/runtime-configs/{first_revision.id}/status",
        headers={"Authorization": f"Bearer {worker_token}"},
        json={
            "status": "applied",
            "missingArtifacts": [],
            "missingCredentials": [],
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "revisionId": str(first_revision.id),
        "status": "stale",
        "updated": False,
    }
    await db_session.refresh(state)
    assert state.runtime_config_status == "pending"
    assert state.applied_runtime_config_revision_id == str(second_revision.id)
    assert state.applied_runtime_config_sequence == second_revision.sequence


@pytest.mark.asyncio
async def test_managed_worker_without_slot_cannot_lease_or_report_result(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, _profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-null-slot-worker",
    )
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=None,
        slot_generation=None,
        token_hash="null-slot-worker-token-hash",
        machine_fingerprint="null-slot-worker",
        hostname="null-slot-worker",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    command = await commands_store.create_command(
        db_session,
        idempotency_scope="null-slot-worker",
        idempotency_key="ensure-repo-null-slot",
        target_id=target_id,
        organization_id=None,
        actor_user_id=uuid.UUID(auth.user_id),
        actor_kind="user",
        source="api",
        workspace_id=None,
        cloud_workspace_id=None,
        session_id=None,
        kind=CloudCommandKind.ensure_repo_checkout.value,
        payload_json=json.dumps({"provider": "github", "owner": "acme", "name": "rocket"}),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
    )

    leased = await commands_store.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(CloudCommandKind.ensure_repo_checkout.value,),
        lease_id="null-slot-lease",
        lease_expires_at=utcnow() + timedelta(minutes=5),
        now=utcnow(),
    )
    assert leased is None

    row = await db_session.get(CloudCommand, command.id)
    assert row is not None
    row.status = CloudCommandStatus.leased.value
    row.lease_id = "legacy-null-slot-lease"
    row.leased_by_worker_id = worker.id
    row.leased_cloud_sandbox_id = None
    row.leased_slot_generation = None
    await db_session.flush()

    result = await commands_store.record_command_result(
        db_session,
        command_id=command.id,
        worker_id=worker.id,
        lease_id="legacy-null-slot-lease",
        status=CloudCommandStatus.accepted.value,
        error_code=None,
        error_message=None,
        result_json=None,
        cloud_workspace_id=None,
        slot_generation=None,
        anyharness_workspace_id=None,
        now=utcnow(),
    )

    assert result is not None
    assert result.status == CloudCommandStatus.superseded.value
    assert result.error_code == "stale_slot"


@pytest.mark.asyncio
async def test_managed_profile_target_enrollment_requires_slot_identity(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, _profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-null-slot-enrollment",
    )
    token = "profile-target-null-slot-enrollment"
    await worker_auth_store.create_enrollment(
        db_session,
        target_id=target_id,
        token_hash=worker_service._hash_token(
            domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
            token=token,
        ),
        created_by_user_id=uuid.UUID(auth.user_id),
        expires_at=utcnow() + timedelta(minutes=5),
    )
    await db_session.commit()

    response = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": token,
            "machineFingerprint": "null-slot-enrollment",
            "hostname": "null-slot-enrollment",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "cloud_worker_slot_identity_required"


@pytest.mark.asyncio
async def test_managed_command_result_requires_leased_slot_generation_echo(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-slot-generation-echo",
    )
    slot, worker = await _create_profile_slot_worker(
        db_session,
        profile_id=profile_id,
        target_id=target_id,
        worker_name="slot-generation-worker",
    )
    for index, reported_generation in enumerate((None, (slot.slot_generation or 0) + 1), start=1):
        command = await commands_store.create_command(
            db_session,
            idempotency_scope=f"slot-generation-echo-{index}",
            idempotency_key=f"ensure-repo-slot-generation-{index}",
            target_id=target_id,
            organization_id=None,
            actor_user_id=uuid.UUID(auth.user_id),
            actor_kind="user",
            source="api",
            workspace_id=None,
            cloud_workspace_id=None,
            session_id=None,
            kind=CloudCommandKind.ensure_repo_checkout.value,
            payload_json=json.dumps({"provider": "github", "owner": "acme", "name": "rocket"}),
            observed_event_seq=None,
            preconditions_json=None,
            authorization_context_json=None,
        )
        lease_id = f"slot-generation-lease-{index}"
        leased = await commands_store.lease_next_command(
            db_session,
            target_id=target_id,
            worker_id=worker.id,
            supported_kinds=(CloudCommandKind.ensure_repo_checkout.value,),
            lease_id=lease_id,
            lease_expires_at=utcnow() + timedelta(minutes=5),
            now=utcnow(),
        )
        assert leased is not None
        assert leased.id == command.id
        assert leased.leased_slot_generation == slot.slot_generation

        result = await commands_store.record_command_result(
            db_session,
            command_id=command.id,
            worker_id=worker.id,
            lease_id=lease_id,
            status=CloudCommandStatus.accepted.value,
            error_code=None,
            error_message=None,
            result_json=None,
            cloud_workspace_id=None,
            slot_generation=reported_generation,
            anyharness_workspace_id=None,
            now=utcnow(),
        )

        assert result is not None
        assert result.status == CloudCommandStatus.superseded.value
        assert result.error_code == "stale_slot"


@pytest.mark.asyncio
async def test_profile_target_writes_reject_cross_owner_and_mismatched_targets(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth_one, profile_one_id, target_one_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-owner-one",
    )
    _auth_two, profile_two_id, target_two_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-owner-two",
    )

    with pytest.raises(RuntimeError):
        await ensure_profile_slot(
            db_session,
            sandbox_profile_id=profile_one_id,
            target_id=target_two_id,
        )
    with pytest.raises(RuntimeError):
        await create_managed_cloud_workspace_for_profile(
            db_session,
            sandbox_profile_id=profile_one_id,
            target_id=target_two_id,
            created_by_user_id=uuid.UUID(auth_one.user_id),
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="feature/mismatch",
            git_base_branch="main",
            worktree_path="/workspace/mismatch",
            origin_json=None,
            template_version="managed-cloud-v1",
        )

    slot = await ensure_profile_slot(
        db_session,
        sandbox_profile_id=profile_one_id,
        target_id=target_one_id,
    )
    mismatched_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_two_id,
        sandbox_profile_id=profile_one_id,
        active_sandbox_id=slot.id,
        slot_generation=slot.slot_generation or 0,
        anyharness_base_url="http://127.0.0.1:11000",
        runtime_token_ciphertext="token",
        anyharness_data_key_ciphertext="key",
        worker_id=None,
        heartbeat_at=utcnow(),
    )
    assert mismatched_access is None

    target_one = await db_session.get(CloudTarget, target_one_id)
    assert target_one is not None
    target_one.owner_user_id = uuid.UUID(_auth_two.user_id)
    await db_session.flush()
    with pytest.raises(RuntimeError):
        await create_managed_cloud_workspace_for_profile(
            db_session,
            sandbox_profile_id=profile_one_id,
            target_id=target_one_id,
            created_by_user_id=uuid.UUID(auth_one.user_id),
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="feature/owner-mismatch",
            git_base_branch="main",
            worktree_path="/workspace/owner-mismatch",
            origin_json=None,
            template_version="managed-cloud-v1",
        )

    assert profile_two_id != profile_one_id


@pytest.mark.asyncio
async def test_managed_worker_inventory_requires_current_slot(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    _auth, _profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-inventory-slot",
    )
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        cloud_sandbox_id=None,
        slot_generation=None,
        token_hash="inventory-null-slot-token-hash",
        machine_fingerprint="inventory-null-slot",
        hostname="inventory-null-slot",
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )

    with pytest.raises(CloudApiError) as exc_info:
        await worker_service.record_inventory(
            db_session,
            auth=WorkerAuthContext(
                worker_id=worker.id,
                target_id=target_id,
                cloud_sandbox_id=None,
                slot_generation=None,
            ),
            body=WorkerInventoryRequest.model_validate({"status": "online"}),
        )

    assert exc_info.value.code == "cloud_worker_slot_identity_required"
