"""Regression tests for PR 9 top-up review findings.

Shares the LiteLLM/Stripe stubs, fixtures, and helpers with
``test_agent_gateway_topups`` to keep each module under the line-count cap.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import agent_gateway as store
from proliferate.db.store.billing_subjects import (
    ensure_organization_billing_subject,
    set_billing_subject_overage_enabled,
)
from proliferate.server.cloud.agent_gateway import usage_import as usage_import_service
from proliferate.server.cloud.agent_gateway.enrollment import ensure_org_enrollment
from proliferate.server.cloud.agent_gateway.topups import (
    create_llm_topup_grant,
    run_llm_topups,
)
from tests.integration.test_agent_gateway_topups import (
    StubLiteLLM,
    StubStripe,
    _create_org,
    _create_user,
    _overage_org_subject,
    _spend,
)

# ``stub_litellm``, ``stub_stripe`` and ``topup_settings`` are supplied by
# ``conftest.py`` through pytest's directory-level fixture discovery.


@pytest.mark.asyncio
async def test_reactivation_uncaps_overage_subject_capped_at_enrollment(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    """Overage enabled *after* a hard-capped enrollment must clear the cap.

    The enrollment mints a key + team capped at the granted credit while the
    org is not yet overage-enabled. Turning on overage and landing a top-up
    must rewrite the LiteLLM team/key budget to uncapped (None) and re-enable
    the key — otherwise the subject is billed but stays blocked at the old cap.
    """
    org_id = await _create_org(db_session)
    member_id = await _create_user(db_session)
    subject = await ensure_organization_billing_subject(db_session, org_id)
    subject.stripe_customer_id = f"cus_uncap-{uuid.uuid4().hex[:6]}"
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject.id,
        source="admin",
        amount_usd=Decimal("5"),
    )
    await db_session.flush()

    enrollment = await ensure_org_enrollment(db_session, org_id, member_id)
    # Enrolled while NOT overage-enabled: minted with a hard cap of 5.
    assert stub_litellm.minted[-1]["max_budget"] == 5.0
    assert enrollment.virtual_key_id is not None

    # Spend past the cap and mark exhausted (as the importer would, non-overage).
    await _spend(db_session, billing_subject_id=subject.id, cost_usd=5.0)
    await store.set_enrollment_budget_status(
        db_session,
        enrollment_id=enrollment.id,
        budget_status="exhausted",
    )

    # Now flip on overage and land a top-up grant.
    await set_billing_subject_overage_enabled(
        db_session,
        billing_subject_id=subject.id,
        overage_enabled=True,
    )
    await create_llm_topup_grant(
        db_session,
        billing_subject_id=subject.id,
        amount_usd=Decimal("10"),
        source_ref=f"llm_topup:in_uncap_{uuid.uuid4().hex[:6]}",
    )

    # Cap removed (None) on both team and key, VK re-enabled, status back to ok.
    assert stub_litellm.enabled_keys == [enrollment.virtual_key_id]
    assert stub_litellm.team_budgets == [(enrollment.litellm_team_id, None)]
    assert stub_litellm.key_budgets == [(enrollment.virtual_key_id, None)]
    refreshed = await store.get_enrollment_for_organization(
        db_session,
        organization_id=org_id,
        user_id=member_id,
    )
    assert refreshed is not None
    assert refreshed.budget_status == "ok"


@pytest.mark.asyncio
async def test_topup_does_not_bill_zero_grant_historical_spend(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    """A subject with historical spend but no credit grant is never charged.

    Zero-grant subjects ride the LiteLLM default budget and are off the credit
    ledger; enabling overage must not retroactively bill that free spend.
    """
    org_id, subject_id = await _overage_org_subject(db_session)
    member_id = await _create_user(db_session)
    await ensure_org_enrollment(db_session, org_id, member_id)
    # Historical spend incurred for free under the default budget, no grant.
    await _spend(db_session, billing_subject_id=subject_id, cost_usd=50.0)

    result = await run_llm_topups(db_session)

    assert result.eligible == 0
    assert result.topped_up == 0
    assert stub_stripe.invoices == []


@pytest.mark.asyncio
async def test_importer_enforces_overage_when_topup_amount_invalid(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bad top-up amount must fail safe: the importer keeps enforcing.

    With a misconfigured amount the top-up worker cannot fund anyone, so the
    importer's overage exemption must switch off and the exhausted key gets
    disabled rather than silently left uncapped and unbilled.
    """
    monkeypatch.setattr(settings, "agent_gateway_topup_amount_usd", "0")
    org_id, subject_id = await _overage_org_subject(db_session)
    member_id = await _create_user(db_session)
    enrollment = await ensure_org_enrollment(db_session, org_id, member_id)
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

    assert enforced is True
    assert disabled == [enrollment.virtual_key_id]
