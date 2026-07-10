"""Track 1b Phase 3 — org-admin per-integration chat default-access toggle (§2).

Tier-1 coverage for the settings-page endpoint over the phase-1 knob
(``CloudIntegrationPolicy.scope_json``): an admin can exclude/include a
definition from the org's chat default set, a non-admin cannot, and the
resulting scope actually changes ``build_chat_default_access_scope``'s output
(the enforcement point phase 1 wired).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.integrations.definitions import create_org_custom_definition
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.integration_gateway.service import (
    build_chat_default_access_scope,
)
from proliferate.server.cloud.integrations import service as integrations_service
from proliferate.server.cloud.integrations.config import IntegrationConfig, StaticUrl
from proliferate.server.cloud.integrations.config import serialize_definition_config

pytestmark = pytest.mark.asyncio


async def _make_user(db: AsyncSession, *, email: str | None = None) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email or f"admin-{uuid.uuid4().hex}@example.com",
        hashed_password="unused",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _make_org_with_owner(db: AsyncSession, owner: User) -> uuid.UUID:
    records = await organization_store.ensure_default_organization_for_user(
        db, user_id=owner.id, name="Test Org", logo_domain=None
    )
    return records[0].organization.id


async def _make_definition(db: AsyncSession, organization_id: uuid.UUID, namespace: str):
    config = IntegrationConfig(
        transport="http", url=StaticUrl("https://mcp.example.com"), display_url="https://mcp.example.com"
    )
    return await create_org_custom_definition(
        db,
        organization_id=organization_id,
        namespace=namespace,
        display_name=namespace,
        description=None,
        auth_kind="none",
        oauth_client_mode=None,
        config_json=serialize_definition_config(config),
    )


async def test_default_included_until_excluded(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    org_id = await _make_org_with_owner(db_session, owner)
    definition = await _make_definition(db_session, org_id, "acme")

    listed = await integrations_service.list_admin_integration_definitions(
        db_session, organization_id=org_id, actor_user_id=owner.id
    )
    [item] = [i for i in listed if i.definition_id == definition.id]
    assert item.default_chat_included is True  # no authored restriction yet

    excluded = await integrations_service.set_admin_integration_default_chat_scope(
        db_session,
        organization_id=org_id,
        definition_id=definition.id,
        actor_user_id=owner.id,
        included=False,
    )
    assert excluded.default_chat_included is False

    relisted = await integrations_service.list_admin_integration_definitions(
        db_session, organization_id=org_id, actor_user_id=owner.id
    )
    [item] = [i for i in relisted if i.definition_id == definition.id]
    assert item.default_chat_included is False

    included_again = await integrations_service.set_admin_integration_default_chat_scope(
        db_session,
        organization_id=org_id,
        definition_id=definition.id,
        actor_user_id=owner.id,
        included=True,
    )
    assert included_again.default_chat_included is True


async def test_non_admin_denied(db_session: AsyncSession) -> None:
    owner = await _make_user(db_session)
    org_id = await _make_org_with_owner(db_session, owner)
    definition = await _make_definition(db_session, org_id, "acme")
    outsider = await _make_user(db_session)

    with pytest.raises(CloudApiError) as exc_info:
        await integrations_service.set_admin_integration_default_chat_scope(
            db_session,
            organization_id=org_id,
            definition_id=definition.id,
            actor_user_id=outsider.id,
            included=False,
        )
    assert exc_info.value.status_code in (403, 404)


async def test_exclusion_removes_provider_from_chat_default_scope(
    db_session: AsyncSession,
) -> None:
    """The enforcement point phase 1 wired: an excluded definition drops out of
    ``build_chat_default_access_scope``'s allowlist entirely."""
    owner = await _make_user(db_session)
    org_id = await _make_org_with_owner(db_session, owner)
    definition = await _make_definition(db_session, org_id, "acme")

    await integrations_service.set_admin_integration_default_chat_scope(
        db_session,
        organization_id=org_id,
        definition_id=definition.id,
        actor_user_id=owner.id,
        included=False,
    )

    scope = await build_chat_default_access_scope(
        db_session, owner_user_id=owner.id, organization_id=org_id
    )
    # The owner has no ready "acme" account to enumerate here, but the authored
    # exclusion still forces the function off the "no restriction" fast path
    # (``None`` / default-all) — proving the restriction is read, not ignored.
    assert scope is not None
    providers = {entry.get("provider") for entry in scope}
    assert "acme" not in providers
