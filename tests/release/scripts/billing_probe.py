"""Billing DB seam for T3-BILL-1 / T3-BILL-2 (specs/developing/testing/scenarios.md).

Same in-process-against-the-real-DB seam as ``prov1_fallback.py``: a scenario's
metering and grant assertions read the real billing ledger tables the product
writes (``usage_segment``, ``agent_llm_usage_event``, ``billing_grant``,
``billing_grant_consumption``). It is intentionally read-only. Mutable billing
setup belongs to a disposable, correlation-owned fixture with teardown; this
probe must never drain a shared durable subject.

Why a DB seam as well as HTTP: owner-scoped billing APIs are the product path
that materializes subjects and exposes user-visible balances. This probe reads
the underlying ledger afterward so qualification can reconcile exact segments,
events, grants, and consumptions that the summary envelope intentionally omits.

Usage:
  uv run python billing_probe.py meter-records <user-email> [--since-seconds N]

Prints one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402
from proliferate.db.models.billing import (  # noqa: E402
    BillingGrant,
    BillingGrantConsumption,
    BillingSubject,
    UsageSegment,
)
from proliferate.db.models.cloud.agent_gateway import AgentLlmUsageEvent  # noqa: E402


async def _subjects_for_user(
    db: AsyncSession,
    user_id: UUID,
    organization_id: UUID | None,
) -> dict[str, str]:
    """Resolve personal plus one explicitly selected organization subject.

    Since #1047, compute AND LLM both bill the *org* subject where the user has
    a current membership (org Stripe customer + org grant pool), and personal
    only for an org-less user — the paying subject is resolved from the same
    membership lookup that stamps ``usage_segment.organization_id`` (#1028), so
    the two never disagree. Returning both subjects lets the scenario assert an
    org-member segment invoices the org subject, not personal.
    """
    subjects: dict[str, str] = {}
    personal = (
        await db.execute(
            select(BillingSubject).where(
                BillingSubject.kind == "personal",
                BillingSubject.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if personal is not None:
        subjects[personal.kind] = str(personal.id)
    if organization_id is not None:
        organization = (
            await db.execute(
                select(BillingSubject).where(
                    BillingSubject.kind == "organization",
                    BillingSubject.organization_id == organization_id,
                )
            )
        ).scalar_one_or_none()
        if organization is not None:
            subjects[organization.kind] = str(organization.id)
    return subjects


async def meter_records(
    email: str,
    since_seconds: int,
    organization_id: UUID | None,
) -> dict:
    since = datetime.now(UTC) - timedelta(seconds=since_seconds)
    async with async_session_factory() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if user is None:
            return {"error": f"no user found for email {email!r}"}

        subjects = await _subjects_for_user(db, user.id, organization_id)
        subject_ids = list(subjects.values())

        segments = (
            await db.execute(
                select(UsageSegment).where(
                    UsageSegment.user_id == user.id,
                    UsageSegment.started_at >= since,
                )
            )
        ).scalars().all()

        llm_events = (
            await db.execute(
                select(AgentLlmUsageEvent).where(
                    AgentLlmUsageEvent.user_id == user.id,
                    AgentLlmUsageEvent.occurred_at >= since,
                )
            )
        ).scalars().all()

        grants = (
            await db.execute(
                select(BillingGrant).where(BillingGrant.billing_subject_id.in_(subject_ids))
            )
        ).scalars().all() if subject_ids else []

        consumption = (
            await db.execute(
                select(BillingGrantConsumption).where(
                    BillingGrantConsumption.billing_subject_id.in_(subject_ids),
                    BillingGrantConsumption.accounted_from >= since,
                )
            )
        ).scalars().all() if subject_ids else []

        return {
            "userId": str(user.id),
            "subjects": subjects,
            # usage_segment carries organization_id since #1028; since #1047 the
            # segment's billing_subject_id is the ORG subject for an org member
            # (personal only when org-less). Surfaced so the scenario asserts an
            # org segment invoices the org subject (per-segment organizationId
            # below).
            "usageSegmentHasOrgColumn": hasattr(UsageSegment, "organization_id"),
            "usageSegments": [
                {
                    "id": str(s.id),
                    "billingSubjectId": str(s.billing_subject_id),
                    "organizationId": str(s.organization_id) if s.organization_id else None,
                    "sandboxId": str(s.sandbox_id),
                    "startedAt": s.started_at.isoformat() if s.started_at else None,
                    "endedAt": s.ended_at.isoformat() if s.ended_at else None,
                    "openedBy": s.opened_by,
                    "closedBy": s.closed_by,
                    "isBillable": s.is_billable,
                }
                for s in segments
            ],
            "llmUsageEvents": [
                {
                    "id": str(e.id),
                    "billingSubjectId": (
                        str(e.billing_subject_id) if e.billing_subject_id else None
                    ),
                    "organizationId": str(e.organization_id) if e.organization_id else None,
                    "virtualKeyId": e.virtual_key_id,
                    "model": e.model,
                    "totalTokens": e.total_tokens,
                    "costUsd": e.cost_usd,
                    "sessionId": e.session_id,
                }
                for e in llm_events
            ],
            "grants": [
                {
                    "id": str(g.id),
                    "billingSubjectId": str(g.billing_subject_id),
                    "grantType": g.grant_type,
                    "hoursGranted": g.hours_granted,
                    "remainingSeconds": g.remaining_seconds,
                }
                for g in grants
            ],
            "grantConsumptions": [
                {
                    "billingSubjectId": str(c.billing_subject_id),
                    "usageSegmentId": str(c.usage_segment_id),
                    "seconds": c.seconds,
                }
                for c in consumption
            ],
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["meter-records"])
    parser.add_argument("email")
    parser.add_argument("--since-seconds", type=int, default=3600)
    parser.add_argument("--organization-id", type=UUID)
    args = parser.parse_args()
    out = asyncio.run(
        meter_records(args.email, args.since_seconds, args.organization_id)
    )
    print(json.dumps(out))
