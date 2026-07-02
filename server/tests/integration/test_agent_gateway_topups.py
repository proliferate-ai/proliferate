"""Top-up + limits integration tests (real Postgres, stubbed Stripe + LiteLLM).

Stubs and subject-builders live in ``agent_gateway_topups_shared`` and the
fixtures in ``conftest`` so this module and ``test_agent_gateway_topup_fixes``
stay under the per-file line-count cap. Both are re-exported here (helpers
underscore-aliased, fixtures as-is) so the sibling fix-regression module can
import everything it needs from one place.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import ensure_organization_billing_subject
from proliferate.server.cloud.agent_gateway import usage_import as usage_import_service
from proliferate.server.cloud.agent_gateway.enrollment import (
    ensure_org_enrollment,
    ensure_user_enrollment,
)
from proliferate.server.cloud.agent_gateway.topups import (
    create_llm_topup_grant,
    run_llm_topups,
)
from tests.integration.agent_gateway_topups_shared import (
    StubLiteLLM,
    StubStripe,
)
from tests.integration.agent_gateway_topups_shared import create_org as _create_org
from tests.integration.agent_gateway_topups_shared import create_user as _create_user
from tests.integration.agent_gateway_topups_shared import (
    overage_org_subject as _overage_org_subject,
)
from tests.integration.agent_gateway_topups_shared import spend as _spend

# ``stub_litellm``, ``stub_stripe`` and ``topup_settings`` come from
# ``conftest.py`` via pytest's directory-level fixture discovery — importing
# them here would collide with the fixture parameter names (F811).


@pytest.mark.asyncio
async def test_overage_org_enrollment_is_uncapped(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    topup_settings: None,
) -> None:
    org_id, _subject_id = await _overage_org_subject(db_session)

    enrollment = await ensure_org_enrollment(db_session, org_id)

    assert enrollment.sync_status == "synced"
    # Overage-enabled: no LiteLLM budget forwarded (uncapped).
    assert stub_litellm.minted[-1]["max_budget"] is None


@pytest.mark.asyncio
async def test_hard_cap_org_gets_remaining_credit_as_budget(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    topup_settings: None,
) -> None:
    org_id = await _create_org(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source="admin",
        amount_usd=Decimal("25"),
    )

    enrollment = await ensure_org_enrollment(db_session, org_id)

    assert enrollment.sync_status == "synced"
    # Hard cap: the org team budget mirrors the remaining credit.
    assert stub_litellm.minted[-1]["max_budget"] == 25.0


@pytest.mark.asyncio
async def test_topup_charges_grants_and_reactivates(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    org_id, subject_id = await _overage_org_subject(db_session)
    enrollment = await ensure_org_enrollment(db_session, org_id)
    assert enrollment.virtual_key_id is not None

    # Drive the subject below the threshold and mark it exhausted (as the
    # importer would have before the overage exemption / with top-ups off).
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject_id,
        source="admin",
        amount_usd=Decimal("1"),
    )
    await _spend(db_session, billing_subject_id=subject_id, cost_usd=1.50)
    await store.set_enrollment_budget_status(
        db_session,
        enrollment_id=enrollment.id,
        budget_status="exhausted",
    )

    result = await run_llm_topups(db_session)

    assert result.eligible == 1
    assert result.topped_up == 1
    assert result.skipped == 0

    # Stripe: invoice + priced item + finalize.
    assert len(stub_stripe.invoices) == 1
    assert stub_stripe.invoice_items[0]["price"] == "price_llm_topup"
    assert stub_stripe.finalized == [stub_stripe.invoices[0]["id"]]

    # Ledger: one topup grant keyed to the invoice id; remaining is positive.
    balance = await store.get_remaining_credit_usd(db_session, subject_id)
    assert balance.granted_usd == Decimal("11")
    assert balance.remaining_usd == Decimal("9.50")

    # Reactivation: VK unblocked, budget_status ok. Overage orgs run uncapped,
    # so the team + key budget are explicitly cleared (None) to drop any cap.
    assert stub_litellm.enabled_keys == [enrollment.virtual_key_id]
    refreshed = await store.get_enrollment_for_organization(db_session, organization_id=org_id)
    assert refreshed is not None
    assert refreshed.budget_status == "ok"
    assert stub_litellm.team_budgets == [(enrollment.litellm_team_id, None)]
    assert stub_litellm.key_budgets == [(enrollment.virtual_key_id, None)]

    # Next tick: back above the threshold, nothing more is charged.
    again = await run_llm_topups(db_session)
    assert again.eligible == 0
    assert again.topped_up == 0
    assert len(stub_stripe.invoices) == 1


@pytest.mark.asyncio
async def test_topup_replay_is_idempotent_on_source_ref(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    _org_id, subject_id = await _overage_org_subject(db_session)

    first = await create_llm_topup_grant(
        db_session,
        billing_subject_id=subject_id,
        amount_usd=Decimal("10"),
        source_ref="llm_topup:in_0001",
    )
    second = await create_llm_topup_grant(
        db_session,
        billing_subject_id=subject_id,
        amount_usd=Decimal("10"),
        source_ref="llm_topup:in_0001",
    )

    assert first.id == second.id
    balance = await store.get_remaining_credit_usd(db_session, subject_id)
    assert balance.granted_usd == Decimal("10")  # not doubled

    # The top-up epoch reflects one grant, so a crash-replay of the same
    # window reuses the same Stripe idempotency key.
    assert await store.count_topup_grants(db_session, subject_id) == 1


@pytest.mark.asyncio
async def test_topup_skips_non_overage_and_healthy_subjects(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    # Hard-cap org below zero: never topped up.
    org_id = await _create_org(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    await ensure_org_enrollment(db_session, org_id)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source="admin",
        amount_usd=Decimal("1"),
    )
    await _spend(db_session, billing_subject_id=subject.id, cost_usd=5.0)

    # Overage org comfortably above the threshold: not topped up either.
    healthy_org_id, healthy_subject_id = await _overage_org_subject(db_session)
    await ensure_org_enrollment(db_session, healthy_org_id)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=healthy_subject_id,
        source="admin",
        amount_usd=Decimal("50"),
    )

    result = await run_llm_topups(db_session)

    assert result.eligible == 0
    assert result.topped_up == 0
    assert stub_stripe.invoices == []


@pytest.mark.asyncio
async def test_topup_without_stripe_customer_is_skipped(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    org_id, subject_id = await _overage_org_subject(db_session, stripe_customer_id=None)
    await ensure_org_enrollment(db_session, org_id)
    # A grant puts it on the ledger; the skip is purely the missing customer.
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject_id,
        source="admin",
        amount_usd=Decimal("1"),
    )
    await _spend(db_session, billing_subject_id=subject_id, cost_usd=3.0)

    result = await run_llm_topups(db_session)

    assert result.eligible == 1
    assert result.topped_up == 0
    assert result.skipped == 1
    assert stub_stripe.invoices == []


@pytest.mark.asyncio
async def test_reactivation_raises_hard_cap_budgets_for_user_subject(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    assert enrollment.virtual_key_id is not None
    await _spend(
        db_session,
        billing_subject_id=enrollment.billing_subject_id,
        cost_usd=6.0,
    )
    await store.set_enrollment_budget_status(
        db_session,
        enrollment_id=enrollment.id,
        budget_status="exhausted",
    )

    grant = await create_llm_topup_grant(
        db_session,
        billing_subject_id=enrollment.billing_subject_id,
        amount_usd=Decimal("10"),
        source_ref=f"llm_topup:in_user_{uuid.uuid4().hex[:6]}",
    )

    assert grant.source == "topup"
    # VK unblocked + budget_status ok.
    assert stub_litellm.enabled_keys == [enrollment.virtual_key_id]
    refreshed = await store.get_enrollment_for_user(db_session, user_id=user_id)
    assert refreshed is not None
    assert refreshed.budget_status == "ok"
    # Hard-cap subject: team + key budgets raised to the total granted
    # allowance (LiteLLM budgets compare against lifetime team spend).
    assert stub_litellm.team_budgets == [(enrollment.litellm_team_id, 15.0)]
    assert stub_litellm.key_budgets == [(enrollment.virtual_key_id, 15.0)]


@pytest.mark.asyncio
async def test_reactivation_falls_back_to_remint_when_unblock_fails(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "agent_gateway_free_credit_usd", "5")
    user_id = await _create_user(db_session)
    enrollment = await ensure_user_enrollment(db_session, user_id)
    old_key_id = enrollment.virtual_key_id
    assert old_key_id is not None
    await _spend(
        db_session,
        billing_subject_id=enrollment.billing_subject_id,
        cost_usd=6.0,
    )
    await store.set_enrollment_budget_status(
        db_session,
        enrollment_id=enrollment.id,
        budget_status="exhausted",
    )

    stub_litellm.fail_unblock = True
    await create_llm_topup_grant(
        db_session,
        billing_subject_id=enrollment.billing_subject_id,
        amount_usd=Decimal("10"),
        source_ref=f"llm_topup:in_remint_{uuid.uuid4().hex[:6]}",
    )

    # Unblock failed: the key was hard-replaced (delete + mint) and persisted.
    assert stub_litellm.rotated == [old_key_id]
    refreshed = await store.get_enrollment_for_user(db_session, user_id=user_id)
    assert refreshed is not None
    assert refreshed.budget_status == "ok"
    assert refreshed.virtual_key_id is not None
    assert refreshed.virtual_key_id != old_key_id


@pytest.mark.asyncio
async def test_importer_leaves_overage_subjects_to_the_topup_worker(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org_id, subject_id = await _overage_org_subject(db_session)
    enrollment = await ensure_org_enrollment(db_session, org_id)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject_id,
        source="admin",
        amount_usd=Decimal("1"),
    )
    await _spend(db_session, billing_subject_id=subject_id, cost_usd=2.0)

    disabled: list[str] = []

    async def record_disable(*, key_or_token_id: str) -> None:
        disabled.append(key_or_token_id)

    monkeypatch.setattr(
        usage_import_service.litellm, "disable_virtual_key", record_disable, raising=False
    )

    enforced = await usage_import_service._enforce_subject_exhaustion(
        db_session,
        subject_id,
        [enrollment],
        now=datetime(2026, 7, 1, 12, 30, tzinfo=UTC),
    )

    # Overage-enabled + top-ups configured: the importer does not disable the
    # key; the top-up worker refunds the ledger instead.
    assert enforced is False
    assert disabled == []
