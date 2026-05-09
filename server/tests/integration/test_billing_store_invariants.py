from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.billing import (
    bind_stripe_customer_to_billing_subject,
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)


@pytest.mark.asyncio
async def test_personal_and_organization_billing_subjects_are_unique(
    db_session: AsyncSession,
) -> None:
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()

    personal = await ensure_personal_billing_subject(db_session, user_id)
    same_personal = await ensure_personal_billing_subject(db_session, user_id)
    organization = await ensure_organization_billing_subject(db_session, organization_id)
    same_organization = await ensure_organization_billing_subject(db_session, organization_id)

    assert same_personal.id == personal.id
    assert same_personal.user_id == user_id
    assert same_personal.organization_id is None
    assert same_organization.id == organization.id
    assert same_organization.organization_id == organization_id
    assert same_organization.user_id is None


@pytest.mark.asyncio
async def test_stripe_customer_id_binds_to_only_one_billing_subject(
    db_session: AsyncSession,
) -> None:
    first = await ensure_personal_billing_subject(db_session, uuid.uuid4())
    second = await ensure_personal_billing_subject(db_session, uuid.uuid4())

    bound = await bind_stripe_customer_to_billing_subject(
        db_session,
        billing_subject_id=first.id,
        stripe_customer_id="cus_unique_subject",
    )
    assert bound.stripe_customer_id == "cus_unique_subject"

    with pytest.raises(IntegrityError):
        await bind_stripe_customer_to_billing_subject(
            db_session,
            billing_subject_id=second.id,
            stripe_customer_id="cus_unique_subject",
        )
