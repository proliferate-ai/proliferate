"""Managed-LLM hard-cap regressions (real Postgres, stubbed vendors)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.agent_gateway import LlmCreditGrant
from proliferate.db.store import agent_gateway as store
from proliferate.server.cloud.agent_gateway import usage_import as usage_import_service
from proliferate.server.cloud.agent_gateway.enrollment import ensure_org_enrollment
from proliferate.server.cloud.agent_gateway.topups import run_llm_topups
from tests.integration.agent_gateway_topups_shared import StubLiteLLM, StubStripe
from tests.integration.agent_gateway_topups_shared import create_user as _create_user
from tests.integration.agent_gateway_topups_shared import (
    overage_org_subject as _overage_org_subject,
)
from tests.integration.agent_gateway_topups_shared import spend as _spend


async def _llm_grants(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> tuple[LlmCreditGrant, ...]:
    rows = await db.execute(
        select(LlmCreditGrant)
        .where(LlmCreditGrant.billing_subject_id == billing_subject_id)
        .order_by(LlmCreditGrant.created_at, LlmCreditGrant.id)
    )
    return tuple(rows.scalars().all())


@pytest.mark.asyncio
async def test_compute_overage_never_uncaps_managed_llm_credit(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    topup_settings: None,
) -> None:
    """The compute-overage switch must not become an LLM-overage switch."""
    org_id, subject_id = await _overage_org_subject(db_session)
    member_id = await _create_user(db_session)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject_id,
        source="admin",
        amount_usd=Decimal("25"),
    )

    enrollment = await ensure_org_enrollment(db_session, org_id, member_id)

    assert enrollment.sync_status == "synced"
    assert stub_litellm.minted[-1]["max_budget"] == 25.0


@pytest.mark.asyncio
async def test_legacy_topup_config_has_zero_billing_or_key_side_effects(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    stub_stripe: StubStripe,
    topup_settings: None,
) -> None:
    """Even fully populated legacy settings cannot fund or re-enable a key."""
    org_id, subject_id = await _overage_org_subject(db_session)
    member_id = await _create_user(db_session)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject_id,
        source="admin",
        amount_usd=Decimal("1"),
    )
    enrollment = await ensure_org_enrollment(db_session, org_id, member_id)
    assert enrollment.virtual_key_id is not None
    await _spend(db_session, billing_subject_id=subject_id, cost_usd=2.0)
    await store.set_enrollment_budget_status(
        db_session,
        enrollment_id=enrollment.id,
        budget_status="exhausted",
    )
    grants_before = await _llm_grants(db_session, subject_id)

    result = await run_llm_topups(db_session)

    grants_after = await _llm_grants(db_session, subject_id)
    assert result.scanned == result.eligible == result.topped_up == result.skipped == 0
    assert [grant.id for grant in grants_after] == [grant.id for grant in grants_before]
    assert all(grant.source != "topup" for grant in grants_after)
    assert stub_stripe.invoices == []
    assert stub_stripe.invoice_items == []
    assert stub_stripe.finalized == []
    assert stub_litellm.enabled_keys == []
    assert stub_litellm.rotated == []
    assert stub_litellm.team_budgets == []
    assert stub_litellm.key_budgets == []
    refreshed = await store.get_enrollment_for_organization(
        db_session,
        organization_id=org_id,
        user_id=member_id,
    )
    assert refreshed is not None
    assert refreshed.budget_status == "exhausted"


@pytest.mark.asyncio
async def test_legacy_topup_source_is_rejected_before_insert(
    db_session: AsyncSession,
    topup_settings: None,
) -> None:
    _org_id, subject_id = await _overage_org_subject(db_session)
    grants_before = await _llm_grants(db_session, subject_id)

    with pytest.raises(ValueError, match="Unsupported LLM credit grant source"):
        await store.create_llm_credit_grant(
            db_session,
            billing_subject_id=subject_id,
            source="topup",
            amount_usd=Decimal("10"),
            source_ref="legacy-topup-must-not-land",
        )

    assert await _llm_grants(db_session, subject_id) == grants_before


@pytest.mark.asyncio
async def test_exhaustion_enforces_with_compute_overage_and_legacy_config(
    db_session: AsyncSession,
    stub_litellm: StubLiteLLM,
    topup_settings: None,
) -> None:
    org_id, subject_id = await _overage_org_subject(db_session)
    member_id = await _create_user(db_session)
    await store.create_llm_credit_grant(
        db_session,
        billing_subject_id=subject_id,
        source="admin",
        amount_usd=Decimal("1"),
    )
    enrollment = await ensure_org_enrollment(db_session, org_id, member_id)
    await _spend(db_session, billing_subject_id=subject_id, cost_usd=2.0)

    enforced = await usage_import_service._enforce_subject_exhaustion(
        db_session,
        subject_id,
        [enrollment],
        now=datetime(2026, 7, 1, 12, 30, tzinfo=UTC),
    )

    assert enforced is True
    assert stub_litellm.disabled_keys == [enrollment.virtual_key_id]
    refreshed = await store.get_enrollment_for_organization(
        db_session,
        organization_id=org_id,
        user_id=member_id,
    )
    assert refreshed is not None
    assert refreshed.budget_status == "exhausted"
