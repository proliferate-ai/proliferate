"""Service-layer wake/ensure billing gate (spec §4.3, issue #1036).

The resume gate used to live only in ``connect_ready_sandbox``. ``POST
/cloud-sandbox/wake`` and ``POST /cloud-sandbox/ensure`` route through
``wake_cloud_sandbox`` / ``ensure_cloud_sandbox_ready`` in the cloud-sandbox
service, which only ensured the DB row, so an exhausted owner got a
``status: ready`` sandbox back instead of a 402. These tests pin that both
service entry points now run ``assert_cloud_sandbox_resume_allowed_for_owner``
before any row is created, enforce-mode only.
"""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_HOLD_KIND_ADMIN_HOLD,
    BILLING_HOLD_STATUS_ACTIVE,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingHold
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing.authorization import CloudSandboxResumeBlockedError
from proliferate.server.cloud.cloud_sandboxes.service import (
    ensure_cloud_sandbox_ready,
    wake_cloud_sandbox,
)


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"wake-gate-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _seed_exhausted_user(db_session: AsyncSession) -> uuid.UUID:
    """A personal subject on an active spend hold (the exhausted case)."""
    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    db_session.add(
        BillingHold(
            billing_subject_id=subject.id,
            kind=BILLING_HOLD_KIND_ADMIN_HOLD,
            status=BILLING_HOLD_STATUS_ACTIVE,
            source="test",
        )
    )
    await db_session.commit()
    return user_id


async def _seed_healthy_user(db_session: AsyncSession) -> uuid.UUID:
    """A subject with trial credits and no hold (never exhausted)."""
    user_id = await _create_user(db_session)
    await ensure_personal_billing_subject(db_session, user_id)
    await ensure_free_included_grant(db_session, user_id)
    await db_session.commit()
    return user_id


@pytest.mark.asyncio
async def test_wake_denied_when_exhausted(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """/wake for an exhausted owner raises the structured 402 before creating a row."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    user_id = await _seed_exhausted_user(db_session)

    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await wake_cloud_sandbox(db_session, SimpleNamespace(id=user_id))

    assert excinfo.value.status_code == 402
    assert excinfo.value.code == "billing_start_blocked"
    # The gate must run before ensure_personal_cloud_sandbox_exists stages a row.
    await db_session.rollback()
    assert await sandbox_store.load_personal_cloud_sandbox(db_session, user_id) is None


@pytest.mark.asyncio
async def test_ensure_denied_when_exhausted(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """/ensure is a start path too: an exhausted owner is refused with a 402."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    user_id = await _seed_exhausted_user(db_session)

    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await ensure_cloud_sandbox_ready(db_session, SimpleNamespace(id=user_id))

    assert excinfo.value.status_code == 402
    assert excinfo.value.code == "billing_start_blocked"
    await db_session.rollback()
    assert await sandbox_store.load_personal_cloud_sandbox(db_session, user_id) is None


@pytest.mark.asyncio
async def test_wake_allowed_for_healthy_user(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A user with fresh trial credits is not exhausted: wake creates the row."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    user_id = await _seed_healthy_user(db_session)

    sandbox = await wake_cloud_sandbox(db_session, SimpleNamespace(id=user_id))

    assert sandbox is not None
    assert sandbox.owner_user_id == user_id


@pytest.mark.asyncio
async def test_wake_noop_outside_enforce_mode(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Observe mode never blocks a wake, even for an exhausted owner."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_OBSERVE)
    user_id = await _seed_exhausted_user(db_session)

    sandbox = await wake_cloud_sandbox(db_session, SimpleNamespace(id=user_id))

    assert sandbox is not None
    assert sandbox.owner_user_id == user_id
