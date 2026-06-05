"""Billing snapshot state orchestration."""

from __future__ import annotations

from typing import Protocol
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.billing import BILLING_SUBJECT_KIND_PERSONAL
from proliferate.db.store.billing import (
    BillingSnapshotState,
)
from proliferate.db.store.billing import (
    get_billing_snapshot_state_for_subject as load_billing_snapshot_state_for_subject,
)
from proliferate.db.store.billing_subjects import (
    ensure_free_included_grant,
    ensure_free_trial_v2_grant,
    ensure_personal_billing_subject,
    get_billing_subject_by_id,
)


class BillingSubjectRecord(Protocol):
    id: UUID
    kind: str
    user_id: UUID | None


async def _ensure_snapshot_free_grant(db: AsyncSession, subject: BillingSubjectRecord) -> None:
    if subject.kind != BILLING_SUBJECT_KIND_PERSONAL or subject.user_id is None:
        return
    if settings.pro_billing_enabled:
        await ensure_free_trial_v2_grant(db, subject)
    else:
        await ensure_free_included_grant(db, subject.user_id)
    await db.flush()


async def load_snapshot_state_for_user(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshotState:
    subject = await ensure_personal_billing_subject(db, user_id)
    await _ensure_snapshot_free_grant(db, subject)
    return await load_billing_snapshot_state_for_subject(db, subject.id)


async def load_snapshot_state_for_subject(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshotState:
    subject = await get_billing_subject_by_id(db, billing_subject_id)
    if subject is None:
        raise RuntimeError("Billing subject not found.")
    await _ensure_snapshot_free_grant(db, subject)
    return await load_billing_snapshot_state_for_subject(db, billing_subject_id)
