"""Usage importer + LLM credit integration tests (real Postgres, stubbed LiteLLM)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.cloud.agent_gateway import AgentLlmUsageEvent
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.integrations.litellm import LiteLLMSpendLogEntry
from proliferate.server.cloud.agent_gateway import enrollment as enrollment_service
from proliferate.server.cloud.agent_gateway import usage_import as usage_import_service
from proliferate.server.cloud.agent_gateway.enrollment import ensure_user_enrollment
from proliferate.server.cloud.agent_gateway.free_credits import ensure_user_free_credit_grant
from proliferate.server.cloud.agent_gateway.usage_import import (
    is_gateway_budget_available,
    run_usage_import,
)


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"usage-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _link_github_identity(db_session: AsyncSession, *, user_id: uuid.UUID) -> None:
    subject = f"gh-{uuid.uuid4().hex[:12]}"
    db_session.add(
        AuthIdentity(
            user_id=user_id,
            provider="github",
            provider_subject=subject,
            email=f"{subject}@example.com",
            email_verified=True,
        )
    )
    await db_session.flush()


class StubLiteLLM:
    """Stubs the admin surfaces the enrollment + importer services call."""

    def __init__(self) -> None:
        self.teams: dict[str, str] = {}
        self.users: set[str] = set()
        self.minted: list[dict[str, object]] = []
        self.disabled_keys: list[str] = []
        self.spend_rows: list[LiteLLMSpendLogEntry] = []
        self.token_counter = 0
        self.last_spend_query: dict[str, str] | None = None
        # When True, page_spend_logs mirrors LiteLLM's real date semantics:
        # bounds are parsed at midnight and rows are filtered to
        # ``start 00:00 <= startTime <= end 00:00``.
        self.enforce_date_window = False

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for target in (enrollment_service.litellm, usage_import_service.litellm):
            monkeypatch.setattr(target, "ensure_team", self.ensure_team, raising=False)
            monkeypatch.setattr(target, "ensure_user", self.ensure_user, raising=False)
            monkeypatch.setattr(target, "mint_virtual_key", self.mint_virtual_key, raising=False)
            monkeypatch.setattr(
                target, "disable_virtual_key", self.disable_virtual_key, raising=False
            )
            monkeypatch.setattr(target, "page_spend_logs", self.page_spend_logs, raising=False)

    async def ensure_team(self, *, alias: str, max_budget: float | None = None) -> str:
        return self.teams.setdefault(alias, f"team-{alias}")

    async def ensure_user(self, *, user_id: str) -> str:
        self.users.add(user_id)
        return user_id

    async def mint_virtual_key(
        self,
        *,
        user_id: str,
        team_id: str | None = None,
        alias: str | None = None,
        max_budget: float | None = None,
        metadata: dict[str, object] | None = None,
    ):
        self.token_counter += 1
        token_id = f"token-{self.token_counter}"
        self.minted.append({"alias": alias, "token_id": token_id, "metadata": metadata or {}})
        from proliferate.integrations.litellm import LiteLLMVirtualKey

        return LiteLLMVirtualKey(
            key=f"sk-litellm-{self.token_counter}",
            token_id=token_id,
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def disable_virtual_key(self, *, key_or_token_id: str) -> None:
        self.disabled_keys.append(key_or_token_id)

    async def page_spend_logs(
        self, *, start_date: str, end_date: str
    ) -> list[LiteLLMSpendLogEntry]:
        self.last_spend_query = {"start_date": start_date, "end_date": end_date}
        if not self.enforce_date_window:
            return list(self.spend_rows)
        start = datetime.fromisoformat(start_date).replace(tzinfo=UTC)
        end = datetime.fromisoformat(end_date).replace(tzinfo=UTC)
        kept: list[LiteLLMSpendLogEntry] = []
        for row in self.spend_rows:
            raw = row.end_time or row.start_time
            if raw is None:
                continue
            ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if start <= ts <= end:
                kept.append(row)
        return kept


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> StubLiteLLM:
    stub = StubLiteLLM()
    stub.install(monkeypatch)
    return stub


def _spend_row(
    *,
    request_id: str,
    api_key: str,
    spend: float,
    occurred_at: datetime,
) -> LiteLLMSpendLogEntry:
    return LiteLLMSpendLogEntry.model_validate(
        {
            "request_id": request_id,
            "api_key": api_key,
            "model": "claude-sonnet-4-5",
            "spend": spend,
            "total_tokens": 120,
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "endTime": occurred_at.isoformat(),
        }
    )


@pytest.mark.asyncio
async def test_free_credit_granted_once_and_deduped(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)

    first = await ensure_user_free_credit_grant(db_session, user_id)
    second = await ensure_user_free_credit_grant(db_session, user_id)
    assert first is True
    assert second is True  # idempotent: returns the existing grant

    subject = await ensure_personal_billing_subject(db_session, user_id)
    balance = await store.get_remaining_credit_usd(db_session, subject.id)
    assert balance.granted_usd == Decimal("5")  # not doubled
    assert balance.remaining_usd == Decimal("5")


@pytest.mark.asyncio
async def test_free_credit_skipped_without_github_identity(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)

    granted = await ensure_user_free_credit_grant(db_session, user_id)
    assert granted is False


@pytest.mark.asyncio
async def test_importer_is_idempotent_across_overlapping_windows(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None

    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-1",
            api_key=enrollment.virtual_key_id,
            spend=0.10,
            occurred_at=occurred,
        )
    ]

    first = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert first.imported == 1
    assert first.skipped_duplicate == 0

    # Second tick: the same row is inside the overlap window; dedupe holds.
    second = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 15, tzinfo=UTC))
    assert second.imported == 0
    assert second.skipped_duplicate == 1

    total_rows = await db_session.scalar(select(func.count()).select_from(AgentLlmUsageEvent))
    assert total_rows == 1

    subject_id = enrollment.billing_subject_id
    balance = await store.get_remaining_credit_usd(db_session, subject_id)
    assert balance.used_usd == Decimal("0.10")
    assert balance.remaining_usd == Decimal("4.90")


@pytest.mark.asyncio
async def test_same_day_spend_is_imported(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A row logged earlier *today* must be imported on the same day.

    LiteLLM bounds ``end_date`` at midnight, so an ``end_date`` of ``now.date()``
    excludes everything logged since 00:00 today. The importer must widen the
    window to ``now + 1 day``; this regresses to ``imported == 0`` if it does
    not.
    """
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    stub_litellm.enforce_date_window = True
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None

    now = datetime(2026, 7, 1, 12, 10, tzinfo=UTC)
    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)  # earlier the same day
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-today",
            api_key=enrollment.virtual_key_id,
            spend=0.10,
            occurred_at=occurred,
        )
    ]

    result = await run_usage_import(db_session, now=now)
    assert result.imported == 1
    assert stub_litellm.last_spend_query is not None
    # end_date must reach past today for LiteLLM's midnight-bounded filter.
    assert stub_litellm.last_spend_query["end_date"] == "2026-07-02"


