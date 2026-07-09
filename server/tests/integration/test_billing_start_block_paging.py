"""Billing start-block: stable 402 code + no pager on routine quota denials.

Prod incident (2026-07): an out-of-credits owner creating a cloud workspace hit
the enforce-mode billing gate. That is EXPECTED business logic, but two things
were wrong: the client only got an opaque code, and the background
materialization path fired ``report_critical`` (a Sentry level=fatal pager) for
the quota denial. These tests pin:

* the credits-exhausted denial surfaces the stable ``billing_credits_exhausted``
  code with a machine-readable reason + remaining_seconds on the 402 body, and
* the materialization runner logs (does not page) on a billing block, while
  still paging on genuinely unexpected failures.
"""

from __future__ import annotations

import contextlib
import uuid
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_MODE_ENFORCE,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
)
from proliferate.db.models.auth import User
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_personal_billing_subject,
)
from proliferate.server.billing.authorization import CloudSandboxResumeBlockedError
from proliferate.server.cloud.cloud_sandboxes.service import ensure_cloud_sandbox_ready
from proliferate.server.cloud.materialization import runner as runner_module
from tests.integration.billing_accounting_helpers import seed_usage_segment


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"start-block-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _seed_credits_exhausted_user(db_session: AsyncSession) -> uuid.UUID:
    """A free-plan owner whose included sandbox hours are fully consumed."""
    user_id = await _create_user(db_session)
    await ensure_personal_billing_subject(db_session, user_id)
    await ensure_free_included_grant(db_session, user_id)
    # Burn more than the (small) included grant so the subject is over quota
    # with no paid overage -> credit_reason == credits_exhausted.
    await seed_usage_segment(db_session, user_id=user_id, hours=5.0)
    await db_session.commit()
    return user_id


@pytest.mark.asyncio
async def test_credits_exhausted_uses_stable_402_code(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An exhausted owner gets a 402 with the stable credits-exhausted code."""
    monkeypatch.setattr(settings, "cloud_billing_mode", BILLING_MODE_ENFORCE)
    monkeypatch.setattr(settings, "pro_billing_enabled", False)
    monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 1.0)
    user_id = await _seed_credits_exhausted_user(db_session)

    with pytest.raises(CloudSandboxResumeBlockedError) as excinfo:
        await ensure_cloud_sandbox_ready(db_session, SimpleNamespace(id=user_id))

    error = excinfo.value
    assert error.status_code == 402
    assert error.code == "billing_credits_exhausted"
    assert error.reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
    assert error.message == (
        "Cloud usage is paused because your included sandbox hours are exhausted."
    )
    # Machine-readable fields the client keys off, copied into the 402 detail.
    assert error.extra_detail["reason"] == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
    assert "remaining_seconds" in error.extra_detail
    assert error.billing_subject_id is not None
    assert error.owner_user_id == user_id


@contextlib.asynccontextmanager
async def _noop_session():
    """Minimal async session stand-in for the runner's fresh-session path."""

    class _Session:
        async def commit(self) -> None:  # pragma: no cover - trivial
            return None

        async def rollback(self) -> None:  # pragma: no cover - trivial
            return None

    yield _Session()


@pytest.mark.asyncio
async def test_runner_does_not_page_on_billing_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A billing block from a materialization task logs; it must not page."""
    monkeypatch.setattr(runner_module, "async_session_factory", _noop_session)

    paged: list[object] = []
    monkeypatch.setattr(
        runner_module,
        "report_critical",
        lambda exc, **_: paged.append(exc),
    )
    logged: list[dict[str, object]] = []
    monkeypatch.setattr(
        runner_module.logger,
        "info",
        lambda _msg, *, extra=None: logged.append(extra or {}),
    )

    subject_id = uuid.uuid4()
    user_id = uuid.uuid4()

    async def _blocked(_db: object) -> None:
        raise CloudSandboxResumeBlockedError(
            "Cloud usage is paused because your included sandbox hours are exhausted.",
            decision_type="enforce_active_spend",
            reason=WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
            billing_subject_id=subject_id,
            owner_user_id=user_id,
            remaining_seconds=0,
        )

    await runner_module._run_with_fresh_session(_blocked, {})

    assert paged == []
    assert len(logged) == 1
    assert logged[0]["billing_subject_id"] == str(subject_id)
    assert logged[0]["user_id"] == str(user_id)
    assert logged[0]["reason"] == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED


@pytest.mark.asyncio
async def test_runner_still_pages_on_unexpected_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A genuinely unexpected materialization failure must still page."""
    monkeypatch.setattr(runner_module, "async_session_factory", _noop_session)

    paged: list[object] = []
    monkeypatch.setattr(
        runner_module,
        "report_critical",
        lambda exc, **_: paged.append(exc),
    )

    async def _boom(_db: object) -> None:
        raise RuntimeError("provider exploded")

    await runner_module._run_with_fresh_session(_boom, {})

    assert len(paged) == 1
    assert isinstance(paged[0], RuntimeError)
