"""Real-Postgres invariants for workflow invocation/delivery persistence.

These guarantees live in the database — the idempotency unique constraint,
caller-owned transaction atomicity, canonical numeric custody, and the
monotonic delivery CAS family — so they are proved here against real
Postgres, not SQLite or mocks. The adversarial custody fences (payload,
acceptance, runtime loss, cancellation convergence) have their own suite in
``test_workflow_delivery_custody.py``.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.db.models.background import BackgroundOutboxTask
from proliferate.db.models.workflows import WorkflowInvocation
from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store import workflow_invocations as store
from proliferate.utils.canonical_json import canonical_json, sha256_hex
from tests.unit.workflow_delivery_helpers import (
    DEFAULT_EPOCH,
    DEFAULT_TARGET,
    accept_delivery,
    handoff_and_fix,
    insert_kwargs,
    project_observation,
    run_object,
    seed_invocation_with_delivery,
    seed_user,
)

pytestmark = pytest.mark.asyncio


class TestIdempotencyInsert:
    async def test_concurrent_same_key_inserts_have_one_winner(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

        async def writer() -> bool:
            async with session_factory() as session:
                inserted = await store.insert_workflow_invocation(
                    session, **insert_kwargs(user_id=user_id)
                )
                await session.commit()
                return inserted is not None

        outcomes = await asyncio.gather(writer(), writer())
        assert sorted(outcomes) == [False, True]

        count = await db_session.scalar(select(func.count()).select_from(WorkflowInvocation))
        assert count == 1

    async def test_loser_transaction_survives_conflict_and_can_read_winner(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            first = await store.insert_workflow_invocation(
                session, **insert_kwargs(user_id=user_id)
            )
            assert first is not None
            await session.commit()
        async with session_factory() as session:
            second = await store.insert_workflow_invocation(
                session, **insert_kwargs(user_id=user_id, request_hash="c" * 64)
            )
            assert second is None
            # The transaction is not aborted: the loser reloads the winner
            # in the same session to classify replay versus conflict.
            winner = await store.get_workflow_invocation_by_idempotency_key(
                session, user_id=user_id, idempotency_key="key-1"
            )
            assert winner is not None
            assert winner.request_hash == "a" * 64

    async def test_same_key_different_user_is_not_a_conflict(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        first_user = await seed_user(db_session)
        second_user = await seed_user(db_session)
        for user_id in (first_user, second_user):
            inserted = await store.insert_workflow_invocation(
                db_session, **insert_kwargs(user_id=user_id)
            )
            assert inserted is not None
        await db_session.commit()


class TestCanonicalNumericCustody:
    """Digest-covered documents survive Postgres byte-exactly (finding A).

    JSONB would normalize ``1e21`` to ``1000000000000000000000`` and reload
    it as a Python int beyond the exact-integer guard, breaking replay and
    digest recomputation. Canonical text custody must round-trip exponent
    forms and integral doubles exactly.
    """

    ARGUMENTS = {"exp": 1e21, "integral": 9007199254740994.0, "plain": 7}

    async def test_exponent_form_values_roundtrip_and_redigest(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        kwargs = insert_kwargs(user_id=user_id)
        kwargs["arguments_json"] = dict(self.ARGUMENTS)
        kwargs["resolved_bundle_json"] = {"contractVersion": 1, "arguments": dict(self.ARGUMENTS)}
        inserted = await store.insert_workflow_invocation(db_session, **kwargs)
        assert inserted is not None
        await db_session.commit()

        raw = await db_session.scalar(
            text("SELECT arguments_json FROM workflow_invocation WHERE id = :id"),
            {"id": inserted.id},
        )
        assert raw == '{"exp":1e+21,"integral":9007199254740994,"plain":7}'

        reloaded = await store.get_workflow_invocation(
            db_session, user_id=user_id, invocation_id=inserted.id
        )
        assert reloaded is not None
        # Recanonicalizing the reloaded snapshot reproduces the exact stored
        # bytes — the digest recomputes identically after a PG round trip.
        assert canonical_json(reloaded.arguments_json) == raw
        assert canonical_json(reloaded.resolved_bundle_json) == canonical_json(
            kwargs["resolved_bundle_json"]
        )

    async def test_runtime_payload_with_exponent_values_redigests(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        run = run_object(invocation_id)
        run["arguments"] = dict(self.ARGUMENTS)
        fixed = await handoff_and_fix(db_session, invocation_id, run_json=run)
        assert fixed.runtime_payload_digest is not None

        reloaded = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert reloaded is not None
        assert reloaded.runtime_payload_json is not None
        assert sha256_hex(reloaded.runtime_payload_json) == reloaded.runtime_payload_digest


class TestTransactionAtomicity:
    async def test_invocation_delivery_and_outbox_commit_together(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        from proliferate.db.store.background_outbox import enqueue_outbox_task

        user_id = await seed_user(db_session)
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            inserted = await store.insert_workflow_invocation(
                session, **insert_kwargs(user_id=user_id)
            )
            assert inserted is not None
            await delivery_store.insert_workflow_delivery(session, invocation_id=inserted.id)
            await enqueue_outbox_task(
                session,
                task_name="workflows.deliver_managed_run",
                queue="default",
                kwargs_json={"invocation_id": str(inserted.id)},
                idempotency_key=f"workflows.deliver_managed_run:{inserted.id}",
            )
            await session.commit()

        delivery = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=inserted.id
        )
        assert delivery is not None
        assert delivery.status == "queued"
        outbox_count = await db_session.scalar(
            select(func.count())
            .select_from(BackgroundOutboxTask)
            .where(BackgroundOutboxTask.task_name == "workflows.deliver_managed_run")
        )
        assert outbox_count == 1

    async def test_rollback_persists_none_of_the_three_rows(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        from proliferate.db.store.background_outbox import enqueue_outbox_task

        user_id = await seed_user(db_session)
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            inserted = await store.insert_workflow_invocation(
                session, **insert_kwargs(user_id=user_id)
            )
            assert inserted is not None
            await delivery_store.insert_workflow_delivery(session, invocation_id=inserted.id)
            await enqueue_outbox_task(
                session,
                task_name="workflows.deliver_managed_run",
                queue="default",
                kwargs_json={"invocation_id": str(inserted.id)},
                idempotency_key=f"workflows.deliver_managed_run:{inserted.id}",
            )
            await session.rollback()

        assert (
            await store.get_workflow_invocation_by_idempotency_key(
                db_session, user_id=user_id, idempotency_key="key-1"
            )
            is None
        )
        outbox_count = await db_session.scalar(
            select(func.count())
            .select_from(BackgroundOutboxTask)
            .where(BackgroundOutboxTask.task_name == "workflows.deliver_managed_run")
        )
        assert outbox_count == 0

    async def test_cancel_marker_and_convergence_outbox_roll_back_together(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        from proliferate.db.store.background_outbox import enqueue_outbox_task

        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        await db_session.commit()

        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            cancelled = await delivery_store.request_delivery_cancel(
                session, invocation_id=invocation_id
            )
            assert cancelled is not None and cancelled.cancel_requested_at is not None
            await enqueue_outbox_task(
                session,
                task_name="workflows.cancel_managed_run",
                queue="default",
                kwargs_json={"invocation_id": str(invocation_id)},
                idempotency_key=f"workflows.cancel_managed_run:{invocation_id}",
            )
            await session.rollback()

        delivery = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert delivery is not None
        assert delivery.cancel_requested_at is None
        outbox_count = await db_session.scalar(
            select(func.count())
            .select_from(BackgroundOutboxTask)
            .where(BackgroundOutboxTask.task_name == "workflows.cancel_managed_run")
        )
        assert outbox_count == 0


class TestDeliveryTransitions:
    async def test_handoff_fix_accept_sets_monotonic_evidence(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)

        first = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert first is not None
        assert first.status == "delivering"
        assert first.attempt_count == 1
        assert first.handoff_started_at is not None

        second = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert second is not None
        assert second.attempt_count == 2
        assert second.handoff_started_at == first.handoff_started_at
        assert second.cloud_sandbox_id == "sbx-1"

        fixed = await delivery_store.fix_runtime_payload(
            db_session,
            invocation_id=invocation_id,
            run_json=run_object(invocation_id),
            anyharness_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_TARGET,
        )
        assert fixed is not None and fixed.runtime_payload_digest is not None

        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None
        assert accepted.status == "accepted"
        assert accepted.anyharness_run_id == str(invocation_id)

        # Acceptance is final for the delivery: a retrying handler must stop.
        assert (
            await delivery_store.mark_delivery_handoff_started(
                db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
            )
            is None
        )

    async def test_late_failure_cannot_overwrite_accepted(self, db_session: AsyncSession) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None

        assert accepted.runtime_payload_digest is not None
        rejected = await delivery_store.record_delivery_failed_after_handoff(
            db_session,
            invocation_id=invocation_id,
            error_code="workflow_run_delivery_conflict",
            error_message="late",
            expected_runtime_payload_digest=accepted.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_TARGET,
        )
        assert rejected is None
        delivery = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert delivery is not None
        assert delivery.status == "accepted"
        assert delivery.error_code is None

    async def test_failure_cannot_overwrite_cancellation_pending(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        cancelled = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert cancelled is not None
        assert cancelled.status == "delivering"
        assert cancelled.cancel_requested_at is not None

        assert (
            await delivery_store.record_delivery_failed_after_handoff(
                db_session,
                invocation_id=invocation_id,
                error_code="x",
                error_message="x",
                expected_runtime_payload_digest=None,
                expected_data_epoch=None,
                expected_target=DEFAULT_TARGET,
            )
            is None
        )

    async def test_cancel_of_unoffered_queued_row_is_terminal(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        delivery = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert delivery is not None
        assert delivery.status == "cancelled"
        assert delivery.finished_at is not None

    async def test_cancel_marker_is_first_write_wins(self, db_session: AsyncSession) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        first = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert first is not None
        second = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert second is not None
        assert second.cancel_requested_at == first.cancel_requested_at

    async def test_cancel_marker_is_not_written_on_terminal_rows(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        failed = await delivery_store.record_delivery_failed_before_handoff(
            db_session,
            invocation_id=invocation_id,
            error_code="workflow_target_unavailable",
            error_message="deterministic",
        )
        assert failed is not None
        after = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert after is not None
        assert after.status == "failed"
        assert after.cancel_requested_at is None

    async def test_acceptance_after_cancel_keeps_pending_marker(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        await delivery_store.request_delivery_cancel(db_session, invocation_id=invocation_id)
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None
        assert accepted.status == "accepted"
        assert accepted.cancel_requested_at is not None

    async def test_runtime_projection_stores_only_greater_revisions(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        assert await accept_delivery(db_session, invocation_id) is not None
        observed_at = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)

        applied = await project_observation(
            db_session,
            invocation_id,
            revision=5,
            observation={"status": "running"},
            observed_at=observed_at,
        )
        assert applied is not None
        assert applied.runtime_revision == 5

        for revision, snapshot in ((5, "stale"), (4, "older")):
            stale = await project_observation(
                db_session,
                invocation_id,
                revision=revision,
                observation={"status": snapshot},
                observed_at=observed_at,
            )
            assert stale is None

        delivery = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert delivery is not None
        assert delivery.runtime_revision == 5
        assert delivery.runtime_observation_json == {"status": "running"}

    async def test_concurrent_projection_revisions_settle_at_the_greatest(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        fixed = await handoff_and_fix(db_session, invocation_id)
        assert fixed.runtime_payload_digest is not None
        assert await accept_delivery(db_session, invocation_id) is not None
        await db_session.commit()
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        observed_at = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)

        async def project(revision: int) -> None:
            async with session_factory() as session:
                await project_observation(
                    session,
                    invocation_id,
                    revision=revision,
                    observation={"revision": revision},
                    observed_at=observed_at,
                    expected_runtime_payload_digest=fixed.runtime_payload_digest,
                )
                await session.commit()

        await asyncio.gather(project(6), project(5), project(7))
        delivery = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert delivery is not None
        assert delivery.runtime_revision == 7
        assert delivery.runtime_observation_json == {"revision": 7}
