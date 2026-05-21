from __future__ import annotations

import json
import uuid

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient
from jose import jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.cloud_sandboxes import ensure_profile_slot
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_claims import claims as claims_store
from proliferate.db.store.cloud_runtime_config import revisions as runtime_config_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_sync import worker_auth as worker_auth_store
from proliferate.db.store.cloud_workspaces import (
    create_managed_cloud_workspace_for_profile,
    get_cloud_workspace_by_id,
)
from proliferate.utils.time import utcnow
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account


@pytest.mark.asyncio
async def test_claim_workspace_is_one_way_and_blocks_nonclaimer_commands(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    (
        owner,
        member,
        workspace_id,
        target_id,
        _profile_id,
        _worker_id,
        _workspace_runtime_id,
    ) = await _seed_claimable_workspace(
        client,
        db_session,
        suffix="one-way",
    )
    workspace = await get_cloud_workspace_by_id(db_session, workspace_id)
    assert workspace is not None
    assert workspace.organization_id is not None
    organization_id = workspace.organization_id
    unclaimed_exposure = await exposures_store.get_active_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace_id,
    )
    assert unclaimed_exposure is not None
    assert unclaimed_exposure.visibility == "shared_unclaimed"
    initial_exposure_revision = unclaimed_exposure.revision

    unclaimed_list = await client.get(
        "/v1/cloud/workspaces",
        headers=member.headers,
        params={
            "ownerScope": "organization",
            "organizationId": str(organization_id),
            "scope": "unclaimed",
        },
    )
    assert unclaimed_list.status_code == 200
    assert str(workspace_id) in _workspace_ids(unclaimed_list.json())

    member_my_before_claim = await client.get(
        "/v1/cloud/workspaces",
        headers=member.headers,
        params={"scope": "my"},
    )
    assert member_my_before_claim.status_code == 200
    assert str(workspace_id) not in _workspace_ids(member_my_before_claim.json())

    claimed = await client.post(
        f"/v1/cloud/workspaces/{workspace_id}/claim",
        headers=member.headers,
        json={"sourceKind": "automation"},
    )
    assert claimed.status_code == 200
    claimed_body = claimed.json()
    assert claimed_body["cloudWorkspaceId"] == str(workspace_id)
    assert claimed_body["claimedByUserId"] == member.user_id
    claim_row = await claims_store.get_claim_for_workspace(db_session, workspace_id)
    assert claim_row is not None
    assert str(claim_row.claimed_by_user_id) == member.user_id
    assert claim_row.source_kind == "automation"
    claimed_exposure = await exposures_store.get_active_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace_id,
    )
    assert claimed_exposure is not None
    assert claimed_exposure.visibility == "claimed"
    assert str(claimed_exposure.claimed_by_user_id) == member.user_id
    assert claimed_exposure.revision == initial_exposure_revision + 1

    unclaimed_after_claim = await client.get(
        "/v1/cloud/workspaces",
        headers=member.headers,
        params={
            "ownerScope": "organization",
            "organizationId": str(organization_id),
            "scope": "unclaimed",
        },
    )
    assert unclaimed_after_claim.status_code == 200
    assert str(workspace_id) not in _workspace_ids(unclaimed_after_claim.json())

    member_my_after_claim = await client.get(
        "/v1/cloud/workspaces",
        headers=member.headers,
        params={"scope": "my"},
    )
    assert member_my_after_claim.status_code == 200
    claimed_summary = _workspace_by_id(member_my_after_claim.json(), workspace_id)
    assert claimed_summary["visibility"] == "claimed"
    assert claimed_summary["claimedByUserId"] == member.user_id
    assert claimed_summary["claimId"] == claimed_body["claimId"]

    owner_my_after_claim = await client.get(
        "/v1/cloud/workspaces",
        headers=owner.headers,
        params={"scope": "my"},
    )
    assert owner_my_after_claim.status_code == 200
    assert str(workspace_id) not in _workspace_ids(owner_my_after_claim.json())

    owner_audit_after_claim = await client.get(
        "/v1/cloud/workspaces",
        headers=owner.headers,
        params={
            "ownerScope": "organization",
            "organizationId": str(organization_id),
            "scope": "org-all",
        },
    )
    assert owner_audit_after_claim.status_code == 200
    audit_summary = _workspace_by_id(owner_audit_after_claim.json(), workspace_id)
    assert audit_summary["visibility"] == "claimed"
    assert audit_summary["claimedByUserId"] == member.user_id

    duplicate = await client.post(
        f"/v1/cloud/workspaces/{workspace_id}/claim",
        headers=owner.headers,
        json={"sourceKind": "manual"},
    )
    assert duplicate.status_code == 403
    assert duplicate.json()["detail"]["code"] == "claim_held_by_other"

    blocked_command = await client.post(
        "/v1/cloud/commands",
        headers=owner.headers,
        json={
            "idempotencyKey": f"blocked-{uuid.uuid4()}",
            "targetId": str(target_id),
            "cloudWorkspaceId": str(workspace_id),
            "kind": "materialize_workspace",
            "payload": {"mode": "existing_path", "path": "/workspace/one-way"},
        },
    )
    assert blocked_command.status_code == 403
    assert blocked_command.json()["detail"]["code"] == "claim_held_by_other"