@pytest.mark.asyncio
async def test_exhaustion_disables_key_and_flips_budget_status(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0.001")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None
    assert enrollment.budget_status == "ok"

    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-exhaust",
            api_key=enrollment.virtual_key_id,
            spend=0.05,  # far past the 0.001 grant
            occurred_at=occurred,
        )
    ]

    result = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert result.imported == 1
    assert result.exhausted_subjects == 1

    # The VK was disabled via the LiteLLM admin client.
    assert stub_litellm.disabled_keys == [enrollment.virtual_key_id]

    refreshed = await store.get_enrollment_for_user(db_session, user_id=user_id)
    assert refreshed is not None
    assert refreshed.budget_status == "exhausted"

    balance = await store.get_remaining_credit_usd(db_session, enrollment.billing_subject_id)
    assert balance.remaining_usd < Decimal("0")

    # Re-running does not re-disable an already-exhausted key.
    again = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 20, tzinfo=UTC))
    assert again.exhausted_subjects == 0
    assert stub_litellm.disabled_keys == [enrollment.virtual_key_id]


@pytest.mark.asyncio
async def test_unresolved_key_row_is_flagged_needs_review(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    occurred = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-orphan",
            api_key="token-does-not-exist",
            spend=0.02,
            occurred_at=occurred,
        )
    ]

    result = await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert result.imported == 1
    assert result.unresolved == 1

    row = (
        await db_session.execute(
            select(AgentLlmUsageEvent).where(AgentLlmUsageEvent.litellm_request_id == "req-orphan")
        )
    ).scalar_one()
    assert row.status == "needs_review"
    assert row.billing_subject_id is None


