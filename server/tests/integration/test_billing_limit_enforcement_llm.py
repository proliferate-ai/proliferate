"""LLM budget-limit enforcement via the usage-import pass (spec §4.1).

Real Postgres, stubbed LiteLLM: an org member over their enabled LLM cap gets
their virtual key disabled and ``budget_status='limit_reached'``; raising the
cap re-enables the key on the next import tick (credit permitting).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import LLM_CREDIT_SOURCE_ADMIN
from proliferate.db.models.auth import User
from proliferate.db.models.cloud.agent_gateway import AgentGatewayEnrollment
from proliferate.db.models.organizations import Organization
from proliferate.db.store import agent_gateway as store
from proliferate.db.store import billing as billing_store
from proliferate.db.store.billing import BudgetLimitInput
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.integrations.litellm import LiteLLMSpendLogEntry, LiteLLMVirtualKey
from proliferate.server.cloud.agent_gateway import enrollment as enrollment_service
from proliferate.server.cloud.agent_gateway import topups as topups_service
from proliferate.server.cloud.agent_gateway import usage_import as usage_import_service
from proliferate.server.cloud.agent_gateway.enrollment import ensure_org_enrollment
from proliferate.server.cloud.agent_gateway.usage_import import run_usage_import

NOW = datetime(2026, 7, 7, 12, 0, tzinfo=UTC)


class _StubLiteLLM:
    """Covers every admin surface enrollment + import + reactivation touch."""

    def __init__(self) -> None:
        self.disabled_keys: list[str] = []
        self.enabled_keys: list[str] = []
        self.spend_rows: list[LiteLLMSpendLogEntry] = []
        self.token_counter = 0

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for target in (
            enrollment_service.litellm,
            usage_import_service.litellm,
            topups_service.litellm,
        ):
            monkeypatch.setattr(target, "ensure_team", self.ensure_team, raising=False)
            monkeypatch.setattr(target, "ensure_user", self.ensure_user, raising=False)
            monkeypatch.setattr(target, "mint_virtual_key", self.mint_virtual_key, raising=False)
            monkeypatch.setattr(
                target, "disable_virtual_key", self.disable_virtual_key, raising=False
            )
            monkeypatch.setattr(
                target, "enable_virtual_key", self.enable_virtual_key, raising=False
            )
            monkeypatch.setattr(
                target, "rotate_virtual_key", self.rotate_virtual_key, raising=False
            )
            monkeypatch.setattr(
                target, "update_team_budget", self.update_team_budget, raising=False
            )
            monkeypatch.setattr(target, "set_key_budget", self.set_key_budget, raising=False)
            monkeypatch.setattr(target, "page_spend_logs", self.page_spend_logs, raising=False)

    async def ensure_team(self, *, alias: str, max_budget: float | None = None) -> str:
        return f"team-{alias}"

    async def ensure_user(self, *, user_id: str) -> str:
        return user_id

    async def mint_virtual_key(
        self,
        *,
        user_id: str,
        team_id: str | None = None,
        alias: str | None = None,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> LiteLLMVirtualKey:
        self.token_counter += 1
        return LiteLLMVirtualKey(
            key=f"sk-litellm-{self.token_counter}",
            token_id=f"token-{self.token_counter}",
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def disable_virtual_key(self, *, key_or_token_id: str) -> None:
        self.disabled_keys.append(key_or_token_id)

    async def enable_virtual_key(self, *, key_or_token_id: str) -> None:
        self.enabled_keys.append(key_or_token_id)

    async def rotate_virtual_key(self, **kwargs: Any) -> LiteLLMVirtualKey:
        return await self.mint_virtual_key(
            user_id=kwargs.get("user_id", "user"),
            team_id=kwargs.get("team_id"),
            alias=kwargs.get("alias"),
            max_budget=kwargs.get("max_budget"),
            metadata=kwargs.get("metadata"),
        )

    async def update_team_budget(self, *, team_id: str, max_budget: float | None) -> None:
        return None

    async def set_key_budget(self, *, key_or_token_id: str, max_budget: float | None) -> None:
        return None

    async def page_spend_logs(
        self, *, start_date: str, end_date: str
    ) -> list[LiteLLMSpendLogEntry]:
        return list(self.spend_rows)


@pytest.fixture
def stub_litellm(monkeypatch: pytest.MonkeyPatch) -> _StubLiteLLM:
    stub = _StubLiteLLM()
    stub.install(monkeypatch)
    return stub


def _spend_row(*, api_key: str, spend: float, occurred_at: datetime) -> LiteLLMSpendLogEntry:
    return LiteLLMSpendLogEntry.model_validate(
        {
            "request_id": f"req-{uuid.uuid4().hex}",
            "api_key": api_key,
            "model": "claude-sonnet-4-5",
            "spend": spend,
            "total_tokens": 120,
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "endTime": occurred_at.isoformat(),
        }
    )


async def _enroll_member(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, str]:
    org = Organization(name=f"org-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    await db_session.flush()
    subject = await ensure_organization_billing_subject(db_session, org.id)
    # A generous LLM credit grant keeps the subject off the exhaustion path so
    # only the budget cap can disable the key.
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source=LLM_CREDIT_SOURCE_ADMIN,
        amount_usd=Decimal("100"),
        source_ref=f"seed-{uuid.uuid4().hex[:8]}",
    )
    user = User(
        email=f"member-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    user_id = user.id
    enrollment = await ensure_org_enrollment(db_session, org.id, user_id)
    assert enrollment.virtual_key_id is not None
    return org.id, subject.id, user_id, enrollment.virtual_key_id


@pytest.mark.asyncio
async def test_llm_over_cap_disables_key_then_cap_raise_reenables(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: _StubLiteLLM,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    org_id, _subject_id, user_id, virtual_key_id = await _enroll_member(db_session)
    enrollment_id = (
        await store.get_enrollment_by_virtual_key_id(db_session, virtual_key_id=virtual_key_id)
    ).id

    await billing_store.replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=user_id,
                kind="llm",
                window="month",
                cap_value=Decimal("1.00"),
                enabled=True,
            )
        ],
    )

    stub_litellm.spend_rows = [_spend_row(api_key=virtual_key_id, spend=5.0, occurred_at=NOW)]
    await run_usage_import(db_session, now=NOW)

    row = await db_session.get(AgentGatewayEnrollment, enrollment_id)
    await db_session.refresh(row)
    assert row.budget_status == "limit_reached"
    assert virtual_key_id in stub_litellm.disabled_keys

    # Raise the cap well above spend; next tick re-enables the key.
    await billing_store.replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=user_id,
                kind="llm",
                window="month",
                cap_value=Decimal("1000.00"),
                enabled=True,
            )
        ],
    )
    await run_usage_import(db_session, now=NOW)

    await db_session.refresh(row)
    assert row.budget_status == "ok"
    assert virtual_key_id in stub_litellm.enabled_keys


@pytest.mark.asyncio
async def test_llm_topup_reactivation_never_clears_limit_reached(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    stub_litellm: _StubLiteLLM,
) -> None:
    """A credit top-up must not unblock a key its admin capped (§4.1 confusion)."""
    monkeypatch.setattr(settings, "agent_gateway_enabled", True)
    org_id, subject_id, user_id, virtual_key_id = await _enroll_member(db_session)
    enrollment_id = (
        await store.get_enrollment_by_virtual_key_id(db_session, virtual_key_id=virtual_key_id)
    ).id

    await billing_store.replace_budget_limits(
        db_session,
        organization_id=org_id,
        limits=[
            BudgetLimitInput(
                user_id=user_id,
                kind="llm",
                window="month",
                cap_value=Decimal("1.00"),
                enabled=True,
            )
        ],
    )
    stub_litellm.spend_rows = [_spend_row(api_key=virtual_key_id, spend=5.0, occurred_at=NOW)]
    await run_usage_import(db_session, now=NOW)
    row = await db_session.get(AgentGatewayEnrollment, enrollment_id)
    await db_session.refresh(row)
    assert row.budget_status == "limit_reached"

    stub_litellm.enabled_keys.clear()
    # Simulate a top-up landing more credit and running subject reactivation.
    await topups_service.reactivate_subject_if_credited(db_session, subject_id, now=NOW)

    await db_session.refresh(row)
    assert row.budget_status == "limit_reached"
    assert virtual_key_id not in stub_litellm.enabled_keys