@pytest.mark.asyncio
async def test_direct_access_token_is_desktop_only_and_signed(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    (
        owner,
        _member,
        workspace_id,
        _target_id,
        profile_id,
        worker_id,
        workspace_runtime_id,
    ) = await _seed_claimable_workspace(
        client,
        db_session,
        suffix="direct",
        with_runtime_access=True,
    )
    private_key_pem, public_key_pem = _rsa_key_pair()
    monkeypatch.setattr(settings, "cloud_jwt_signing_key_pem", private_key_pem.replace("\n", "\\n"))
    monkeypatch.setattr(settings, "cloud_jwt_signing_key_id", "test-kid")
    monkeypatch.setattr(
        settings,
        "cloud_jwt_verification_keys_json",
        json.dumps(
            [
                {
                    "kid": "test-kid",
                    "algorithm": "RS256",
                    "publicKeyPem": public_key_pem.replace("\n", "\\n"),
                }
            ]
        ),
    )
    monkeypatch.setattr(settings, "cloud_jwt_issuer", "https://api.test.proliferate")
    monkeypatch.setattr(settings, "cloud_jwt_audience_anyharness", "anyharness")
    monkeypatch.setattr(settings, "cloud_jwt_direct_attach_ttl_seconds", 1200)
    assert worker_id is not None
    await _mark_runtime_config_applied(
        db_session,
        profile_id=profile_id,
        target_id=_target_id,
        worker_id=worker_id,
        public_key_pem=public_key_pem.replace("\n", "\\n"),
    )

    unclaimed_connection = await client.get(
        f"/v1/cloud/workspaces/{workspace_id}/connection",
        headers=owner.headers,
    )
    assert unclaimed_connection.status_code == 409
    assert unclaimed_connection.json()["detail"]["code"] == "direct_attach_claim_required"

    claim = await client.post(
        f"/v1/cloud/workspaces/{workspace_id}/claim",
        headers=owner.headers,
        json={"sourceKind": "manual"},
    )
    assert claim.status_code == 200

    static_connection = await client.get(
        f"/v1/cloud/workspaces/{workspace_id}/connection",
        headers=owner.headers,
    )
    assert static_connection.status_code == 409
    assert static_connection.json()["detail"]["code"] == "direct_attach_token_required"

    web_attempt = await client.post(
        f"/v1/cloud/workspaces/{workspace_id}/direct-access-token",
        headers={**owner.headers, "X-Client-Kind": "web"},
        json={
            "targetAnyharnessWorkspaceId": workspace_runtime_id,
            "permissions": ["read"],
        },
    )
    assert web_attempt.status_code == 403
    assert web_attempt.json()["detail"]["code"] == "direct_attach_desktop_only"

    issued = await client.post(
        f"/v1/cloud/workspaces/{workspace_id}/direct-access-token",
        headers={**owner.headers, "X-Client-Kind": "desktop"},
        json={
            "targetAnyharnessWorkspaceId": workspace_runtime_id,
            "anyharnessSessionId": "session-direct",
            "permissions": ["read", "write"],
        },
    )
    assert issued.status_code == 200
    body = issued.json()
    assert body["anyharnessBaseUrl"] == "http://127.0.0.1:19000"
    assert body["anyharnessWorkspaceId"] == workspace_runtime_id
    assert body["permissions"] == ["read", "write"]

    decoded = jwt.decode(
        body["token"],
        public_key_pem,
        algorithms=["RS256"],
        audience="anyharness",
        issuer="https://api.test.proliferate",
    )
    assert decoded["cloud_workspace_id"] == str(workspace_id)
    assert decoded["anyharness_workspace_id"] == workspace_runtime_id
    assert decoded["anyharness_session_id"] == "session-direct"
    assert decoded["permissions"] == ["read", "write"]

    revoked = await client.delete(
        f"/v1/cloud/workspaces/{workspace_id}/direct-access-tokens/{body['tokenId']}",
        headers=owner.headers,
    )
    assert revoked.status_code == 200
    assert revoked.json()["status"] == "revoked"


async def _seed_claimable_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    *,
    suffix: str,
    with_runtime_access: bool = False,
) -> tuple[object, object, uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID | None, str]:
    owner = await create_user_and_login(
        client,
        db_session,
        email_prefix=f"claim-owner-{suffix}",
    )
    member = await create_user_and_login(
        client,
        db_session,
        email_prefix=f"claim-member-{suffix}",
    )
    await seed_linked_github_account(
        db_session,
        user_id=owner.user_id,
        access_token=f"gh-owner-{suffix}",
    )
    await seed_linked_github_account(
        db_session,
        user_id=member.user_id,
        access_token=f"gh-member-{suffix}",
    )
    organization = Organization(name=f"Claim Org {suffix}")
    db_session.add(organization)
    await db_session.flush()
    db_session.add_all(
        [
            OrganizationMembership(
                organization_id=organization.id,
                user_id=uuid.UUID(owner.user_id),
                role=ORGANIZATION_ROLE_OWNER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            ),
            OrganizationMembership(
                organization_id=organization.id,
                user_id=uuid.UUID(member.user_id),
                role=ORGANIZATION_ROLE_MEMBER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            ),
        ]
    )
    await db_session.commit()

    profile_response = await client.post(
        f"/v1/cloud/organizations/{organization.id}/sandbox-profile",
        headers=owner.headers,
    )
    assert profile_response.status_code == 200
    profile = profile_response.json()
    profile_id = uuid.UUID(profile["id"])
    target_id = uuid.UUID(profile["primaryTargetId"])
    workspace_runtime_id = f"workspace-{suffix}"
    workspace = await create_managed_cloud_workspace_for_profile(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        created_by_user_id=uuid.UUID(owner.user_id),
        display_name=f"Claimable {suffix}",
        git_provider="github",
        git_owner="acme",
        git_repo_name=f"claim-{suffix}",
        git_branch="main",
        git_base_branch="main",
        worktree_path=f"/workspace/{suffix}",
        origin_json='{"kind":"automation","entrypoint":"cloud"}',
        template_version="v1",
    )
    workspace.status = "ready"
    workspace.status_detail = "Ready"
    workspace.anyharness_workspace_id = workspace_runtime_id
    await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=workspace_runtime_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization.id,
        visibility="shared_unclaimed",
        default_projection_level="live",
        commandable=True,
        origin="automation",
    )
    if with_runtime_access:
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
            token_hash=f"worker-token-{suffix}",
            machine_fingerprint=f"worker-{suffix}",
            hostname=f"worker-{suffix}",
            worker_version="0.1.0",
            anyharness_version="0.1.0",
            supervisor_version=None,
            now=utcnow(),
        )
        await targets_store.update_target_runtime_access(
            db_session,
            target_id=target_id,
            sandbox_profile_id=profile_id,
            active_sandbox_id=slot.id,
            slot_generation=slot.slot_generation or 0,
            anyharness_base_url="http://127.0.0.1:19000",
            runtime_token_ciphertext="runtime-token",
            anyharness_data_key_ciphertext="data-key",
            worker_id=worker.id,
            heartbeat_at=utcnow(),
        )
        worker_id = worker.id
    else:
        worker_id = None
    await db_session.commit()
    return owner, member, workspace.id, target_id, profile_id, worker_id, workspace_runtime_id


