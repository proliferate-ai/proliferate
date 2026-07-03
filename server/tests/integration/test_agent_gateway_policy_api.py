"""Integration tests for the flag-only org agent policy APIs (PR 11)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient

from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.billing import BillingEntitlement
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from tests.helpers.desktop_auth import mint_desktop_token_payload


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager, get_user_db
    from proliferate.db.engine import get_async_session

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Policy Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None
    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="agent-policy",
    )
    return {"user_id": user_id, "access_token": str(token_data["access_token"])}


async def _authed_user(client: AsyncClient) -> tuple[str, dict[str, str]]:
    tokens = await _register_and_login(
        client,
        f"agent-policy-{uuid.uuid4().hex[:8]}@example.com",
    )
    return tokens["user_id"], {"Authorization": f"Bearer {tokens['access_token']}"}


async def _create_organization(*, owner_user_id: str, member_user_ids: list[str]) -> str:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        now = datetime.now(UTC)
        organization = Organization(
            name="Policy Org",
            status=ORGANIZATION_STATUS_ACTIVE,
            created_at=now,
            updated_at=now,
        )
        session.add(organization)
        await session.flush()
        for user_id, role in (
            (owner_user_id, ORGANIZATION_ROLE_OWNER),
            *((member_id, ORGANIZATION_ROLE_MEMBER) for member_id in member_user_ids),
        ):
            session.add(
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=uuid.UUID(user_id),
                    role=role,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=now,
                    removed_at=None,
                    created_at=now,
                    updated_at=now,
                )
            )
        await session.commit()
        return str(organization.id)


async def _grant_unlimited_cloud(organization_id: str) -> None:
    from proliferate.db import engine as engine_module

    async with engine_module.async_session_factory() as session:
        subject = await ensure_organization_billing_subject(
            session,
            uuid.UUID(organization_id),
        )
        session.add(
            BillingEntitlement(
                billing_subject_id=subject.id,
                kind="unlimited_cloud",
            )
        )
        await session.commit()


def _policy_path(organization_id: str) -> str:
    return f"/v1/cloud/organizations/{organization_id}/agent-gateway/policy"


class TestOrgAgentPolicyAuth:
    @pytest.mark.asyncio
    async def test_member_cannot_read_or_edit_policy(self, client: AsyncClient) -> None:
        owner_id, _ = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id,
            member_user_ids=[member_id],
        )

        read = await client.get(_policy_path(organization_id), headers=member_headers)
        assert read.status_code == 403

        write = await client.put(
            _policy_path(organization_id),
            headers=member_headers,
            json={"allowedRoutes": ["gateway"]},
        )
        assert write.status_code == 403

        violations = await client.get(
            f"{_policy_path(organization_id)}/violations",
            headers=member_headers,
        )
        assert violations.status_code == 403

    @pytest.mark.asyncio
    async def test_non_member_and_anonymous_access(self, client: AsyncClient) -> None:
        owner_id, _ = await _authed_user(client)
        _, outsider_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id,
            member_user_ids=[],
        )

        response = await client.get(_policy_path(organization_id), headers=outsider_headers)
        assert response.status_code == 404

        anonymous = await client.get(_policy_path(organization_id))
        assert anonymous.status_code == 401


class TestOrgAgentPolicyCrud:
    @pytest.mark.asyncio
    async def test_default_policy_and_put_roundtrip(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_policy_min_plan", "free")
        owner_id, owner_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id,
            member_user_ids=[],
        )

        empty = await client.get(_policy_path(organization_id), headers=owner_headers)
        assert empty.status_code == 200, empty.text
        payload = empty.json()
        assert payload == {
            "organizationId": organization_id,
            "allowedRoutes": None,
            "allowedHarnesses": None,
            "editable": True,
            "updatedByUserId": None,
            "updatedAt": None,
        }

        updated = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": ["gateway", "api_key"], "allowedHarnesses": ["claude"]},
        )
        assert updated.status_code == 200, updated.text
        payload = updated.json()
        assert payload["allowedRoutes"] == ["gateway", "api_key"]
        assert payload["allowedHarnesses"] == ["claude"]
        assert payload["updatedByUserId"] == owner_id
        assert payload["editable"] is True

        fetched = await client.get(_policy_path(organization_id), headers=owner_headers)
        assert fetched.json()["allowedRoutes"] == ["gateway", "api_key"]

        cleared = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": None, "allowedHarnesses": None},
        )
        assert cleared.status_code == 200
        assert cleared.json()["allowedRoutes"] is None
        assert cleared.json()["allowedHarnesses"] is None

    @pytest.mark.asyncio
    async def test_put_rejects_unknown_values(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_policy_min_plan", "free")
        owner_id, owner_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id,
            member_user_ids=[],
        )

        bad_route = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": ["carrier-pigeon"]},
        )
        assert bad_route.status_code == 400
        assert bad_route.json()["detail"]["code"] == "invalid_org_agent_policy"

        # An arbitrary but well-formed harness_kind is ACCEPTED: route selections
        # accept arbitrary kinds, so the allow-list must too (otherwise a member
        # could select a harness the admin can never allow-list). Consistency fix.
        arbitrary_harness = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedHarnesses": ["clippy"]},
        )
        assert arbitrary_harness.status_code == 200, arbitrary_harness.text
        assert arbitrary_harness.json()["allowedHarnesses"] == ["clippy"]

        # A harness_kind past the String(64) column bound (route selections'
        # source of truth) is still rejected as a 400, not a 500.
        bad_harness = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedHarnesses": ["x" * 65]},
        )
        assert bad_harness.status_code == 400
        assert bad_harness.json()["detail"]["code"] == "invalid_org_agent_policy"


class TestOrgAgentPolicyPlanGating:
    @pytest.mark.asyncio
    async def test_editing_is_plan_gated_reading_is_not(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_policy_min_plan", "pro")
        owner_id, owner_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id,
            member_user_ids=[],
        )

        read = await client.get(_policy_path(organization_id), headers=owner_headers)
        assert read.status_code == 200
        assert read.json()["editable"] is False

        write = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": ["gateway"]},
        )
        assert write.status_code == 403
        assert write.json()["detail"]["code"] == "org_agent_policy_plan_required"

        await _grant_unlimited_cloud(organization_id)

        unlocked = await client.get(_policy_path(organization_id), headers=owner_headers)
        assert unlocked.json()["editable"] is True

        write_paid = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": ["gateway"]},
        )
        assert write_paid.status_code == 200, write_paid.text
        assert write_paid.json()["allowedRoutes"] == ["gateway"]


class TestOrgAgentPolicyViolations:
    @pytest.mark.asyncio
    async def test_violations_computed_live_and_nothing_blocked(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "agent_gateway_policy_min_plan", "free")
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        outsider_id, outsider_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id,
            member_user_ids=[member_id],
        )

        violations_path = f"{_policy_path(organization_id)}/violations"

        # No policy row yet -> no restrictions -> no violations.
        empty = await client.get(violations_path, headers=owner_headers)
        assert empty.status_code == 200
        assert empty.json() == {"violations": []}

        # Member selections: one route conflict, one harness conflict, one
        # compliant. Outsider selections never count.
        for headers, harness, surface, route in (
            (member_headers, "claude", "local", "native"),
            (member_headers, "codex", "cloud", "gateway"),
            (member_headers, "claude", "cloud", "gateway"),
            (outsider_headers, "claude", "local", "native"),
        ):
            response = await client.put(
                f"/v1/cloud/agent-gateway/route-selections/{harness}/{surface}",
                headers=headers,
                json={"route": route},
            )
            assert response.status_code == 200, response.text

        policy = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": ["gateway"], "allowedHarnesses": ["claude"]},
        )
        assert policy.status_code == 200, policy.text

        response = await client.get(violations_path, headers=owner_headers)
        assert response.status_code == 200, response.text
        violations = response.json()["violations"]
        flagged = {
            (item["userId"], item["harnessKind"], item["surface"], item["route"])
            for item in violations
        }
        assert flagged == {
            (member_id, "claude", "local", "native"),
            (member_id, "codex", "cloud", "gateway"),
        }
        assert all(item["email"] for item in violations)
        assert outsider_id not in {item["userId"] for item in violations}

        # Flag-only: a member can still select a violating route afterwards.
        still_allowed = await client.put(
            "/v1/cloud/agent-gateway/route-selections/grok/local",
            headers=member_headers,
            json={"route": "native"},
        )
        assert still_allowed.status_code == 200, still_allowed.text

        after = await client.get(violations_path, headers=owner_headers)
        assert (member_id, "grok", "local", "native") in {
            (item["userId"], item["harnessKind"], item["surface"], item["route"])
            for item in after.json()["violations"]
        }

        # A member can select any REGISTERED harness kind (route-selection
        # writes validate against AGENT_AUTH_HARNESS_KINDS), and the admin can
        # allow-list that exact kind to resolve the violation. Opencode's
        # gateway selection lives in its 'gateway' slot (spec §3.3).
        opencode_selection = await client.put(
            "/v1/cloud/agent-gateway/route-selections/opencode/cloud",
            headers=member_headers,
            json={"route": "gateway", "slot": "gateway"},
        )
        assert opencode_selection.status_code == 200, opencode_selection.text
        flagged_opencode = await client.get(violations_path, headers=owner_headers)
        assert (member_id, "opencode", "cloud", "gateway") in {
            (item["userId"], item["harnessKind"], item["surface"], item["route"])
            for item in flagged_opencode.json()["violations"]
        }

        allow_opencode = await client.put(
            _policy_path(organization_id),
            headers=owner_headers,
            json={"allowedRoutes": ["gateway"], "allowedHarnesses": ["claude", "opencode"]},
        )
        assert allow_opencode.status_code == 200, allow_opencode.text
        resolved = await client.get(violations_path, headers=owner_headers)
        assert (member_id, "opencode", "cloud", "gateway") not in {
            (item["userId"], item["harnessKind"], item["surface"], item["route"])
            for item in resolved.json()["violations"]
        }