@pytest.mark.asyncio
async def test_is_gateway_budget_available(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None

    # Fresh grant, no usage → available.
    assert await is_gateway_budget_available(db_session, user_id) is True

    # Spend past the grant → unavailable.
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-drain",
            api_key=enrollment.virtual_key_id,
            spend=6.0,
            occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        )
    ]
    await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert await is_gateway_budget_available(db_session, user_id) is False

    # A user with no enrollment at all is never blocked by the ledger.
    other_id = await _create_user(db_session)
    assert await is_gateway_budget_available(db_session, other_id) is True


@pytest.mark.asyncio
async def test_gateway_disabled_makes_budget_always_available(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", False)
    user_id = await _create_user(db_session)
    assert await is_gateway_budget_available(db_session, user_id) is True


@pytest.mark.asyncio
async def test_exhausted_budget_withholds_gateway_key_from_state_render(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """The second enforcement wall: state.json stops carrying the virtual key.

    Even if the LiteLLM key-disable (first wall) lagged or failed, an
    exhausted subject's agent-auth state render must drop the gateway source,
    so the runtime fails closed at launch.
    """
    from proliferate.db.store.agent_gateway import DesiredAuthSource
    from proliferate.db.store.agent_gateway.selections import put_auth_selections
    from proliferate.server.cloud.materialization.materialize.agent_auth import (
        build_agent_auth_state,
    )

    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )

    # With credit remaining, the render hands out the gateway key.
    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert any(s["kind"] == "gateway" and s.get("key") for s in sources)

    # Drain the grant; simulate the first wall failing by NOT relying on the
    # key-disable — the render alone must now withhold the key.
    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-wall2",
            api_key=enrollment.virtual_key_id,
            spend=6.0,
            occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        )
    ]
    await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))
    assert await is_gateway_budget_available(db_session, user_id) is False

    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert not any(s["kind"] == "gateway" for s in sources)


@pytest.mark.asyncio
async def test_exhausted_budget_blocks_gateway_catalog_refresh_with_402(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    from proliferate.server.cloud.agent_gateway import catalog as catalog_service
    from proliferate.server.cloud.errors import CloudApiError

    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None

    stub_litellm.spend_rows = [
        _spend_row(
            request_id="req-catalog-drain",
            api_key=enrollment.virtual_key_id,
            spend=6.0,
            occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        )
    ]
    await run_usage_import(db_session, now=datetime(2026, 7, 1, 12, 10, tzinfo=UTC))

    with pytest.raises(CloudApiError) as excinfo:
        await catalog_service.refresh_catalog(
            db_session,
            user_id=user_id,
            harness_kind="claude",
            surface="local",
            route="gateway",
            models_json=None,
        )
    assert excinfo.value.code == "agent_gateway_credits_exhausted"
    assert excinfo.value.status_code == 402


@pytest.mark.asyncio
async def test_available_budget_leaves_state_render_and_no_grant_unblocked(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: StubLiteLLM,
) -> None:
    """A no-grant subject (default-budget) is never blocked by the ledger gate."""
    from proliferate.db.store.agent_gateway import DesiredAuthSource
    from proliferate.db.store.agent_gateway.selections import put_auth_selections
    from proliferate.server.cloud.materialization.materialize.agent_auth import (
        build_agent_auth_state,
    )

    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    # Free credits disabled: enrollment has no grant, LiteLLM default budget
    # is the only guardrail; the ledger gate must not block.
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "0")
    monkeypatch.setattr(
        settings,
        "agent_gateway_litellm_public_base_url",
        "https://llm.proliferate.ai",
    )
    user_id = await _create_user(db_session)
    await _link_github_identity(db_session, user_id=user_id)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None

    await put_auth_selections(
        db_session,
        user_id=user_id,
        harness_kind="claude",
        surface="local",
        sources=[DesiredAuthSource(source_kind="gateway")],
    )
    assert await is_gateway_budget_available(db_session, user_id) is True
    state, _ = await build_agent_auth_state(db_session, user_id, surface="local")
    sources = [s for h in state["harnesses"] for s in h["sources"]]
    assert any(s["kind"] == "gateway" and s.get("key") for s in sources)
