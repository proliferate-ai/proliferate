from __future__ import annotations

import json
import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.cloud import CloudCommandKind, CloudCommandStatus
from proliferate.db.models.cloud.commands import CloudCommand
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_sandboxes import ensure_managed_sandbox_for_target
from proliferate.db.store.cloud_sync import command_leases, command_results, commands
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_workspace_creation import (
    create_managed_cloud_workspace_for_profile,
)
from proliferate.utils.time import utcnow
from tests.e2e.cloud.helpers.auth import create_user_and_login


@pytest.mark.asyncio
async def test_existing_path_materialize_cannot_scope_cloud_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-materialize-existing-path-scope",
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
        token_hash="existing-path-scope-worker-token-hash",
        machine_fingerprint="existing-path-scope-worker",
        hostname="existing-path-scope-worker",
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
        git_branch="feature/existing-path-scope",
        git_base_branch="main",
        worktree_path="/workspace/rocket",
        origin_json=None,
        template_version="managed-cloud-v1",
    )

    response = await client.post(
        "/v1/cloud/commands",
        headers=auth.headers,
        json={
            "idempotencyKey": "existing-path-scoped",
            "targetId": str(target_id),
            "cloudWorkspaceId": str(workspace.id),
            "kind": "materialize_workspace",
            "payload": {"mode": "existing_path", "path": "/workspace/rocket"},
            "source": "automation",
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "cloud_command_cloud_workspace_not_allowed"

    with pytest.raises(RuntimeError):
        await commands.create_command(
            db_session,
            idempotency_scope="existing-path-scoped",
            idempotency_key="store-create",
            target_id=target_id,
            organization_id=None,
            actor_user_id=uuid.UUID(auth.user_id),
            actor_kind="user",
            source="api",
            workspace_id=None,
            cloud_workspace_id=workspace.id,
            session_id=None,
            kind=CloudCommandKind.materialize_workspace.value,
            payload_json=json.dumps({"mode": "existing_path", "path": "/workspace/rocket"}),
            observed_event_seq=None,
            preconditions_json=None,
            authorization_context_json=None,
        )

    now = utcnow()
    queued_legacy_command = _legacy_command(
        target_id=target_id,
        actor_user_id=uuid.UUID(auth.user_id),
        cloud_workspace_id=workspace.id,
        idempotency_key="legacy-queued-row",
        status=CloudCommandStatus.queued.value,
        now=now,
    )
    db_session.add(queued_legacy_command)
    await db_session.flush()
    leased = await command_leases.lease_next_command(
        db_session,
        target_id=target_id,
        worker_id=worker.id,
        supported_kinds=(CloudCommandKind.materialize_workspace.value,),
        lease_id="existing-path-queued-lease",
        lease_expires_at=now + timedelta(minutes=5),
        now=now,
    )
    assert leased is None
    await db_session.refresh(queued_legacy_command)
    assert queued_legacy_command.status == CloudCommandStatus.rejected.value
    assert queued_legacy_command.error_code == "cloud_workspace_not_allowed"

    already_leased_command = _legacy_command(
        target_id=target_id,
        actor_user_id=uuid.UUID(auth.user_id),
        cloud_workspace_id=workspace.id,
        idempotency_key="legacy-leased-row",
        status=CloudCommandStatus.leased.value,
        worker_id=worker.id,
        lease_id="existing-path-lease",
        now=now,
    )
    db_session.add(already_leased_command)
    await db_session.flush()

    result = await command_results.record_command_result(
        db_session,
        command_id=already_leased_command.id,
        worker_id=worker.id,
        lease_id="existing-path-lease",
        status=CloudCommandStatus.accepted.value,
        error_code=None,
        error_message=None,
        result_json=json.dumps(
            {
                "mode": "existing_path",
                "anyharnessWorkspaceId": "repo-root-workspace",
                "repoRootId": "repo-root-1",
                "path": "/workspace/rocket",
                "kind": "local",
            }
        ),
        cloud_workspace_id=None,
        anyharness_workspace_id="repo-root-workspace",
        now=utcnow(),
    )
    assert result is not None
    assert result.status == CloudCommandStatus.rejected.value
    assert result.error_code == "cloud_workspace_not_allowed"
    await db_session.refresh(workspace)
    assert workspace.anyharness_workspace_id is None
    assert workspace.materialized_target_id is None


def _legacy_command(
    *,
    target_id: uuid.UUID,
    actor_user_id: uuid.UUID,
    cloud_workspace_id: uuid.UUID,
    idempotency_key: str,
    status: str,
    now,
    worker_id: uuid.UUID | None = None,
    lease_id: str | None = None,
) -> CloudCommand:
    return CloudCommand(
        idempotency_scope="existing-path-scoped",
        idempotency_key=idempotency_key,
        target_id=target_id,
        organization_id=None,
        actor_user_id=actor_user_id,
        actor_kind="user",
        source="api",
        workspace_id=None,
        cloud_workspace_id=cloud_workspace_id,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload_json=json.dumps({"mode": "existing_path", "path": "/workspace/rocket"}),
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=None,
        status=status,
        lease_id=lease_id,
        leased_by_worker_id=worker_id,
        lease_expires_at=now + timedelta(minutes=5) if lease_id is not None else None,
        attempt_count=1 if lease_id is not None else 0,
        created_at=now,
        updated_at=now,
    )
