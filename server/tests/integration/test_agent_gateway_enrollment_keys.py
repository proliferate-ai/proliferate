"""Integration tests for the per-(enrollment, harness) key store (real Postgres).

Covers ``proliferate.db.store.agent_gateway.enrollment_keys`` directly, below
the ``enrollment.py`` service layer already exercised in
``test_agent_gateway_enrollment.py``: idempotent upsert, active-scope
uniqueness (one live key per (enrollment, harness)), decrypt round-trip, and
the parent-revocation cascade.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.organizations import Organization
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"enrollment-key-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _create_enrollment(db_session: AsyncSession) -> uuid.UUID:
    user_id = await _create_user(db_session)
    organization = Organization(name=f"Key Store Org {uuid.uuid4().hex[:6]}")
    db_session.add(organization)
    await db_session.flush()
    subject = await ensure_organization_billing_subject(db_session, organization.id)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        billing_subject_id=subject.id,
        organization_id=organization.id,
        user_id=user_id,
    )
    return enrollment.id


@pytest.mark.asyncio
async def test_upsert_creates_then_updates_the_same_active_row(
    db_session: AsyncSession,
) -> None:
    enrollment_id = await _create_enrollment(db_session)

    created = await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="claude",
        virtual_key_id="token-1",
        virtual_key="sk-litellm-1",
        sync_fingerprint="fp-1",
    )
    assert created.harness_kind == "claude"
    assert created.virtual_key_id == "token-1"

    # A second upsert for the same (enrollment, harness) updates the existing
    # row in place rather than creating a sibling.
    updated = await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="claude",
        virtual_key_id="token-2",
        virtual_key="sk-litellm-2",
        sync_fingerprint="fp-2",
    )
    assert updated.id == created.id
    assert updated.virtual_key_id == "token-2"

    active = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    assert len(active) == 1
    assert active[0].id == created.id


@pytest.mark.asyncio
async def test_upsert_keeps_existing_ciphertext_when_no_new_key_given(
    db_session: AsyncSession,
) -> None:
    """A resync that only refreshes metadata (``virtual_key=None``) must not
    clobber the stored secret — mirrors ``mark_enrollment_synced``'s treatment
    of the parent enrollment's key."""
    enrollment_id = await _create_enrollment(db_session)

    key = await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="codex",
        virtual_key_id="token-1",
        virtual_key="sk-litellm-1",
        sync_fingerprint="fp-1",
    )
    resynced = await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="codex",
        virtual_key_id="token-1",
        virtual_key=None,
        sync_fingerprint="fp-2",
    )
    assert resynced.id == key.id
    assert (
        await store.get_enrollment_key_virtual_key_decrypted(
            db_session, enrollment_key_id=resynced.id
        )
        == "sk-litellm-1"
    )


@pytest.mark.asyncio
async def test_distinct_harnesses_coexist_as_separate_rows(
    db_session: AsyncSession,
) -> None:
    enrollment_id = await _create_enrollment(db_session)

    for harness in ("claude", "codex", "opencode", "grok"):
        await store.upsert_enrollment_key(
            db_session,
            enrollment_id=enrollment_id,
            harness_kind=harness,
            virtual_key_id=f"token-{harness}",
            virtual_key=f"sk-litellm-{harness}",
            sync_fingerprint="fp",
        )

    active = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    assert {key.harness_kind for key in active} == {"claude", "codex", "opencode", "grok"}
    assert len({key.id for key in active}) == 4


@pytest.mark.asyncio
async def test_get_active_enrollment_key_scopes_by_harness(
    db_session: AsyncSession,
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="claude",
        virtual_key_id="token-claude",
        virtual_key="sk-litellm-claude",
        sync_fingerprint="fp",
    )

    found = await store.get_active_enrollment_key(
        db_session, enrollment_id=enrollment_id, harness_kind="claude"
    )
    assert found is not None
    assert found.virtual_key_id == "token-claude"

    missing = await store.get_active_enrollment_key(
        db_session, enrollment_id=enrollment_id, harness_kind="grok"
    )
    assert missing is None


@pytest.mark.asyncio
async def test_get_enrollment_key_by_virtual_key_id_resolves_the_token_hash(
    db_session: AsyncSession,
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    key = await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="opencode",
        virtual_key_id="token-opencode",
        virtual_key="sk-litellm-opencode",
        sync_fingerprint="fp",
    )

    resolved = await store.get_enrollment_key_by_virtual_key_id(
        db_session, virtual_key_id="token-opencode"
    )
    assert resolved is not None
    assert resolved.id == key.id
    assert resolved.enrollment_id == enrollment_id

    assert (
        await store.get_enrollment_key_by_virtual_key_id(
            db_session, virtual_key_id="does-not-exist"
        )
        is None
    )


@pytest.mark.asyncio
async def test_revoke_enrollment_keys_clears_every_active_row(
    db_session: AsyncSession,
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    for harness in ("claude", "codex"):
        await store.upsert_enrollment_key(
            db_session,
            enrollment_id=enrollment_id,
            harness_kind=harness,
            virtual_key_id=f"token-{harness}",
            virtual_key=f"sk-litellm-{harness}",
            sync_fingerprint="fp",
        )

    count = await store.revoke_enrollment_keys(db_session, enrollment_id=enrollment_id)
    assert count == 2
    assert await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id) == []

    # Idempotent: revoking again finds nothing left active.
    again = await store.revoke_enrollment_keys(db_session, enrollment_id=enrollment_id)
    assert again == 0


@pytest.mark.asyncio
async def test_revoke_enrollment_cascades_to_child_keys(db_session: AsyncSession) -> None:
    """Revoking the parent enrollment must also revoke its per-harness keys."""
    enrollment_id = await _create_enrollment(db_session)
    await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment_id,
        harness_kind="claude",
        virtual_key_id="token-claude",
        virtual_key="sk-litellm-claude",
        sync_fingerprint="fp",
    )

    revoked = await store.revoke_enrollment(db_session, enrollment_id=enrollment_id)
    assert revoked is not None
    assert revoked.revoked_at is not None
    assert await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id) == []


@pytest.mark.asyncio
async def test_get_enrollment_by_id_returns_row_regardless_of_revocation(
    db_session: AsyncSession,
) -> None:
    enrollment_id = await _create_enrollment(db_session)
    active = await store.get_enrollment_by_id(db_session, enrollment_id=enrollment_id)
    assert active is not None
    assert active.id == enrollment_id

    await store.revoke_enrollment(db_session, enrollment_id=enrollment_id)
    still_found = await store.get_enrollment_by_id(db_session, enrollment_id=enrollment_id)
    assert still_found is not None
    assert still_found.revoked_at is not None

    assert await store.get_enrollment_by_id(db_session, enrollment_id=uuid.uuid4()) is None
