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
from proliferate.db.store.cloud_sandboxes import (
    ensure_managed_sandbox_for_target,
    get_active_sandbox,
    load_active_sandbox_for_profile_target,
    mark_managed_sandbox_terminal,
)
from proliferate.db.store.cloud_runtime_config import revisions as runtime_config_store
from proliferate.db.store.cloud_sync import command_leases, commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_workspaces import (
    create_managed_cloud_workspace_for_profile,
)
from proliferate.server.cloud.runtime import wake as runtime_wake
from proliferate.server.cloud.worker import auth as worker_auth
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


async def _create_profile_sandbox_worker(
    db_session: AsyncSession,
    *,
    profile_id: uuid.UUID,
    target_id: uuid.UUID,
    worker_name: str,
) -> tuple[object, object]:
    profile = await agent_auth_store.get_sandbox_profile(db_session, profile_id)
    assert profile is not None
    sandbox = await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=profile.billing_subject_id,
        status="running",
    )
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        token_hash=f"{worker_name}-token-hash",
        machine_fingerprint=worker_name,
        hostname=worker_name,
        worker_version="0.1.0",
        anyharness_version="0.1.0",
        supervisor_version=None,
        now=utcnow(),
    )
    return sandbox, worker


@pytest.mark.asyncio
async def test_personal_profile_ensure_is_idempotent_and_does_not_create_sandbox(
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
    sandbox_count = await db_session.scalar(select(func.count(CloudSandbox.id)))
    assert profile_count == 1
    assert target_count == 1
    assert sandbox_count == 0

    target = await db_session.get(CloudTarget, uuid.UUID(first_payload["primaryTargetId"]))
    assert target is not None
    assert target.sandbox_profile_id == uuid.UUID(first_payload["id"])
    assert target.profile_target_role == "primary"
    assert target.kind == "managed_cloud"
    assert target.owner_scope == "personal"
    assert target.owner_user_id == uuid.UUID(auth.user_id)
    assert target.organization_id is None


@pytest.mark.asyncio
async def test_org_profile_primary_target_uses_org_scope_and_no_eager_sandbox(
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

    sandbox_count = await db_session.scalar(select(func.count(CloudSandbox.id)))
    assert sandbox_count == 0


@pytest.mark.asyncio
async def test_managed_sandbox_and_runtime_access_are_target_scoped(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="sandbox-profile-target-runtime-access",
    )
    profile_response = await client.post(
        "/v1/cloud/sandbox-profiles/personal",
        headers=auth.headers,
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    profile_id = uuid.UUID(profile["id"])
    target_id = uuid.UUID(profile["primaryTargetId"])
    billing_subject_id = uuid.UUID(profile["billingSubjectId"])

    first_sandbox = await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=billing_subject_id,
        status="provisioning",
    )
    same_sandbox = await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=billing_subject_id,
    )
    assert same_sandbox.id == first_sandbox.id
    active_sandbox = await load_active_sandbox_for_profile_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert active_sandbox is not None
    assert active_sandbox.id == first_sandbox.id

    heartbeat_at = utcnow()
    first_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        cloud_sandbox_id=first_sandbox.id,
        anyharness_base_url="http://127.0.0.1:11000",
        runtime_token_ciphertext="token-1",
        anyharness_data_key_ciphertext="key-1",
        worker_id=None,
        heartbeat_at=heartbeat_at,
    )
    assert first_access is not None
    assert first_access.target_id == target_id
    assert first_access.sandbox_profile_id == profile_id
    assert first_access.cloud_sandbox_id == first_sandbox.id

    await mark_managed_sandbox_terminal(db_session, sandbox_id=first_sandbox.id)
    inactive_sandbox = await load_active_sandbox_for_profile_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
    )
    assert inactive_sandbox is None

    terminal_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        cloud_sandbox_id=first_sandbox.id,
        anyharness_base_url="http://127.0.0.1:11001",
        runtime_token_ciphertext="token-terminal",
        anyharness_data_key_ciphertext="key-terminal",
        worker_id=None,
        heartbeat_at=heartbeat_at,
    )
    assert terminal_access is None

    second_sandbox = await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=billing_subject_id,
        status="running",
    )
    assert second_sandbox.id != first_sandbox.id

    changed_sandbox_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_id,
        sandbox_profile_id=profile_id,
        cloud_sandbox_id=second_sandbox.id,
        anyharness_base_url=None,
        runtime_token_ciphertext=None,
        anyharness_data_key_ciphertext=None,
        worker_id=None,
        heartbeat_at=utcnow(),
    )
    assert changed_sandbox_access is not None
    assert changed_sandbox_access.cloud_sandbox_id == second_sandbox.id
    assert changed_sandbox_access.anyharness_base_url is None
    assert changed_sandbox_access.runtime_token_ciphertext is None
    assert changed_sandbox_access.anyharness_data_key_ciphertext is None

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
    assert state.sandbox_profile_id == profile_id
    assert state.target_id == target_id
    assert state.agent_auth_status == "applied"


