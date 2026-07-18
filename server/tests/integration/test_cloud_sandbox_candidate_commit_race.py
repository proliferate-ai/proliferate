"""Candidate-commit custody races against authoritative provider webhooks."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.billing import (
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
    USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
    USAGE_SEGMENT_OPENED_BY_PROVISION,
)
from proliferate.db.models.auth import User
from proliferate.db.models.billing import UsageSegment, WebhookEventReceipt
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.store import cloud_sandboxes as sandbox_store
from proliferate.db.store.billing_subjects import ensure_personal_billing_subject
from proliferate.db.store.cloud_sandbox_recovery import (
    adopt_ambiguous_cloud_sandbox_provider_sandbox,
)
from proliferate.server.billing.runtime_usage import open_cloud_sandbox_provider_usage
from proliferate.server.cloud.materialization.failures import (
    PROVIDER_SANDBOX_MISSING_RECEIPT,
    persist_materialization_failure,
)
from proliferate.server.cloud.webhooks import service as webhook_service

BASE_TIME = datetime(2026, 7, 17, 12, 0, tzinfo=UTC)
CANDIDATE_ID = "provider-ambiguous-candidate"


async def _seed_unbound_attempt(
    db: AsyncSession,
) -> tuple[UUID, UUID, int, datetime]:
    user = User(
        email=f"candidate-race-{uuid4().hex}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_verified=True,
    )
    db.add(user)
    await db.flush()
    await ensure_personal_billing_subject(db, user.id)
    sandbox = CloudSandbox(
        owner_user_id=user.id,
        sandbox_type="e2b",
        provider_sandbox_id=None,
        status="creating",
        provider_observed_at=BASE_TIME,
        created_at=BASE_TIME,
        updated_at=BASE_TIME,
    )
    db.add(sandbox)
    await db.flush()
    retried = await sandbox_store.begin_cloud_sandbox_materialization_retry(db, sandbox.id)
    assert retried is not None
    await db.commit()
    return sandbox.id, user.id, retried.materialization_attempt, retried.provider_observed_at


async def _commit_candidate_binding(
    db: AsyncSession,
    *,
    sandbox_id: UUID,
    user_id: UUID,
    attempt: int,
) -> tuple[datetime, UsageSegment]:
    candidate = await sandbox_store.record_cloud_sandbox_provider_sandbox(
        db,
        sandbox_id,
        e2b_sandbox_id=CANDIDATE_ID,
        e2b_template_ref="e2b-test",
        expected_materialization_attempt=attempt,
    )
    assert candidate is not None
    usage_started_at = candidate.provider_observed_at
    await open_cloud_sandbox_provider_usage(
        db,
        sandbox_id=sandbox_id,
        provider_sandbox_id=CANDIDATE_ID,
        user_id=user_id,
        started_at=usage_started_at,
        opened_by=USAGE_SEGMENT_OPENED_BY_PROVISION,
        event_id=f"candidate-binding:{sandbox_id}:{CANDIDATE_ID}",
    )
    await db.commit()
    segment = (
        await db.execute(
            select(UsageSegment).where(
                UsageSegment.sandbox_id == sandbox_id,
                UsageSegment.ended_at.is_(None),
            )
        )
    ).scalar_one()
    return candidate.provider_observed_at, segment


@pytest.mark.asyncio
async def test_ambiguous_candidate_adoption_requires_exact_unbound_creating_floor(
    db_session: AsyncSession,
) -> None:
    sandbox_id, _user_id, attempt, observation_floor = await _seed_unbound_attempt(db_session)

    adopted = await adopt_ambiguous_cloud_sandbox_provider_sandbox(
        db_session,
        sandbox_id,
        e2b_sandbox_id=CANDIDATE_ID,
        expected_materialization_attempt=attempt,
        expected_provider_observed_at=observation_floor,
    )
    assert adopted is True
    await db_session.commit()
    current = await sandbox_store.load_cloud_sandbox_by_id(
        db_session,
        sandbox_id,
        refresh=True,
    )
    assert current is not None
    assert current.e2b_sandbox_id == CANDIDATE_ID
    assert current.status == "creating"
    assert current.provider_observed_at >= observation_floor

    stale_replay = await adopt_ambiguous_cloud_sandbox_provider_sandbox(
        db_session,
        sandbox_id,
        e2b_sandbox_id="provider-stale-replay",
        expected_materialization_attempt=attempt,
        expected_provider_observed_at=observation_floor,
    )
    assert stale_replay is False


@pytest.mark.parametrize(
    ("event_type", "expected_status", "expected_provider_id", "expected_closed_by"),
    [
        (
            "sandbox.lifecycle.paused",
            "paused",
            CANDIDATE_ID,
            USAGE_SEGMENT_CLOSED_BY_WEBHOOK_PAUSED,
        ),
        (
            "sandbox.lifecycle.killed",
            "error",
            None,
            USAGE_SEGMENT_CLOSED_BY_WEBHOOK_KILLED,
        ),
    ],
    ids=["paused", "killed"],
)
@pytest.mark.asyncio
async def test_ambiguous_candidate_fallback_preserves_newer_provider_webhook(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    event_type: str,
    expected_status: str,
    expected_provider_id: str | None,
    expected_closed_by: str,
) -> None:
    sandbox_id, user_id, attempt, observation_floor = await _seed_unbound_attempt(db_session)
    candidate_observed_at, segment = await _commit_candidate_binding(
        db_session,
        sandbox_id=sandbox_id,
        user_id=user_id,
        attempt=attempt,
    )
    event_time = candidate_observed_at + timedelta(seconds=1)
    event_id = f"candidate-race-{event_type}"
    monkeypatch.setattr(webhook_service, "_verify_e2b_signature", lambda *_args: None)
    payload = json.dumps(
        {
            "id": event_id,
            "type": event_type,
            "sandboxId": CANDIDATE_ID,
            "timestamp": event_time.isoformat(),
            "eventData": {"sandbox_metadata": {"cloud_sandbox_id": str(sandbox_id)}},
        }
    ).encode()

    await webhook_service.handle_e2b_webhook(
        db_session,
        payload=payload,
        signature=None,
    )
    await db_session.commit()

    matched, matched_provider_id = await persist_materialization_failure(
        db_session,
        sandbox_id=sandbox_id,
        expected_provider_sandbox_ids=(CANDIDATE_ID, None),
        expected_materialization_attempt=attempt,
        error=RuntimeError("ambiguous candidate binding commit"),
        adopt_provider_if_unbound=(
            CANDIDATE_ID,
            user_id,
            candidate_observed_at,
            observation_floor,
        ),
    )

    assert matched is False
    assert matched_provider_id is None
    current = await sandbox_store.load_cloud_sandbox_by_id(
        db_session,
        sandbox_id,
        refresh=True,
    )
    assert current is not None
    await db_session.refresh(segment)
    receipt = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.provider == "e2b",
                WebhookEventReceipt.event_id == event_id,
            )
        )
    ).scalar_one()
    stale_adopt_receipt = (
        await db_session.execute(
            select(WebhookEventReceipt).where(
                WebhookEventReceipt.provider == "proliferate_usage",
                WebhookEventReceipt.event_id
                == f"usage:provider-candidate-adopt:{sandbox_id}:{CANDIDATE_ID}",
            )
        )
    ).scalar_one_or_none()
    open_segments = list(
        (
            await db_session.execute(
                select(UsageSegment).where(
                    UsageSegment.sandbox_id == sandbox_id,
                    UsageSegment.ended_at.is_(None),
                )
            )
        ).scalars()
    )
    assert current.status == expected_status
    assert current.e2b_sandbox_id == expected_provider_id
    assert current.provider_observed_at == event_time
    assert current.last_error == (
        PROVIDER_SANDBOX_MISSING_RECEIPT if expected_provider_id is None else None
    )
    assert segment.external_sandbox_id == CANDIDATE_ID
    assert segment.ended_at == event_time
    assert segment.closed_by == expected_closed_by
    assert open_segments == []
    assert receipt.external_sandbox_id == CANDIDATE_ID
    assert receipt.status == "processed"
    assert stale_adopt_receipt is None
