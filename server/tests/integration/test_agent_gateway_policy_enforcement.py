"""Select-time enforcement of the org agent policy on PUT auth-selections.

The flag-only report (``test_agent_gateway_policy_api``) covers selections AT
REST. This module covers the HARD gate: a member cannot PUT a selection set that
violates a policy of any org they belong to. Personal (non-org) users bypass it.
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from proliferate.config import settings
from tests.integration.test_agent_gateway_api import _create_key, _put_selections
from tests.integration.test_agent_gateway_policy_api import (
    _authed_user,
    _create_organization,
    _policy_path,
)


def _api_key(key_id: str, *, enabled: bool = True) -> dict[str, object]:
    return {
        "sourceKind": "api_key",
        "apiKeyId": key_id,
        "envVarName": "ANTHROPIC_API_KEY",
        "enabled": enabled,
    }


_GATEWAY: dict[str, object] = {"sourceKind": "gateway", "enabled": True}


def _load_backfill_native():  # noqa: ANN202
    """Load the migration's pure transform (module name starts with a digit)."""
    import importlib.util
    from pathlib import Path

    path = (
        Path(__file__).resolve().parents[2]
        / "alembic"
        / "versions"
        / "76c0a297415c_org_agent_policy_native_route_backfill.py"
    )
    spec = importlib.util.spec_from_file_location("_native_backfill_migration", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.backfill_native


async def _set_policy(
    client: AsyncClient,
    owner_headers: dict[str, str],
    organization_id: str,
    *,
    allowed_routes: list[str] | None,
    allowed_harnesses: list[str] | None,
) -> None:
    response = await client.put(
        _policy_path(organization_id),
        headers=owner_headers,
        json={"allowedRoutes": allowed_routes, "allowedHarnesses": allowed_harnesses},
    )
    assert response.status_code == 200, response.text


@pytest.fixture(autouse=True)
def _free_policy_plan(monkeypatch: pytest.MonkeyPatch) -> None:
    # Editing the policy is plan-gated; the free plan lifts the gate for tests.
    monkeypatch.setattr(settings, "agent_gateway_policy_min_plan", "free")


class TestSelectTimeEnforcement:
    @pytest.mark.asyncio
    async def test_disallowed_route_rejected(self, client: AsyncClient) -> None:
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=["gateway", "native"],
            allowed_harnesses=None,
        )

        member_key = await _create_key(client, member_headers)
        rejected = await _put_selections(
            client,
            member_headers,
            harness="claude",
            surface="cloud",
            sources=[_api_key(str(member_key["id"]))],
        )
        assert rejected.status_code == 403, rejected.text
        assert rejected.json()["detail"]["code"] == "policy_violation"
        assert "api_key" in rejected.json()["detail"]["message"]

    @pytest.mark.asyncio
    async def test_disallowed_harness_rejected(self, client: AsyncClient) -> None:
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=None,
            allowed_harnesses=["claude"],
        )

        rejected = await _put_selections(
            client,
            member_headers,
            harness="codex",
            surface="cloud",
            sources=[_GATEWAY],
        )
        assert rejected.status_code == 403, rejected.text
        assert rejected.json()["detail"]["code"] == "policy_violation"
        assert "codex" in rejected.json()["detail"]["message"]

    @pytest.mark.asyncio
    async def test_disallowed_harness_can_be_cleared(self, client: AsyncClient) -> None:
        # A member has a pre-existing selection on a harness the org has since
        # disallowed. There is no DELETE endpoint, so the only remediation is
        # PUTting an empty/all-disabled set — that must succeed even though the
        # harness itself is disallowed.
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        # No policy yet: seed a selection on "codex" while it's still allowed.
        seeded = await _put_selections(
            client,
            member_headers,
            harness="codex",
            surface="cloud",
            sources=[_GATEWAY],
        )
        assert seeded.status_code == 200, seeded.text

        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=None,
            allowed_harnesses=["claude"],
        )

        cleared = await _put_selections(
            client,
            member_headers,
            harness="codex",
            surface="cloud",
            sources=[],
        )
        assert cleared.status_code == 200, cleared.text
        assert cleared.json() == []

    @pytest.mark.asyncio
    async def test_disallowed_harness_still_rejects_enabled_source(
        self, client: AsyncClient
    ) -> None:
        # Same setup as the clearing case above, but this time the member tries
        # to PUT an enabled source on the disallowed harness — that must still
        # be rejected; only an empty/all-disabled set is exempt.
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        seeded = await _put_selections(
            client,
            member_headers,
            harness="codex",
            surface="cloud",
            sources=[_GATEWAY],
        )
        assert seeded.status_code == 200, seeded.text

        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=None,
            allowed_harnesses=["claude"],
        )

        rejected = await _put_selections(
            client,
            member_headers,
            harness="codex",
            surface="cloud",
            sources=[_GATEWAY],
        )
        assert rejected.status_code == 403, rejected.text
        assert rejected.json()["detail"]["code"] == "policy_violation"
        assert "codex" in rejected.json()["detail"]["message"]

    @pytest.mark.asyncio
    async def test_native_disallowed_empty_set_rejected(self, client: AsyncClient) -> None:
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        # native absent from a non-null route list == native disallowed.
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=["gateway"],
            allowed_harnesses=None,
        )

        rejected = await _put_selections(
            client,
            member_headers,
            harness="claude",
            surface="cloud",
            sources=[],
        )
        assert rejected.status_code == 403, rejected.text
        assert rejected.json()["detail"]["code"] == "policy_violation"
        assert "Native" in rejected.json()["detail"]["message"]

    @pytest.mark.asyncio
    async def test_disabled_row_does_not_count(self, client: AsyncClient) -> None:
        # A disabled api_key row plus enabled gateway is native-free and route-
        # compliant: only ENABLED sources are gated, mirroring the report.
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=["gateway"],
            allowed_harnesses=None,
        )

        member_key = await _create_key(client, member_headers)
        allowed = await _put_selections(
            client,
            member_headers,
            harness="claude",
            surface="cloud",
            sources=[_GATEWAY, _api_key(str(member_key["id"]), enabled=False)],
        )
        assert allowed.status_code == 200, allowed.text

    @pytest.mark.asyncio
    async def test_allowed_selection_passes(self, client: AsyncClient) -> None:
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=["gateway", "native"],
            allowed_harnesses=["claude"],
        )

        gateway_ok = await _put_selections(
            client,
            member_headers,
            harness="claude",
            surface="cloud",
            sources=[_GATEWAY],
        )
        assert gateway_ok.status_code == 200, gateway_ok.text

        # native explicitly allowed -> empty set passes.
        native_ok = await _put_selections(
            client,
            member_headers,
            harness="claude",
            surface="local",
            sources=[],
        )
        assert native_ok.status_code == 200, native_ok.text

    @pytest.mark.asyncio
    async def test_personal_scope_bypasses_policy(self, client: AsyncClient) -> None:
        # An org restricts everything to gateway-only. A user who is NOT a member
        # (personal scope) is unaffected and may select api_key freely.
        owner_id, owner_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[]
        )
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=["gateway"],
            allowed_harnesses=["opencode"],
        )

        _, outsider_headers = await _authed_user(client)
        outsider_key = await _create_key(client, outsider_headers)
        allowed = await _put_selections(
            client,
            outsider_headers,
            harness="claude",
            surface="cloud",
            sources=[_api_key(str(outsider_key["id"]))],
        )
        assert allowed.status_code == 200, allowed.text

    @pytest.mark.asyncio
    async def test_legacy_row_semantics_native_backfilled(self, client: AsyncClient) -> None:
        # Legacy rows (saved before "native" was a valid route value) are
        # normalized by the 76c0a297415c backfill migration to explicitly
        # include "native", so native CLI login is NOT retroactively locked out.
        backfill_native = _load_backfill_native()

        # A restricted legacy list lacking native gains it.
        assert backfill_native('["gateway"]') == '["gateway", "native"]'
        assert backfill_native('["gateway", "api_key"]') == (
            '["gateway", "api_key", "native"]'
        )
        # A row that already allows native, or is unrestricted (null), is untouched.
        assert backfill_native('["gateway", "native"]') is None
        assert backfill_native(None) is None

        # And the observable effect: a backfilled legacy list allows native.
        owner_id, owner_headers = await _authed_user(client)
        member_id, member_headers = await _authed_user(client)
        organization_id = await _create_organization(
            owner_user_id=owner_id, member_user_ids=[member_id]
        )
        await _set_policy(
            client,
            owner_headers,
            organization_id,
            allowed_routes=["gateway", "native"],
            allowed_harnesses=None,
        )
        native_ok = await _put_selections(
            client,
            member_headers,
            harness="claude",
            surface="cloud",
            sources=[],
        )
        assert native_ok.status_code == 200, native_ok.text