@pytest.mark.asyncio
async def test_workspace_active_sandbox_falls_back_to_profile_target_sandbox(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-active-sandbox",
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
        git_branch="feature/profile-sandbox",
        git_base_branch="main",
        worktree_path="/workspace/profile-sandbox",
        origin_json=None,
        template_version="managed-cloud-v1",
    )
    profile = await agent_auth_store.get_sandbox_profile(db_session, profile_id)
    assert profile is not None
    sandbox = await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=profile.billing_subject_id,
        status="running",
    )
    sandbox_row = await db_session.get(CloudSandbox, sandbox.id)
    assert sandbox_row is not None
    sandbox_row.external_sandbox_id = "sandbox-profile-active-sandbox"
    await db_session.flush()

    workspace.active_sandbox_id = None
    await db_session.flush()

    active_sandbox = await get_active_sandbox(db_session, workspace)

    assert active_sandbox is not None
    assert active_sandbox.id == sandbox.id
    assert active_sandbox.sandbox_profile_id == profile_id
    assert active_sandbox.target_id == target_id


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
    profile_record = await agent_auth_store.get_sandbox_profile(db_session, profile_id)
    assert profile_record is not None
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=profile_record.billing_subject_id,
        status="running",
    )
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
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
    leased = await command_leases.lease_next_command(
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
    assert leased.target_id == target_id

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
        anyharness_workspace_id="anyharness-workspace-1",
        now=utcnow(),
    )

    assert result is not None
    assert result.status == CloudCommandStatus.rejected.value
    assert result.error_code == "cloud_workspace_not_found"
    await db_session.refresh(workspace)
    assert workspace.anyharness_workspace_id is None
    assert workspace.materialized_target_id is None
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
    _sandbox, worker = await _create_profile_sandbox_worker(
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
    leased = await command_leases.lease_next_command(
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
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(runtime_wake, "kick_off_managed_target_wake", lambda *_args: None)
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
async def test_archived_managed_worker_agent_auth_side_channel_fails_closed(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-side-channel-archived",
    )
    profile_record = await agent_auth_store.get_sandbox_profile(db_session, profile_id)
    assert profile_record is not None
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=profile_record.billing_subject_id,
        status="running",
    )
    worker_token = "archived-side-channel-worker-token"
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        token_hash=worker_auth.hash_token(
            domain=CLOUD_WORKER_TOKEN_DOMAIN,
            token=worker_token,
        ),
        machine_fingerprint="archived-side-channel",
        hostname="archived-side-channel",
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
    leased = await command_leases.lease_next_command(
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
    await targets_store.archive_target(db_session, target_id=target_id)
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
    assert response.json()["detail"]["code"] == "cloud_worker_target_archived"


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
    _sandbox, worker = await _create_profile_sandbox_worker(
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
    leased = await command_leases.lease_next_command(
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
    _sandbox, worker = await _create_profile_sandbox_worker(
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

    leased = await command_leases.lease_next_command(
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
    profile_record = await agent_auth_store.get_sandbox_profile(db_session, profile_id)
    assert profile_record is not None
    await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        billing_subject_id=profile_record.billing_subject_id,
        status="running",
    )
    worker_token = "stale-runtime-config-status-token"
    worker = await worker_auth_store.create_worker(
        db_session,
        target_id=target_id,
        token_hash=worker_auth.hash_token(
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
async def test_managed_profile_target_enrollment_requires_profile_identity(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, _profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-missing-profile-enrollment",
    )
    token = "profile-target-missing-profile-enrollment"
    await worker_auth_store.create_enrollment(
        db_session,
        target_id=target_id,
        token_hash=worker_auth.hash_token(
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
            "machineFingerprint": "missing-profile-enrollment",
            "hostname": "missing-profile-enrollment",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "cloud_worker_profile_identity_required"


@pytest.mark.asyncio
async def test_managed_profile_target_heartbeat_derives_profile_identity(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth, profile_id, target_id = await _create_personal_profile(
        client,
        db_session,
        email_prefix="sandbox-profile-heartbeat-derived-profile",
    )
    token = "profile-target-derived-profile-heartbeat"
    await worker_auth_store.create_enrollment(
        db_session,
        target_id=target_id,
        token_hash=worker_auth.hash_token(
            domain=CLOUD_TARGET_ENROLLMENT_TOKEN_DOMAIN,
            token=token,
        ),
        created_by_user_id=uuid.UUID(auth.user_id),
        sandbox_profile_id=profile_id,
        expires_at=utcnow() + timedelta(minutes=5),
    )
    await db_session.commit()

    enrolled = await client.post(
        "/v1/cloud/worker/enroll",
        json={
            "enrollmentToken": token,
            "machineFingerprint": "derived-profile-heartbeat",
            "hostname": "derived-profile-heartbeat",
            "workerVersion": "0.1.0",
        },
    )
    assert enrolled.status_code == 200
    worker = enrolled.json()

    heartbeat = await client.post(
        "/v1/cloud/worker/heartbeat",
        headers={"Authorization": f"Bearer {worker['workerToken']}"},
        json={"status": "online", "workerVersion": "0.1.1"},
    )

    assert heartbeat.status_code == 200
    assert heartbeat.json()["sandboxProfileId"] == str(profile_id)
    runtime_access = await targets_store.load_active_runtime_access_for_target(
        db_session,
        target_id=target_id,
    )
    assert runtime_access is not None
    assert runtime_access.sandbox_profile_id == profile_id
    assert runtime_access.last_worker_id == uuid.UUID(worker["workerId"])
    assert runtime_access.last_heartbeat_at is not None


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
        await ensure_managed_sandbox_for_target(
            db_session,
            sandbox_profile_id=profile_one_id,
            target_id=target_two_id,
            billing_subject_id=uuid.uuid4(),
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

    profile_one = await agent_auth_store.get_sandbox_profile(db_session, profile_one_id)
    assert profile_one is not None
    sandbox = await ensure_managed_sandbox_for_target(
        db_session,
        sandbox_profile_id=profile_one_id,
        target_id=target_one_id,
        billing_subject_id=profile_one.billing_subject_id,
        status="running",
    )
    mismatched_access = await targets_store.update_target_runtime_access(
        db_session,
        target_id=target_two_id,
        sandbox_profile_id=profile_one_id,
        cloud_sandbox_id=sandbox.id,
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
