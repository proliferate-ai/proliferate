"""Shared stubs + helpers for the agent-gateway top-up integration tests.

Kept in a plain (non-``test_``) module so both top-up test files can reuse the
LiteLLM/Stripe stubs and subject-builders without duplicating them or blowing
the per-file line-count cap. Fixtures live in ``conftest.py``.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import AuthIdentity, User
from proliferate.db.models.organizations import Organization
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    set_billing_subject_overage_enabled,
)
from proliferate.integrations.litellm import LiteLLMIntegrationError, LiteLLMVirtualKey
from proliferate.server.cloud.agent_gateway import enrollment as enrollment_service
from proliferate.server.cloud.agent_gateway import topups as topups_service


async def create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"topup-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    subject = f"gh-{uuid.uuid4().hex[:12]}"
    db_session.add(
        AuthIdentity(
            user_id=user.id,
            provider="github",
            provider_subject=subject,
            email=f"{subject}@example.com",
            email_verified=True,
        )
    )
    await db_session.flush()
    return user.id


async def create_org(db_session: AsyncSession) -> uuid.UUID:
    organization = Organization(name=f"Topup Org {uuid.uuid4().hex[:6]}")
    db_session.add(organization)
    await db_session.flush()
    return organization.id


async def spend(
    db_session: AsyncSession,
    *,
    billing_subject_id: uuid.UUID,
    cost_usd: float,
) -> None:
    await store.insert_usage_event_once(
        db_session,
        litellm_request_id=f"req-{uuid.uuid4().hex[:12]}",
        occurred_at=datetime(2026, 7, 1, 12, 0, tzinfo=UTC),
        virtual_key_id=None,
        litellm_team_id=None,
        user_id=None,
        organization_id=None,
        billing_subject_id=billing_subject_id,
        model="claude-sonnet-4-5",
        prompt_tokens=100,
        completion_tokens=20,
        total_tokens=120,
        cost_usd=cost_usd,
        status="imported",
        workspace_id=None,
        session_id=None,
        raw_metadata_json=None,
    )


async def overage_org_subject(
    db_session: AsyncSession,
    *,
    stripe_customer_id: str | None = "cus_topup",
) -> tuple[uuid.UUID, uuid.UUID]:
    """An overage-enabled org billing subject; returns (org_id, subject_id)."""
    org_id = await create_org(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    await set_billing_subject_overage_enabled(
        db_session,
        billing_subject_id=subject.id,
        overage_enabled=True,
    )
    if stripe_customer_id is not None:
        subject.stripe_customer_id = f"{stripe_customer_id}-{uuid.uuid4().hex[:6]}"
        await db_session.flush()
    return org_id, subject.id


class StubLiteLLM:
    """Stubs the admin surfaces the enrollment + top-up services call."""

    def __init__(self) -> None:
        self.teams: dict[str, str] = {}
        self.users: set[str] = set()
        self.minted: list[dict[str, Any]] = []
        self.enabled_keys: list[str] = []
        self.team_budgets: list[tuple[str, float | None]] = []
        self.key_budgets: list[tuple[str, float | None]] = []
        self.rotated: list[str] = []
        self.fail_unblock = False
        self.token_counter = 0

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        for target in (enrollment_service.litellm, topups_service.litellm):
            monkeypatch.setattr(target, "ensure_team", self.ensure_team, raising=False)
            monkeypatch.setattr(target, "ensure_user", self.ensure_user, raising=False)
            monkeypatch.setattr(target, "mint_virtual_key", self.mint_virtual_key, raising=False)
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
        metadata: dict[str, Any] | None = None,
    ) -> LiteLLMVirtualKey:
        self.token_counter += 1
        self.minted.append(
            {
                "alias": alias,
                "team_id": team_id,
                "max_budget": max_budget,
                "metadata": metadata or {},
            }
        )
        return LiteLLMVirtualKey(
            key=f"sk-litellm-{self.token_counter}",
            token_id=f"token-{self.token_counter}",
            key_alias=alias,
            user_id=user_id,
            team_id=team_id,
            max_budget=max_budget,
        )

    async def enable_virtual_key(self, *, key_or_token_id: str) -> None:
        if self.fail_unblock:
            raise LiteLLMIntegrationError("litellm_request_failed", "unblock unsupported")
        self.enabled_keys.append(key_or_token_id)

    async def rotate_virtual_key(
        self,
        *,
        key_or_token_id: str,
        user_id: str,
        team_id: str | None = None,
        alias: str | None = None,
        max_budget: float | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> LiteLLMVirtualKey:
        self.rotated.append(key_or_token_id)
        return await self.mint_virtual_key(
            user_id=user_id,
            team_id=team_id,
            alias=alias,
            max_budget=max_budget,
            metadata=metadata,
        )

    async def update_team_budget(self, *, team_id: str, max_budget: float | None) -> None:
        self.team_budgets.append((team_id, max_budget))

    async def set_key_budget(self, *, key_or_token_id: str, max_budget: float | None) -> None:
        self.key_budgets.append((key_or_token_id, max_budget))


class StubStripe:
    """Stubs the invoice/charge trio the top-up worker drives."""

    def __init__(self) -> None:
        self.invoices: list[dict[str, Any]] = []
        self.invoice_items: list[dict[str, Any]] = []
        self.finalized: list[str] = []
        self.idempotency_keys: list[str] = []
        self.counter = 0

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        target = topups_service.stripe_billing
        monkeypatch.setattr(target, "create_invoice", self.create_invoice, raising=False)
        monkeypatch.setattr(target, "create_invoice_item", self.create_invoice_item, raising=False)
        monkeypatch.setattr(target, "finalize_invoice", self.finalize_invoice, raising=False)

    async def create_invoice(
        self,
        *,
        stripe_customer_id: str,
        billing_subject_id: str,
        purpose: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self.idempotency_keys.append(idempotency_key)
        # Stripe idempotency: the same key replays the same invoice.
        for invoice in self.invoices:
            if invoice["idempotency_key"] == idempotency_key:
                return invoice
        self.counter += 1
        invoice = {
            "id": f"in_{self.counter:04d}",
            "customer": stripe_customer_id,
            "metadata": {"billing_subject_id": billing_subject_id, "purpose": purpose},
            "idempotency_key": idempotency_key,
        }
        self.invoices.append(invoice)
        return invoice

    async def create_invoice_item(
        self,
        *,
        stripe_customer_id: str,
        invoice_id: str,
        price_id: str,
        billing_subject_id: str,
        purpose: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        item = {"invoice": invoice_id, "price": price_id}
        self.invoice_items.append(item)
        return item

    async def finalize_invoice(
        self,
        *,
        invoice_id: str,
        idempotency_key: str,
    ) -> dict[str, Any]:
        self.finalized.append(invoice_id)
        return {"id": invoice_id, "status": "open"}
