"""Org-policy enforcement at the integration gateway (split from the main gateway suite)."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store.integrations import accounts as accounts_store
from proliferate.db.store.integrations import definitions as definitions_store
from proliferate.db.store.integrations import policies as policies_store
from proliferate.utils.crypto import encrypt_json
from tests.integration.test_cloud_integration_gateway_api import (
    _authed_user,
    _create_org_with_member,
    _enroll_gateway_bearer,
    _seed_ready_account,
    _tool_call,
)


@pytest.fixture(autouse=True)
def _worker_cloud_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "cloud_worker_base_url", "http://cloud.test")


async def _set_org_policy(
    db_session: AsyncSession,
    *,
    organization_id: str,
    namespace: str,
    enabled: bool,
    updated_by_user_id: str,
) -> None:
    definition = await definitions_store.get_seed_by_namespace(db_session, namespace)
    assert definition is not None
    await policies_store.upsert_policy(
        db_session,
        organization_id=uuid.UUID(organization_id),
        definition_id=definition.id,
        enabled=enabled,
        updated_by_user_id=uuid.UUID(updated_by_user_id),
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_cross_org_custom_definition_hidden_from_other_org_grant(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed_user(client, db_session, prefix="gw-cross-custom")
    org_a_id = await _create_org_with_member(db_session, user_id=auth.user_id)
    org_b_id = await _create_org_with_member(db_session, user_id=auth.user_id)

    definition = await definitions_store.create_org_custom_definition(
        db_session,
        organization_id=uuid.UUID(org_a_id),
        namespace="acme-internal",
        display_name="Acme Internal",
        description=None,
        auth_kind="api_key",
        oauth_client_mode=None,
        config_json="{}",
    )
    account = await accounts_store.upsert_account(
        db_session,
        user_id=uuid.UUID(auth.user_id),
        definition_id=definition.id,
        auth_kind="api_key",
        status="ready",
    )
    await accounts_store.set_account_credentials(
        db_session,
        account_id=account.id,
        credential_ciphertext=encrypt_json({"secretFields": {"api_key": "secret"}}),
        credential_format="secret-fields-v1",
        auth_status="ready",
        token_expires_at=None,
    )
    await db_session.commit()

    # Under org A's scope the custom definition is served...
    bearer_a = await _enroll_gateway_bearer(
        client, auth, prefix="gw-cross-custom-a", organization_id=org_a_id
    )
    listed = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer_a}"},
        name="integrations.list_providers",
        arguments={},
    )
    providers = [p["provider"] for p in listed["structuredContent"]["providers"]]
    assert providers == ["acme-internal"]

    # ...but a grant scoped to org B (whose admins can neither see nor
    # policy-control org A's custom definition) must not expose it.
    bearer_b = await _enroll_gateway_bearer(
        client, auth, prefix="gw-cross-custom-b", organization_id=org_b_id
    )
    hidden = await _tool_call(
        client,
        {"Authorization": f"Bearer {bearer_b}"},
        name="integrations.list_providers",
        arguments={},
    )
    assert hidden["structuredContent"]["providers"] == []


@pytest.mark.asyncio
async def test_orgless_grant_ignores_other_orgs_policies(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    other = await _authed_user(client, db_session, prefix="gw-org-other")
    other_org_id = await _create_org_with_member(db_session, user_id=other.user_id)

    auth = await _authed_user(client, db_session, prefix="gw-orgless")
    bearer = await _enroll_gateway_bearer(client, auth, prefix="gw-orgless")
    headers = {"Authorization": f"Bearer {bearer}"}
    await _seed_ready_account(db_session, user_id=auth.user_id, namespace="context7")

    # Another org disabling the definition must not leak into an org-less grant.
    await _set_org_policy(
        db_session,
        organization_id=other_org_id,
        namespace="context7",
        enabled=False,
        updated_by_user_id=other.user_id,
    )

    listed = await _tool_call(client, headers, name="integrations.list_providers", arguments={})
    assert [p["provider"] for p in listed["structuredContent"]["providers"]] == ["context7"]


@pytest.mark.asyncio
async def test_org_policy_disables_provider_across_gateway(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed_user(client, db_session, prefix="gw-org-policy")
    org_id = await _create_org_with_member(db_session, user_id=auth.user_id)
    bearer = await _enroll_gateway_bearer(
        client, auth, prefix="gw-org-policy", organization_id=org_id
    )
    headers = {"Authorization": f"Bearer {bearer}"}
    await _seed_ready_account(db_session, user_id=auth.user_id, namespace="context7")

    # No policy row yet: the seed default applies and the provider is listed.
    listed = await _tool_call(client, headers, name="integrations.list_providers", arguments={})
    assert [p["provider"] for p in listed["structuredContent"]["providers"]] == ["context7"]

    await _set_org_policy(
        db_session,
        organization_id=org_id,
        namespace="context7",
        enabled=False,
        updated_by_user_id=auth.user_id,
    )

    # list_providers: the disabled definition is excluded outright.
    hidden = await _tool_call(client, headers, name="integrations.list_providers", arguments={})
    assert hidden["structuredContent"]["providers"] == []

    # list_tools: an in-band MCP error naming the org policy.
    tools = await _tool_call(
        client, headers, name="integrations.list_tools", arguments={"provider": "context7"}
    )
    assert tools["isError"] is True
    assert "disabled" in tools["content"][0]["text"]

    # call_tool: also an in-band MCP error, never a credentialed upstream call.
    call = await _tool_call(
        client,
        headers,
        name="integrations.call_tool",
        arguments={"provider": "context7", "tool": "resolve-library-id", "arguments": {}},
    )
    assert call["isError"] is True
