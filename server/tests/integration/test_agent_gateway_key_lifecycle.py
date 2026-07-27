"""Money-path guards on the per-harness key lifecycle (real Postgres, stubbed LiteLLM).

Three adversarial-review findings on B2, each with its own section below:

1. ``_disable_enrollment_keys`` must not report success when it disabled
   nothing — flipping ``budget_status`` on an empty key set would mark the
   enrollment enforced forever while any key stays billable.
2. ``_sync_enrollment`` must reclaim the pre-B2 unscoped parent key before the
   row stops pointing at it; a failed reclaim marks the row ``failed`` so the
   backfill worker retries instead of dropping the revocation.
3. The parent ``sync_fingerprint`` must be *compared*, not just written: a
   changed gateway-capable harness set reopens the enrollment and the next sync
   mints the missing key.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import AGENT_AUTH_HARNESS_KINDS, LLM_CREDIT_SOURCE_ADMIN
from proliferate.db.models.auth import User
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.cloud.agent_gateway import enrollment as enrollment_service
from proliferate.server.cloud.agent_gateway import usage_import as usage_import_service
from proliferate.server.cloud.agent_gateway.enrollment import ensure_user_enrollment
from proliferate.server.cloud.agent_gateway.usage_import import _enforce_subject_exhaustion

NOW = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


class _StubLiteLLM:
    """The admin surfaces enrollment sync + exhaustion enforcement touch."""

    def __init__(self) -> None:
        self.minted: list[dict[str, Any]] = []
        self.disabled_keys: list[str] = []
        self.deleted_keys: list[str] = []
        self.token_counter = 0
        self.fail_delete = False
        self.missing_keys: set[str] = set()

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for target in (enrollment_service.litellm, usage_import_service.litellm):
            monkeypatch.setattr(target, "ensure_team", self.ensure_team, raising=False)
            monkeypatch.setattr(target, "ensure_user", self.ensure_user, raising=False)
            monkeypatch.setattr(target, "mint_virtual_key", self.mint_virtual_key, raising=False)
            monkeypatch.setattr(
                target, "delete_virtual_key", self.delete_virtual_key, raising=False
            )
            monkeypatch.setattr(
                target, "disable_virtual_key", self.disable_virtual_key, raising=False
            )

    async def ensure_team(
        self,
        *,
        alias: str,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        return f"team-{alias}"

    async def ensure_user(self, *, user_id: str, metadata: dict[str, Any] | None = None) -> str:
        return user_id

    async def mint_virtual_key(
        self,
        *,
        user_id: str,
        team_id: str | None = None,
        alias: str | None = None,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
        models: list[str] | None = None,
    ) -> LiteLLMVirtualKey:
        self.token_counter += 1
        self.minted.append({"alias": alias, "models": models})
        return LiteLLMVirtualKey(
            key=f"sk-litellm-{self.token_counter}",
            token_id=f"token-{self.token_counter}",
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def delete_virtual_key(self, *, key_or_token_id: str) -> None:
        if self.fail_delete:
            raise LiteLLMIntegrationError("litellm_request_failed", "key delete unavailable")
        if key_or_token_id in self.missing_keys:
            # Mirrors the real client's tolerance: LiteLLM reports the key
            # missing (e.g. a prior delete that landed on the proxy but whose
            # DB write then rolled back, so this same id is retried against a
            # key that is already gone). The key being gone IS the desired
            # end state, so this is swallowed rather than raised.
            return
        self.deleted_keys.append(key_or_token_id)

    async def disable_virtual_key(self, *, key_or_token_id: str) -> None:
        self.disabled_keys.append(key_or_token_id)


@pytest.fixture
def gateway_litellm(monkeypatch: pytest.MonkeyPatch) -> _StubLiteLLM:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0")
    stub = _StubLiteLLM()
    stub.install(monkeypatch)
    return stub


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"key-lifecycle-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


# --- 1. exhaustion must not "succeed" having disabled nothing ----------------


@pytest.mark.asyncio
async def test_enrollment_without_child_keys_is_not_marked_exhausted(
    db_session: AsyncSession,
    gateway_litellm: _StubLiteLLM,
) -> None:
    """A keyless enrollment stays ``ok`` and is retried on the next tick.

    ``_disable_enrollment_keys`` used to start from "all disabled" and never
    revisit that on an empty list, so a drained enrollment with no child key
    rows yet was marked ``exhausted`` having disabled nothing at all. Both
    callers skip already-``exhausted`` enrollments, so the flip permanently
    suppressed enforcement: a key minted a moment later would stay live and
    billable with no retry.
    """
    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        subject_kind="user",
        billing_subject_id=subject.id,
        user_id=user_id,
    )
    # A drained grant: granted > 0 and remaining <= 0, i.e. enforceable.
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("1"),
        source_ref=f"admin:{uuid.uuid4().hex[:8]}",
    )
    await store.insert_usage_event_once(
        db_session,
        litellm_request_id=f"req-{uuid.uuid4().hex[:10]}",
        occurred_at=NOW,
        virtual_key_id=None,
        litellm_team_id=None,
        user_id=user_id,
        organization_id=None,
        billing_subject_id=subject.id,
        model="claude-sonnet-4-5",
        prompt_tokens=100,
        completion_tokens=20,
        total_tokens=120,
        cost_usd=5.0,
        status="imported",
        workspace_id=None,
        session_id=None,
        raw_metadata_json=None,
    )
    assert await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment.id) == []

    enforced = await _enforce_subject_exhaustion(
        db_session,
        subject.id,
        [enrollment],
        now=NOW,
    )

    assert enforced is False
    assert gateway_litellm.disabled_keys == []
    refreshed = await store.get_enrollment_for_user(db_session, user_id=user_id)
    assert refreshed is not None
    assert refreshed.budget_status == "ok"

    # Retried on a later tick: once a key exists it IS disabled and flipped.
    await store.upsert_enrollment_key(
        db_session,
        enrollment_id=enrollment.id,
        harness_kind="claude",
        virtual_key_id="token-late",
        virtual_key="sk-litellm-late",
        sync_fingerprint="fp",
    )
    enforced_again = await _enforce_subject_exhaustion(
        db_session,
        subject.id,
        [refreshed],
        now=NOW,
    )
    assert enforced_again is True
    assert gateway_litellm.disabled_keys == ["token-late"]
    final = await store.get_enrollment_for_user(db_session, user_id=user_id)
    assert final is not None
    assert final.budget_status == "exhausted"


# --- 2. the pre-B2 unscoped parent key is reclaimed at sync ------------------


async def _pre_b2_enrollment(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """A synced pre-B2 enrollment: one unscoped key on the parent, no children."""
    user_id = await _create_user(db_session)
    subject = await ensure_personal_billing_subject(db_session, user_id)
    enrollment = await store.ensure_enrollment_row(
        db_session,
        subject_kind="user",
        billing_subject_id=subject.id,
        user_id=user_id,
    )
    await store.mark_enrollment_synced(
        db_session,
        enrollment_id=enrollment.id,
        litellm_team_id=f"team-user-{user_id}",
        litellm_user_id=f"user-{user_id}",
        virtual_key_id="token-legacy-unscoped",
        virtual_key="sk-litellm-legacy",
        sync_fingerprint="pre-b2-fingerprint",
    )
    # What the B2 migration does to every synced row.
    await store.mark_enrollment_pending(db_session, enrollment_id=enrollment.id)
    return user_id, enrollment.id


@pytest.mark.asyncio
async def test_first_sync_revokes_the_pre_b2_unscoped_key(
    db_session: AsyncSession,
    gateway_litellm: _StubLiteLLM,
) -> None:
    """The old all-model key is deleted on the proxy, not just forgotten locally.

    Clearing ``virtual_key_id`` without a ``/key/delete`` would leave a live
    unscoped key: any client already holding it keeps all-model access forever,
    and its spend resolves to no tracked key so the importer files it
    ``needs_review`` and never debits it.
    """
    user_id, enrollment_id = await _pre_b2_enrollment(db_session)

    synced = await ensure_user_enrollment(db_session, user_id)

    assert synced.id == enrollment_id
    assert synced.sync_status == "synced"
    assert gateway_litellm.deleted_keys == ["token-legacy-unscoped"]
    # Parent key material gone locally too, replaced by per-harness children.
    assert synced.virtual_key_id is None
    child_kinds = {
        key.harness_kind
        for key in await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    }
    assert child_kinds == set(AGENT_AUTH_HARNESS_KINDS)


@pytest.mark.asyncio
async def test_revocation_failure_marks_sync_failed_for_retry(
    db_session: AsyncSession,
    gateway_litellm: _StubLiteLLM,
) -> None:
    """A LiteLLM-side delete failure must not silently drop the revocation.

    The row goes ``failed`` (so ``list_enrollments_needing_sync`` picks it up
    again) and keeps its parent key id, which is the only handle on the key
    still needing deletion. A later tick with a healthy proxy completes it.
    """
    user_id, enrollment_id = await _pre_b2_enrollment(db_session)
    gateway_litellm.fail_delete = True

    failed = await ensure_user_enrollment(db_session, user_id)

    assert failed.sync_status == "failed"
    assert failed.virtual_key_id == "token-legacy-unscoped"
    assert gateway_litellm.deleted_keys == []

    gateway_litellm.fail_delete = False
    recovered = await ensure_user_enrollment(db_session, user_id)
    assert recovered.sync_status == "synced"
    assert recovered.virtual_key_id is None
    assert gateway_litellm.deleted_keys == ["token-legacy-unscoped"]
    assert enrollment_id == recovered.id


@pytest.mark.asyncio
async def test_revocation_retry_of_already_deleted_key_still_completes_sync(
    db_session: AsyncSession,
    gateway_litellm: _StubLiteLLM,
) -> None:
    """A retry against a key LiteLLM no longer has must not wedge the row.

    Simulates the exact B5-R scenario: a prior ``/key/delete`` landed on the
    proxy but the enrollment's DB transaction rolled back before recording
    that, so the row still points at ``virtual_key_id`` on the next tick and
    retries the delete. LiteLLM reports the key missing (non-2xx). Before the
    fix that non-2xx propagated as ``LiteLLMIntegrationError`` and pinned the
    row ``failed`` forever, since the key can never be found again. The fix
    tolerates it (the key being gone IS the desired end state), so the sync
    completes and the row reaches ``synced``.
    """
    user_id, enrollment_id = await _pre_b2_enrollment(db_session)
    gateway_litellm.missing_keys.add("token-legacy-unscoped")

    synced = await ensure_user_enrollment(db_session, user_id)

    assert synced.sync_status == "synced"
    assert synced.virtual_key_id is None
    # The stub never records a "delete" for a key it reports missing, but the
    # sync must still have gone through: no `failed` wedge, and the
    # per-harness child keys were minted as normal.
    assert gateway_litellm.deleted_keys == []
    child_kinds = {
        key.harness_kind
        for key in await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment_id)
    }
    assert child_kinds == set(AGENT_AUTH_HARNESS_KINDS)


# --- 3. the fingerprint is compared, so the bump mechanism is real ----------


@pytest.mark.asyncio
async def test_added_harness_kind_reopens_enrollment_and_mints_missing_key(
    db_session: AsyncSession,
    gateway_litellm: _StubLiteLLM,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Config gains a gateway-capable harness → drift → next sync mints its key.

    ``ensure_*_enrollment`` short-circuits on ``sync_status == 'synced'``, so
    without the fingerprint comparison a newly gateway-capable harness would
    never get a key for any existing enrollment. The comparison is what makes
    "rotation via fingerprint bump" a real mechanism rather than a write-only
    column.
    """
    user_id = await _create_user(db_session)
    monkeypatch.setattr(
        enrollment_service,
        "_GATEWAY_CAPABLE_HARNESS_KINDS",
        ("claude", "codex"),
    )

    first = await ensure_user_enrollment(db_session, user_id)
    assert first.sync_status == "synced"
    assert {
        key.harness_kind
        for key in await store.list_active_enrollment_keys(db_session, enrollment_id=first.id)
    } == {"claude", "codex"}
    minted_before = len(gateway_litellm.minted)

    # No drift → no re-sync, no extra mint.
    unchanged = await ensure_user_enrollment(db_session, user_id)
    assert unchanged.sync_fingerprint == first.sync_fingerprint
    assert len(gateway_litellm.minted) == minted_before

    # A new gateway-capable harness appears in the config.
    monkeypatch.setattr(
        enrollment_service,
        "_GATEWAY_CAPABLE_HARNESS_KINDS",
        ("claude", "codex", "grok"),
    )

    resynced = await ensure_user_enrollment(db_session, user_id)

    assert resynced.sync_status == "synced"
    assert resynced.sync_fingerprint != first.sync_fingerprint
    assert {
        key.harness_kind
        for key in await store.list_active_enrollment_keys(db_session, enrollment_id=first.id)
    } == {"claude", "codex", "grok"}
    # Exactly one new mint: the already-present keys are never re-minted.
    assert len(gateway_litellm.minted) == minted_before + 1
    assert gateway_litellm.minted[-1]["models"] == ["grok"]


@pytest.mark.asyncio
async def test_child_key_fingerprint_covers_team_and_its_own_alias(
    db_session: AsyncSession,
    gateway_litellm: _StubLiteLLM,
) -> None:
    """Each child row's fingerprint describes that key, not the whole set."""
    user_id = await _create_user(db_session)
    enrollment = await ensure_user_enrollment(db_session, user_id)

    keys = await store.list_active_enrollment_keys(db_session, enrollment_id=enrollment.id)
    fingerprints = {key.sync_fingerprint for key in keys}
    # Distinct per harness (each key's alias differs) and distinct from the
    # parent's key-set fingerprint.
    assert len(fingerprints) == len(keys)
    assert enrollment.sync_fingerprint not in fingerprints
    for key in keys:
        assert key.sync_fingerprint == enrollment_service.build_enrollment_key_fingerprint(
            team_id=f"team-user-{user_id}",
            key_alias=enrollment_service.enrollment_key_alias(enrollment, key.harness_kind),
        )
