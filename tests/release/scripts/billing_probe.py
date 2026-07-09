"""Billing DB seam for T3-BILL-1 / T3-BILL-2 (specs/developing/testing/scenarios.md).

Same in-process-against-the-real-DB seam as ``prov1_fallback.py``: a scenario's
metering and grant assertions read the real billing ledger tables the product
writes (``usage_segment``, ``agent_llm_usage_event``, ``billing_grant``,
``billing_grant_consumption``), and its exhaustion *setup* (test-clock/grant
manipulation is explicitly allowed as setup by the contract; the enforcement
under test is still the real gate) drains grant seconds directly.

Why a DB seam and not HTTP: on this branch the running server exposes no
``/billing/usage/*`` or ``/billing/llm-balance`` HTTP endpoints (the consumption
UI/API arc is not in this build), and every ``/v1/billing/*`` route that does
exist is ``current_product_user``-gated, so a password-only durable user 403s
with ``github_link_required`` before any billing logic runs. Reading the ledger
tables directly is the only faithful way to assert the metering side today; the
scenario reports blocked for the parts that require producing *new* records
(a gateway test key for LLM events; a reachable cloud sandbox + public webhook
URL for compute segments).

Usage:
  uv run python billing_probe.py meter-records <user-email> [--since-seconds N]
  uv run python billing_probe.py drain-grants  <user-email>   # BILL-2 setup only

Prints one JSON object to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "server"))

from sqlalchemy import select, update  # noqa: E402

from proliferate.db.engine import async_session_factory  # noqa: E402
from proliferate.db.models.auth import User  # noqa: E402
from proliferate.db.models.billing import (  # noqa: E402
    BillingGrant,
    BillingGrantConsumption,
    BillingSubject,
    UsageSegment,
)
from proliferate.db.models.cloud.agent_gateway import AgentLlmUsageEvent  # noqa: E402


async def _subjects_for_user(db, user_id) -> dict[str, str]:
    """Resolve the user's personal + (best-effort) org billing subjects.

    Compute segments bill the *personal* subject and LLM events bill the *org*
    subject where enrolled — the known attribution split
    (scenarios.md#T3-BILL-1, findings 6/10). Returning both lets the scenario
    assert each side against the subject the product actually used.
    """
    rows = (
        await db.execute(select(BillingSubject).where(BillingSubject.user_id == user_id))
    ).scalars().all()
    subjects: dict[str, str] = {}
    for row in rows:
        subjects[row.kind] = str(row.id)
    return subjects


async def meter_records(email: str, since_seconds: int) -> dict:
    since = datetime.now(timezone.utc) - timedelta(seconds=since_seconds)
    async with async_session_factory() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if user is None:
            return {"error": f"no user found for email {email!r}"}

        subjects = await _subjects_for_user(db, user.id)
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
            # usage_segment carries organization_id since #1028 (merged) —
            # attribution/enforcement scope only, billing_subject_id on the
            # segment stays the owner's personal subject. Surfaced so the
            # scenario asserts the as-built personal-subject attribution.
            "usageSegmentHasOrgColumn": hasattr(UsageSegment, "organization_id"),
            "usageSegments": [
                {
                    "id": str(s.id),
                    "billingSubjectId": str(s.billing_subject_id),
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
                    "billingSubjectId": str(e.billing_subject_id) if e.billing_subject_id else None,
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


async def drain_grants(email: str) -> dict:
    """BILL-2 setup: zero every grant's remaining_seconds for the user's
    subjects, forcing compute exhaustion. Enforcement (the resume gate) is still
    the real deployed gate; this only sets the precondition, per the contract's
    "grant manipulation is allowed as setup" allowance.
    """
    async with async_session_factory() as db:
        user = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if user is None:
            return {"error": f"no user found for email {email!r}"}
        subjects = await _subjects_for_user(db, user.id)
        subject_ids = list(subjects.values())
        if not subject_ids:
            return {"error": "user has no billing subjects", "drained": 0}
        result = await db.execute(
            update(BillingGrant)
            .where(BillingGrant.billing_subject_id.in_(subject_ids))
            .values(remaining_seconds=0.0)
        )
        await db.commit()
        return {"drained": result.rowcount, "subjects": subjects}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["meter-records", "drain-grants"])
    parser.add_argument("email")
    parser.add_argument("--since-seconds", type=int, default=3600)
    args = parser.parse_args()
    if args.command == "meter-records":
        out = asyncio.run(meter_records(args.email, args.since_seconds))
    else:
        out = asyncio.run(drain_grants(args.email))
    print(json.dumps(out))
