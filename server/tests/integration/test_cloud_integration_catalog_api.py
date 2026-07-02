from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import (
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_ACTIVE,
)
from proliferate.db.models.organizations import Organization, OrganizationMembership
from proliferate.server.cloud.integrations.seeds import sync_seed_definitions
from tests.e2e.cloud.helpers.auth import create_user_and_login
from tests.e2e.cloud.helpers.github import seed_linked_github_account

CATALOG_URL = "/v1/cloud/integrations/catalog"


async def _authed(client: AsyncClient, db_session: AsyncSession, *, prefix: str):
    auth = await create_user_and_login(client, db_session, email_prefix=prefix)
    await seed_linked_github_account(db_session, user_id=auth.user_id, access_token=f"gh-{prefix}")
    await sync_seed_definitions(db_session)
    await db_session.commit()
    return auth


async def _create_org_with_role(db_session: AsyncSession, *, user_id: str, role: str) -> str:
    now = datetime.now(UTC)
    organization = Organization(
        name="Acme",
        logo_domain="acme.dev",
        status=ORGANIZATION_STATUS_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(organization)
    await db_session.flush()
    db_session.add(
        OrganizationMembership(
            organization_id=organization.id,
            user_id=uuid.UUID(user_id),
            role=role,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()
    return str(organization.id)


@pytest.mark.asyncio
async def test_catalog_requires_auth(client: AsyncClient) -> None:
    response = await client.get(CATALOG_URL)
    assert response.status_code in {401, 403}


@pytest.mark.asyncio
async def test_catalog_lists_seeds_with_connect_schema(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="catalog-seeds")
    response = await client.get(CATALOG_URL, headers=auth.headers)
    assert response.status_code == 200, response.text
    items = {i["namespace"]: i for i in response.json()["items"]}

    # api_key seed: secret field metadata is exposed, never any values.
    context7 = items["context7"]
    assert context7["displayName"] == "Context7"
    assert context7["authKind"] == "api_key"
    assert context7["description"]
    assert context7["definitionId"]
    secret_fields = context7["connectSchema"]["secretFields"]
    assert secret_fields == [
        {
            "id": "api_key",
            "label": "API key",
            "placeholder": "ctx7sk-...",
            "helperText": "Create a key in your Context7 dashboard.",
            "prefixHint": "ctx7sk-",
        }
    ]

    # oauth2 seed with settings: select options and defaults come through.
    posthog = items["posthog"]
    assert posthog["authKind"] == "oauth2"
    assert posthog["connectSchema"]["secretFields"] == []
    settings_fields = {f["id"]: f for f in posthog["connectSchema"]["settingsFields"]}
    region = settings_fields["region"]
    assert region["kind"] == "select"
    assert region["required"] is True
    assert region["default"] == "us"
    assert {o["value"] for o in region["options"]} == {"us", "eu"}

    # oauth2 seed with no connect-time fields: empty schema, no crash.
    linear = items["linear"]
    assert linear["connectSchema"] == {"secretFields": [], "settingsFields": []}


@pytest.mark.asyncio
async def test_catalog_never_exposes_secret_material(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="catalog-nosecrets")
    response = await client.get(CATALOG_URL, headers=auth.headers)
    assert response.status_code == 200, response.text
    body = response.text
    # Header/query templates reference secrets as {secret.X}; none of that
    # (nor any endpoint internals like the MCP URL) may leak into the catalog.
    assert "{secret." not in body
    assert "Authorization" not in body
    assert "mcp.context7.com" not in body


@pytest.mark.asyncio
async def test_catalog_includes_org_customs_for_members_only(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="catalog-org")
    org_id = await _create_org_with_role(
        db_session, user_id=auth.user_id, role=ORGANIZATION_ROLE_OWNER
    )
    created = await client.post(
        f"/v1/cloud/integrations/admin/organizations/{org_id}/definitions",
        headers=auth.headers,
        json={
            "displayName": "Acme Internal",
            "namespace": "acme_internal",
            "mcpUrl": "https://mcp.acme.dev/mcp",
        },
    )
    assert created.status_code == 200, created.text

    # With the org id: seeds + the org's custom definition.
    response = await client.get(
        CATALOG_URL, headers=auth.headers, params={"organizationId": org_id}
    )
    assert response.status_code == 200, response.text
    items = {i["namespace"]: i for i in response.json()["items"]}
    assert "context7" in items
    custom = items["acme_internal"]
    assert custom["displayName"] == "Acme Internal"
    assert custom["authKind"] == "none"
    assert custom["connectSchema"] == {"secretFields": [], "settingsFields": []}

    # Without the org id: seeds only.
    personal = await client.get(CATALOG_URL, headers=auth.headers)
    personal_namespaces = {i["namespace"] for i in personal.json()["items"]}
    assert "acme_internal" not in personal_namespaces


@pytest.mark.asyncio
async def test_catalog_rejects_non_member_org_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    auth = await _authed(client, db_session, prefix="catalog-crosstenant")
    response = await client.get(
        CATALOG_URL,
        headers=auth.headers,
        params={"organizationId": str(uuid.uuid4())},
    )
    assert response.status_code == 404
