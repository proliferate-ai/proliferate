from __future__ import annotations

import asyncio
import json
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.cloud.agent_auth import SandboxProfile
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot, supersede_slot
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_workspaces import create_managed_cloud_workspace_for_profile
from proliferate.utils.time import utcnow
from tests.e2e.cloud.helpers.auth import create_user_and_login


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
