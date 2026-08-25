"""Integration tests for the agent gateway stores (real Postgres)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete as sql_delete
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.agent_gateway import AgentApiKey
from proliferate.db.models.organizations import Organization
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.agent_gateway import DesiredAuthSource
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject


async def _create_org_subject(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """(organization_id, billing_subject_id) — enrollment rows are org-only."""
    organization = Organization(name=f"Store Org {uuid.uuid4().hex[:6]}")
    db_session.add(organization)
    await db_session.flush()
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    return organization.id, subject.id


async def _create_user(db_session: AsyncSession, *, email: str | None = None) -> uuid.UUID:
    user = User(
        email=email or f"agent-gateway-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


def _gateway(*, enabled: bool = True) -> DesiredAuthSource:
    return DesiredAuthSource(source_kind="gateway", enabled=enabled)


def _api_key(
    key_id: uuid.UUID,
    *,
    env_var_name: str = "ANTHROPIC_API_KEY",
    provider_hint: str | None = None,
    enabled: bool = True,
) -> DesiredAuthSource:
    return DesiredAuthSource(
        source_kind="api_key",
        api_key_id=key_id,
        env_var_name=env_var_name,
        provider_hint=provider_hint,
        enabled=enabled,
    )


@pytest.mark.asyncio
async def test_api_key_create_list_revoke(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)

    created = await store.create_agent_api_key(
        db_session,
        user_id=user_id,
        title="Work key",
        value="sk-ant-api03-secretsecretabc4",
    )
    assert created.title == "Work key"
    assert created.redacted_hint == "sk-...abc4"
    assert created.status == "active"
    assert created.kind == "api_key"

    listed = await store.list_agent_api_keys(db_session, user_id=user_id)
    assert [record.id for record in listed] == [created.id]

    decrypted = await store.get_agent_api_key_decrypted(
        db_session,
        user_id=user_id,
        api_key_id=created.id,
    )
    assert decrypted is not None
    assert decrypted[1] == "sk-ant-api03-secretsecretabc4"

    revoked = await store.revoke_agent_api_key(
        db_session,
        user_id=user_id,
        api_key_id=created.id,
    )
    assert revoked is not None
    assert revoked.status == "revoked"

    assert await store.list_agent_api_keys(db_session, user_id=user_id) == []
    with_revoked = await store.list_agent_api_keys(
        db_session,
        user_id=user_id,
        include_revoked=True,
    )
    assert len(with_revoked) == 1
    assert (
        await store.get_agent_api_key_decrypted(
            db_session,
            user_id=user_id,
            api_key_id=created.id,
        )
        is None
    )


@pytest.mark.asyncio
async def test_create_provider_config_stores_typed_kind_and_decrypts(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)

    created = await store.create_agent_provider_config(
        db_session,
        user_id=user_id,
        title="Personal Bedrock",
        kind="aws_bedrock",
        value={"region": "us-east-1", "bearerToken": "bedrock-token-abcd"},
    )
    assert created.kind == "aws_bedrock"
    assert created.title == "Personal Bedrock"
    # No single-secret tail to show for a multi-field payload.
    assert created.redacted_hint == "aws_bedrock:2 field(s)"

    listed = await store.list_agent_api_keys(db_session, user_id=user_id)
    assert [record.id for record in listed] == [created.id]
    assert listed[0].kind == "aws_bedrock"

    decrypted = await store.get_agent_provider_config_decrypted(
        db_session,
        user_id=user_id,
        api_key_id=created.id,
    )
    assert decrypted is not None
    assert decrypted[1] == {"region": "us-east-1", "bearerToken": "bedrock-token-abcd"}


@pytest.mark.asyncio
async def test_create_provider_config_rejects_unknown_kind(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    with pytest.raises(ValueError, match="Unsupported provider-config kind"):
        await store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="Bad kind",
            kind="api_key",
            value={"anything": "value"},
        )
    with pytest.raises(ValueError, match="Unsupported provider-config kind"):
        await store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="Bad kind",
            kind="not_a_real_kind",
            value={"anything": "value"},
        )


@pytest.mark.asyncio
async def test_create_provider_config_rejects_empty_values(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    with pytest.raises(ValueError, match="non-empty"):
        await store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="Empty field",
            kind="azure_openai",
            value={"endpoint": "https://foo.openai.azure.com", "apiKey": "  "},
        )
    with pytest.raises(ValueError, match="non-empty"):
        await store.create_agent_provider_config(
            db_session,
            user_id=user_id,
            title="No fields",
            kind="azure_openai",
            value={},
        )


@pytest.mark.asyncio
async def test_get_agent_api_key_decrypted_does_not_resolve_typed_row(
    db_session: AsyncSession,
) -> None:
    """A typed row is invisible to the bare-secret fetch (kind-scoped query)."""
    user_id = await _create_user(db_session)
    created = await store.create_agent_provider_config(
        db_session,
        user_id=user_id,
        title="Personal Bedrock",
        kind="aws_bedrock",
        value={"region": "us-east-1", "bearerToken": "bedrock-token-abcd"},
    )
    assert (
        await store.get_agent_api_key_decrypted(
            db_session,
            user_id=user_id,
            api_key_id=created.id,
        )
        is None
    )


@pytest.mark.asyncio
async def test_get_agent_provider_config_decrypted_does_not_resolve_bare_key(
    db_session: AsyncSession,
) -> None:
    """A bare-secret row is invisible to the typed-config fetch (kind-scoped query)."""
    user_id = await _create_user(db_session)
    created = await store.create_agent_api_key(
        db_session,
        user_id=user_id,
        title="Bare key",
        value="sk-ant-api03-secretsecretabc4",
    )
    assert (
        await store.get_agent_provider_config_decrypted(
            db_session,
            user_id=user_id,
            api_key_id=created.id,
        )
        is None
    )


@pytest.mark.asyncio
async def test_create_api_key_requires_title_and_value(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    with pytest.raises(ValueError, match="title"):
        await store.create_agent_api_key(
            db_session, user_id=user_id, title="  ", value="sk-ant-1234abcd"
        )
    with pytest.raises(ValueError, match="value"):
        await store.create_agent_api_key(db_session, user_id=user_id, title="Key", value="")


@pytest.mark.asyncio
async def test_revoke_rejects_foreign_key(db_session: AsyncSession) -> None:
    owner_id = await _create_user(db_session)
    other_id = await _create_user(db_session)
    created = await store.create_agent_api_key(
        db_session,
        user_id=owner_id,
        title="Key",
        value="sk-proj-abcdef1234",
    )
    assert (
        await store.revoke_agent_api_key(db_session, user_id=other_id, api_key_id=created.id)
        is None
    )


@pytest.mark.asyncio
async def test_put_rejects_duplicate_source(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Anthropic", value="sk-ant-1234abcd"
    )
    with pytest.raises(ValueError, match="Duplicate selection source"):
        await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="opencode",
            surface="cloud",
            sources=[
                _api_key(key.id, env_var_name="ANTHROPIC_API_KEY"),
                _api_key(key.id, env_var_name="ANTHROPIC_API_KEY"),
            ],
        )


@pytest.mark.asyncio
async def test_put_rejects_bad_source_shape(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    with pytest.raises(ValueError, match="gateway source must not"):
        await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[
                DesiredAuthSource(source_kind="gateway", env_var_name="X_API_KEY"),
            ],
        )
    # env_var_name is no longer a structural requirement (a typed vault entry
    # legally carries none) — but an api_key source with NO vault reference at
    # all is still an illegal shape.
    with pytest.raises(ValueError, match="api_key source requires"):
        await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            sources=[DesiredAuthSource(source_kind="api_key", env_var_name="X_API_KEY")],
        )


@pytest.mark.asyncio
async def test_put_rejects_unknown_harness(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    with pytest.raises(ValueError, match="harness kind"):
        await store.put_auth_selections(
            db_session,
            user_id=user_id,
            harness_kind="x" * 200,
            surface="local",
            sources=[_gateway()],
        )


@pytest.mark.asyncio
async def test_put_rejects_foreign_or_revoked_api_key(db_session: AsyncSession) -> None:
    owner_id = await _create_user(db_session)
    other_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=owner_id, title="Key", value="sk-ant-1234abcd"
    )

    with pytest.raises(store.AgentApiKeyNotUsableError, match="active key owned"):
        await store.put_auth_selections(
            db_session,
            user_id=other_id,
            harness_kind="claude",
            surface="cloud",
            sources=[_api_key(key.id)],
        )

    await store.revoke_agent_api_key(db_session, user_id=owner_id, api_key_id=key.id)
    with pytest.raises(store.AgentApiKeyNotUsableError, match="active key owned"):
        await store.put_auth_selections(
            db_session,
            user_id=owner_id,
            harness_kind="claude",
            surface="cloud",
            sources=[_api_key(key.id)],
        )


@pytest.mark.asyncio
async def test_list_enabled_selections_referencing_key(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Anthropic", value="sk-ant-1234abcd"
    )
    await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[_api_key(key.id, enabled=True)],
    )
    referencing = await store.list_enabled_selections_referencing_key(
        db_session, user_id=user_id, api_key_id=key.id
    )
    assert [r.harness_kind for r in referencing] == ["claude"]

    # Disabling the row frees the key for revocation (nothing enabled uses it).
    await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[_api_key(key.id, enabled=False)],
    )
    assert (
        await store.list_enabled_selections_referencing_key(
            db_session, user_id=user_id, api_key_id=key.id
        )
        == []
    )


@pytest.mark.asyncio
async def test_clear_auth_selections(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[_gateway()],
    )
    cleared = await store.clear_auth_selections(
        db_session, user_id=user_id, harness_kind="claude", surface="local"
    )
    assert cleared == 1
    assert (
        await store.get_scope_auth_selections(
            db_session, user_id=user_id, harness_kind="claude", surface="local"
        )
        == []
    )
    assert (
        await store.clear_auth_selections(
            db_session, user_id=user_id, harness_kind="claude", surface="local"
        )
        == 0
    )


@pytest.mark.asyncio
async def test_api_key_hard_delete_cascades_selection(db_session: AsyncSession) -> None:
    """Hard-deleting a key must not abort on the api_key-shape CHECK.

    ``api_key_id`` is ``ondelete=CASCADE`` (not ``SET NULL``): nulling it on an
    ``api_key`` row would violate ``ck_..._api_key_shape``, so the key takes its
    referencing selections with it rather than orphaning them.
    """
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Key", value="sk-ant-1234abcd"
    )
    await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="cloud",
        sources=[_api_key(key.id)],
    )

    await db_session.execute(sql_delete(AgentApiKey).where(AgentApiKey.id == key.id))
    await db_session.flush()

    remaining = await store.list_auth_selections(db_session, user_id=user_id)
    assert [(row.source_kind, row.enabled) for row in remaining] == [("gateway", False)]


@pytest.mark.asyncio
async def test_user_hard_delete_with_selection_succeeds(db_session: AsyncSession) -> None:
    """Deleting a user that owns an api_key selection must not abort."""
    user_id = await _create_user(db_session)
    key = await store.create_agent_api_key(
        db_session, user_id=user_id, title="Key", value="sk-ant-1234abcd"
    )
    await store.put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="cloud",
        sources=[_api_key(key.id)],
    )

    await db_session.execute(sql_delete(User).where(User.id == user_id))
    await db_session.flush()

    assert await db_session.get(User, user_id) is None
    assert await store.list_auth_selections(db_session, user_id=user_id) == []


@pytest.mark.asyncio
async def test_ensure_enrollment_row_is_idempotent(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    org_id, subject_id = await _create_org_subject(db_session)

    first = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject_id,
        organization_id=org_id,
        user_id=user_id,
    )
    second = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject_id,
        organization_id=org_id,
        user_id=user_id,
    )
    assert first.id == second.id
    assert first.sync_status == "pending"
    assert first.subject_kind == "organization"

    fetched = await store.get_enrollment_for_organization(
        db_session, organization_id=org_id, user_id=user_id
    )
    assert fetched is not None
    assert fetched.id == first.id


@pytest.mark.asyncio
async def test_enrollment_sync_lifecycle(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    org_id, subject_id = await _create_org_subject(db_session)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject_id,
        organization_id=org_id,
        user_id=user_id,
    )

    needing = await store.list_enrollments_needing_sync(db_session)
    assert enrollment.id in {record.id for record in needing}

    failed = await store.mark_enrollment_failed(
        db_session,
        enrollment_id=enrollment.id,
        error_code="litellm_request_failed",
        error_message="boom",
    )
    assert failed.sync_status == "failed"
    needing = await store.list_enrollments_needing_sync(db_session)
    assert enrollment.id in {record.id for record in needing}

    synced = await store.mark_enrollment_synced(
        db_session,
        enrollment_id=enrollment.id,
        litellm_team_id="team-1",
        litellm_user_id=f"org-{org_id}-user-{user_id}",
        virtual_key_id="token-1",
        virtual_key="sk-litellm-secret",
        sync_fingerprint="fp",
    )
    assert synced.sync_status == "synced"
    assert synced.last_error_code is None
    assert (
        await store.get_enrollment_virtual_key_decrypted(
            db_session,
            enrollment_id=enrollment.id,
        )
        == "sk-litellm-secret"
    )

    needing = await store.list_enrollments_needing_sync(db_session)
    assert enrollment.id not in {record.id for record in needing}

    revoked = await store.revoke_enrollment(db_session, enrollment_id=enrollment.id)
    assert revoked is not None
    assert revoked.revoked_at is not None
    assert (
        await store.get_enrollment_for_organization(
            db_session, organization_id=org_id, user_id=user_id
        )
        is None
    )


@pytest.mark.asyncio
async def test_list_billing_subject_ids_paginates_past_a_page(
    db_session: AsyncSession,
) -> None:
    """Keyset pagination walks every active subject, not just the first page."""
    subject_ids: set[uuid.UUID] = set()
    for _ in range(5):
        user_id = await _create_user(db_session)
        org_id, subject_id = await _create_org_subject(db_session)
        await store.ensure_enrollment_row(
            db_session,
            billing_subject_id=subject_id,
            organization_id=org_id,
            user_id=user_id,
        )
        subject_ids.add(subject_id)

    seen: list[uuid.UUID] = []
    after: uuid.UUID | None = None
    while True:
        page = await store.list_billing_subject_ids_with_active_enrollments(
            db_session,
            limit=2,
            after=after,
        )
        if not page:
            break
        seen.extend(page)
        if len(page) < 2:
            break
        after = page[-1]

    assert subject_ids.issubset(set(seen))
    relevant = [sid for sid in seen if sid in subject_ids]
    assert relevant == sorted(relevant)
    assert len(relevant) == len(set(relevant))


@pytest.mark.asyncio
async def test_usage_insert_once_dedupes(db_session: AsyncSession) -> None:
    occurred_at = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    inserted = await store.insert_usage_event_once(
        db_session,
        litellm_request_id="req-1",
        occurred_at=occurred_at,
        model="claude-sonnet-4-5",
        total_tokens=100,
        cost_usd=0.01,
    )
    duplicate = await store.insert_usage_event_once(
        db_session,
        litellm_request_id="req-1",
        occurred_at=occurred_at,
        model="claude-sonnet-4-5",
        total_tokens=100,
        cost_usd=0.01,
    )
    assert inserted is True
    assert duplicate is False


@pytest.mark.asyncio
async def test_usage_import_cursor_roundtrip(db_session: AsyncSession) -> None:
    assert await store.get_usage_import_cursor(db_session) is None
    seen = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    advanced = await store.advance_usage_import_cursor(
        db_session,
        last_seen_occurred_at=seen,
        status="idle",
    )
    assert advanced.last_seen_occurred_at == seen

    fetched = await store.get_usage_import_cursor(db_session)
    assert fetched is not None
    assert fetched.id == "default"

    kept = await store.advance_usage_import_cursor(
        db_session,
        last_seen_occurred_at=None,
        status="error",
        last_error_code="poll_failed",
        last_error_message="boom",
    )
    assert kept.last_seen_occurred_at == seen
    assert kept.status == "error"


@pytest.mark.asyncio
async def test_org_agent_policy_get_set(db_session: AsyncSession) -> None:
    from proliferate.db.models.organizations import Organization

    organization = Organization(name="Policy Org")
    db_session.add(organization)
    await db_session.flush()

    assert await store.get_org_agent_policy(db_session, organization_id=organization.id) is None
    created = await store.set_org_agent_policy(
        db_session,
        organization_id=organization.id,
        allowed_routes_json='["gateway"]',
        allowed_harnesses_json=None,
        updated_by_user_id=None,
    )
    assert created.allowed_routes_json == '["gateway"]'
    updated = await store.set_org_agent_policy(
        db_session,
        organization_id=organization.id,
        allowed_routes_json='["gateway", "api_key"]',
        allowed_harnesses_json='["claude"]',
        updated_by_user_id=None,
    )
    assert updated.allowed_routes_json == '["gateway", "api_key"]'
    assert updated.allowed_harnesses_json == '["claude"]'
