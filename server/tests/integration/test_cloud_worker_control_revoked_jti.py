from __future__ import annotations

from datetime import timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import Organization
from proliferate.db.store.billing import ensure_personal_billing_subject
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_claims import tokens as claim_tokens_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.server.cloud.worker.revoked_jti import mark_revoked_jtis_changed
from proliferate.utils.time import utcnow
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.integration.cloud_event_helpers import create_enrolled_target


@pytest.mark.asyncio
async def test_worker_control_wait_returns_revoked_jtis_from_control_revision(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    auth = await create_user_and_login(
        client,
        db_session,
        email_prefix="cloud-worker-control-revoked-jti",
    )
    target_id_raw, worker_headers = await create_enrolled_target(
        client,
        db_session,
        auth,
        suffix="control-revoked-jti",
    )
    target_id = UUID(target_id_raw)
    organization = Organization(name="Control Revoked JTI Org")
    db_session.add(organization)
    await db_session.flush()
    billing_subject = await ensure_personal_billing_subject(db_session, auth.user_id)
    workspace = CloudWorkspace(
        user_id=auth.user_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization.id,
        created_by_user_id=auth.user_id,
        billing_subject_id=billing_subject.id,
        target_id=target_id,
        display_name="acme/revoked-jti",
        git_provider="github",
        git_owner="acme",
        git_repo_name="revoked-jti",
        normalized_repo_key="github/acme/revoked-jti",
        git_branch="main",
        git_base_branch="main",
        worktree_path="/workspace/revoked-jti",
        origin="manual_web",
        origin_json='{"kind":"human","entrypoint":"cloud"}',
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=0,
        anyharness_workspace_id="workspace-revoked-jti",
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db_session.add(workspace)
    await db_session.flush()
    exposure = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id="workspace-revoked-jti",
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization.id,
        visibility="claimed",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )
    claim = await claims_store.insert_workspace_claim(
        db_session,
        cloud_workspace_id=workspace.id,
        exposure_id=exposure.id,
        organization_id=organization.id,
        target_id=target_id,
        anyharness_workspace_id="workspace-revoked-jti",
        cloud_session_id=None,
        anyharness_session_id=None,
        claimed_by_user_id=UUID(auth.user_id),
        source_kind="manual",
    )
    assert claim is not None
    now = utcnow()
    token = await claim_tokens_store.insert_claim_token(
        db_session,
        claim_id=claim.id,
        token_jti_hash="revoked-jti-hash-control-wait",
        hash_key_id="sha256-v1",
        token_jti_prefix="revoked1",
        issued_to_user_id=UUID(auth.user_id),
        target_id=target_id,
        anyharness_workspace_id="workspace-revoked-jti",
        anyharness_session_id=None,
        permissions="read",
        issued_at=now,
        expires_at=now + timedelta(hours=1),
    )
    await db_session.commit()

    initial = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={"supportedKinds": ["materialize_environment"], "waitSeconds": 0},
    )
    assert initial.status_code == 200, initial.text
    initial_cursor = initial.json()["controlCursor"]

    revoked = await claim_tokens_store.revoke_claim_token(
        db_session,
        token_id=token.id,
        reason="test",
        revoked_at=now,
    )
    assert revoked is not None
    await mark_revoked_jtis_changed(
        db_session,
        target_id=target_id,
        now=now,
    )
    await db_session.commit()

    response = await client.post(
        "/v1/cloud/worker/control/wait",
        headers=worker_headers,
        json={
            "supportedKinds": ["materialize_environment"],
            "leaseCommands": False,
            "controlCursor": initial_cursor,
            "waitSeconds": 0,
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["reason"] == "revoked_jtis"
    assert body["exposures"] is None
    assert body["command"] is None
    assert body["controlCursor"].startswith("v2:")
    assert body["controlCursor"] != initial_cursor
    assert body["revokedJtis"]["hasMore"] is False
    assert body["revokedJtis"]["revokedJtis"] == [
        {
            "jtiHash": "revoked-jti-hash-control-wait",
            "hashKeyId": "sha256-v1",
            "expiresAt": revoked.expires_at.isoformat(),
            "revokedAt": now.isoformat(),
        }
    ]