def _workspace_ids(items: list[dict[str, object]]) -> set[str]:
    return {str(item["id"]) for item in items}


def _workspace_by_id(items: list[dict[str, object]], workspace_id: uuid.UUID) -> dict[str, object]:
    matches = [item for item in items if item["id"] == str(workspace_id)]
    assert len(matches) == 1
    return matches[0]


async def _mark_runtime_config_applied(
    db_session: AsyncSession,
    *,
    profile_id: uuid.UUID,
    target_id: uuid.UUID,
    worker_id: uuid.UUID,
    public_key_pem: str,
) -> None:
    revision, _created = await runtime_config_store.upsert_revision_and_current(
        db_session,
        sandbox_profile_id=profile_id,
        content_hash=f"direct-attach-{uuid.uuid4()}",
        manifest_json=json.dumps(
            {
                "directAttachAuth": {
                    "issuer": settings.cloud_jwt_issuer,
                    "audience": settings.cloud_jwt_audience_anyharness,
                    "verificationKeys": [
                        {
                            "kid": settings.cloud_jwt_signing_key_id,
                            "algorithm": "RS256",
                            "publicKeyPem": public_key_pem,
                        }
                    ],
                }
            }
        ),
        warnings_json=None,
        source="test",
        generated_by_user_id=None,
    )
    await agent_auth_store.record_runtime_config_worker_status(
        db_session,
        sandbox_profile_id=profile_id,
        target_id=target_id,
        sequence=revision.sequence,
        revision_id=revision.id,
        worker_id=worker_id,
        status="applied",
        error_code=None,
        error_message=None,
    )
    await db_session.commit()


def _rsa_key_pair() -> tuple[str, str]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_key_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    public_key_pem = (
        private_key.public_key()
        .public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        .decode("utf-8")
    )
    return private_key_pem, public_key_pem
