"""Adversarial real-Postgres fences for workflow delivery loss and cancellation.

Runtime loss is proof-specific and one-shot (PR2 design §8.3): every proof
binds the exact fixed digest, data epoch, projection revision, run binding,
and typed target, a merely delivering same-epoch 404 is a re-PUT rather than
loss, and a lost row is never revived. A terminal AnyHarness observation
beats loss in either commit order. Cancellation is a durable first-write-wins
marker that never rewrites custody; only a provably unoffered queued row
converges locally (design §16). Payload, acceptance, and failure custody
lives in `test_workflow_delivery_custody`.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store import workflow_delivery_loss as loss_store
from proliferate.db.store.workflow_delivery_custody import (
    DesktopTarget,
    ManagedCloudTarget,
    WorkflowDeliverySnapshot,
)
from tests.unit.workflow_delivery_helpers import (
    DEFAULT_DESKTOP_TARGET,
    DEFAULT_EPOCH,
    DEFAULT_INSTALL,
    DEFAULT_TARGET,
    accept_delivery,
    fail_after_handoff,
    fix_delivery,
    handoff_and_fix,
    lost_proof_kwargs,
    project_observation,
    read_delivery,
    seed_delivery,
)

pytestmark = pytest.mark.asyncio

_OBSERVED_AT = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)
FOREIGN_RUN_ID = "20000000-0000-4000-8000-000000000009"

# One perturbed custody field per case; the CAS must reject the whole call.
LOSS_CUSTODY_MISMATCHES = [
    pytest.param("expected_runtime_payload_digest", "0" * 64, id="wrong-digest"),
    pytest.param("expected_data_epoch", "epoch-other", id="wrong-epoch"),
    pytest.param(
        "expected_target",
        ManagedCloudTarget(cloud_sandbox_id="sbx-other"),
        id="wrong-sandbox",
    ),
    pytest.param("expected_target", DEFAULT_DESKTOP_TARGET, id="wrong-target-kind"),
]


async def seed_accepted_delivery(
    db: AsyncSession, invocation_id: UUID
) -> WorkflowDeliverySnapshot:
    await handoff_and_fix(db, invocation_id)
    accepted = await accept_delivery(db, invocation_id)
    assert accepted is not None
    return accepted


class TestRuntimeLost:
    @pytest.mark.parametrize("observed", ["", DEFAULT_EPOCH])
    async def test_epoch_change_proof_requires_a_real_epoch_change(
        self, db_session: AsyncSession, observed: str
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        # Reporting the fixed epoch back (or none at all) is not an epoch
        # change: a same-epoch 404 of a delivering run means re-PUT.
        with pytest.raises(ValueError, match="epoch"):
            await loss_store.record_runtime_lost_epoch_changed(
                db_session,
                invocation_id=invocation_id,
                expected_status="delivering",
                observed_data_epoch=observed,
                **lost_proof_kwargs(fixed),
            )

    async def test_epoch_change_with_a_stale_expected_epoch_proves_nothing(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        assert fixed.runtime_payload_digest is not None
        stale = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="delivering",
            expected_runtime_revision=None,
            expected_runtime_payload_digest=fixed.runtime_payload_digest,
            expected_data_epoch="epoch-other",
            observed_data_epoch="epoch-2",
            expected_target=DEFAULT_TARGET,
        )
        assert stale is None
        lost = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="delivering",
            observed_data_epoch="epoch-2",
            **lost_proof_kwargs(fixed),
        )
        assert lost is not None
        assert lost.status == "delivering"
        assert lost.control_plane_runtime_outcome == "runtime_lost"
        assert lost.control_plane_runtime_outcome_reason == "epoch_changed"

    async def test_accepted_run_absent_is_never_a_proof_for_a_delivering_row(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        # AnyHarness never durably owned a merely delivering run, so its
        # same-epoch absence means the PUT never landed — retry, not loss.
        premature = await loss_store.record_runtime_lost_accepted_run_absent(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            **lost_proof_kwargs(fixed),
        )
        assert premature is None
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None
        lost = await loss_store.record_runtime_lost_accepted_run_absent(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            **lost_proof_kwargs(accepted),
        )
        assert lost is not None
        assert lost.status == "accepted"
        assert lost.control_plane_runtime_outcome_reason == "accepted_run_absent"

    async def test_accepted_run_absent_rejects_a_foreign_run(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        accepted = await seed_accepted_delivery(db_session, invocation_id)
        foreign = await loss_store.record_runtime_lost_accepted_run_absent(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=FOREIGN_RUN_ID,
            **lost_proof_kwargs(accepted),
        )
        assert foreign is None
        after = await read_delivery(db_session, invocation_id)
        assert after.control_plane_runtime_outcome is None

    async def test_sandbox_destroyed_binds_the_exact_managed_sandbox(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        assert fixed.runtime_payload_digest is not None
        wrong_sandbox = await loss_store.record_runtime_lost_sandbox_destroyed(
            db_session,
            invocation_id=invocation_id,
            expected_status="delivering",
            expected_runtime_revision=None,
            expected_runtime_payload_digest=fixed.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=ManagedCloudTarget(cloud_sandbox_id="sbx-other"),
        )
        assert wrong_sandbox is None
        lost = await loss_store.record_runtime_lost_sandbox_destroyed(
            db_session,
            invocation_id=invocation_id,
            expected_status="delivering",
            **lost_proof_kwargs(fixed),
        )
        assert lost is not None
        assert lost.control_plane_runtime_outcome_reason == "sandbox_destroyed"

    async def test_sandbox_destroyed_rejects_a_desktop_target_before_sql(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(
            db_session, target_kind="desktop", desktop_install_id=DEFAULT_INSTALL
        )
        fixed = await handoff_and_fix(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        with pytest.raises(ValueError, match="managed Cloud target"):
            await loss_store.record_runtime_lost_sandbox_destroyed(
                db_session,
                invocation_id=invocation_id,
                expected_status="delivering",
                **lost_proof_kwargs(fixed, target=DEFAULT_DESKTOP_TARGET),
            )
        # A same-transaction read proves the invalid typed target never issued
        # SQL and therefore did not poison the caller-owned transaction.
        after = await read_delivery(db_session, invocation_id)
        assert after.control_plane_runtime_outcome is None
        assert after.control_plane_runtime_outcome_reason is None

    async def test_loss_binds_the_projection_revision_the_prover_observed(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await seed_accepted_delivery(db_session, invocation_id)
        projected = await project_observation(
            db_session,
            invocation_id,
            revision=2,
            observation={"status": "running"},
            observed_at=_OBSERVED_AT,
        )
        assert projected is not None
        # A prover that never saw the projection holds a stale view.
        stale_kwargs = lost_proof_kwargs(projected)
        stale_kwargs["expected_runtime_revision"] = None
        stale = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            observed_data_epoch="epoch-2",
            **stale_kwargs,
        )
        assert stale is None
        lost = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            observed_data_epoch="epoch-2",
            **lost_proof_kwargs(projected),
        )
        assert lost is not None and lost.runtime_revision == 2

    @pytest.mark.parametrize(("field", "value"), LOSS_CUSTODY_MISMATCHES)
    async def test_loss_rejects_stale_or_foreign_custody(
        self, db_session: AsyncSession, field: str, value: object
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        accepted = await seed_accepted_delivery(db_session, invocation_id)
        kwargs = lost_proof_kwargs(accepted)
        kwargs[field] = value
        refused = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            observed_data_epoch="epoch-2",
            **kwargs,
        )
        assert refused is None
        after = await read_delivery(db_session, invocation_id)
        assert after.control_plane_runtime_outcome is None

    async def test_loss_is_one_shot(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        accepted = await seed_accepted_delivery(db_session, invocation_id)
        lost = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            observed_data_epoch="epoch-2",
            **lost_proof_kwargs(accepted),
        )
        assert lost is not None
        again = await loss_store.record_runtime_lost_accepted_run_absent(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            **lost_proof_kwargs(accepted),
        )
        assert again is None
        after = await read_delivery(db_session, invocation_id)
        assert after.control_plane_runtime_outcome_reason == "epoch_changed"

    async def test_a_lost_row_is_never_revived(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        lost = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="delivering",
            observed_data_epoch="epoch-2",
            **lost_proof_kwargs(fixed),
        )
        assert lost is not None

        rehandoff = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert rehandoff is None
        assert await accept_delivery(db_session, invocation_id) is None
        assert await fix_delivery(db_session, invocation_id) is None
        before = await delivery_store.record_delivery_failed_before_handoff(
            db_session, invocation_id=invocation_id, error_code="x", error_message="x"
        )
        assert before is None
        assert await fail_after_handoff(
            db_session, invocation_id, digest=fixed.runtime_payload_digest
        ) is None
        # A durable cancel intent may still be recorded on the lost row, but
        # it can never converge the delivery locally.
        marked = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert marked is not None and marked.cancel_requested_at is not None
        assert marked.status == "delivering"
        assert marked.control_plane_runtime_outcome == "runtime_lost"
        converged = await delivery_store.record_delivery_cancelled_converged(
            db_session, invocation_id=invocation_id
        )
        assert converged is None

    async def test_loss_first_freezes_later_projections(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await seed_accepted_delivery(db_session, invocation_id)
        projected = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": "running"},
            observed_at=_OBSERVED_AT,
        )
        assert projected is not None
        lost = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            observed_data_epoch="epoch-2",
            **lost_proof_kwargs(projected),
        )
        assert lost is not None
        late = await project_observation(
            db_session,
            invocation_id,
            revision=2,
            observation={"status": "running"},
            observed_at=_OBSERVED_AT,
        )
        assert late is None
        assert (await read_delivery(db_session, invocation_id)).runtime_revision == 1

    async def test_a_terminal_observation_blocks_every_loss_proof(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await seed_accepted_delivery(db_session, invocation_id)
        projected = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": "succeeded"},
            observed_at=_OBSERVED_AT,
        )
        assert projected is not None
        kwargs = lost_proof_kwargs(projected)
        epoch_changed = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            observed_data_epoch="epoch-2",
            **kwargs,
        )
        assert epoch_changed is None
        run_absent = await loss_store.record_runtime_lost_accepted_run_absent(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            **kwargs,
        )
        assert run_absent is None
        destroyed = await loss_store.record_runtime_lost_sandbox_destroyed(
            db_session,
            invocation_id=invocation_id,
            expected_status="accepted",
            **kwargs,
        )
        assert destroyed is None
        after = await read_delivery(db_session, invocation_id)
        assert after.control_plane_runtime_outcome is None
        assert after.runtime_observation_json == {"status": "succeeded"}


class TestProjectionCustody:
    @pytest.mark.parametrize(
        ("field", "value"),
        [
            *LOSS_CUSTODY_MISMATCHES,
            pytest.param("anyharness_run_id", FOREIGN_RUN_ID, id="foreign-run"),
        ],
    )
    async def test_projection_rejects_stale_or_foreign_custody(
        self, db_session: AsyncSession, field: str, value: object
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        accepted = await seed_accepted_delivery(db_session, invocation_id)
        assert accepted.runtime_payload_digest is not None
        kwargs: dict[str, object] = dict(
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            runtime_revision=1,
            runtime_observation_json={"status": "running"},
            runtime_observed_at=_OBSERVED_AT,
            expected_runtime_payload_digest=accepted.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_TARGET,
        )
        refused = await delivery_store.update_runtime_projection(
            db_session, **{**kwargs, field: value}
        )
        assert refused is None
        assert (await read_delivery(db_session, invocation_id)).runtime_revision is None
        # Positive control: the perturbed field was the only thing wrong.
        exact = await delivery_store.update_runtime_projection(db_session, **kwargs)
        assert exact is not None and exact.runtime_revision == 1

    async def test_desktop_projection_fences_install_and_kind(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(
            db_session, target_kind="desktop", desktop_install_id=DEFAULT_INSTALL
        )
        await handoff_and_fix(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        accepted = await accept_delivery(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        assert accepted is not None
        for wrong_target in (
            DEFAULT_TARGET,
            DesktopTarget(desktop_install_id="install-other"),
        ):
            refused = await project_observation(
                db_session,
                invocation_id,
                revision=1,
                observation={"status": "running"},
                observed_at=_OBSERVED_AT,
                target=wrong_target,
            )
            assert refused is None
        exact = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": "running"},
            observed_at=_OBSERVED_AT,
            target=DEFAULT_DESKTOP_TARGET,
        )
        assert exact is not None and exact.runtime_revision == 1

    async def test_terminal_projection_is_never_overwritten(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await seed_accepted_delivery(db_session, invocation_id)
        done = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": "succeeded"},
            observed_at=_OBSERVED_AT,
        )
        assert done is not None
        # Even a strictly greater revision cannot rewrite the run's result.
        late = await project_observation(
            db_session,
            invocation_id,
            revision=2,
            observation={"status": "running"},
            observed_at=_OBSERVED_AT,
        )
        assert late is None
        after = await read_delivery(db_session, invocation_id)
        assert after.runtime_revision == 1
        assert after.runtime_observation_json == {"status": "succeeded"}


class TestCancellation:
    async def test_unoffered_queued_cancel_is_terminal(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        cancelled = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert cancelled is not None and cancelled.status == "cancelled"
        assert cancelled.cancel_requested_at is not None
        assert cancelled.finished_at is not None
        # Already terminal: the explicit converge helper has nothing left.
        converged = await delivery_store.record_delivery_cancelled_converged(
            db_session, invocation_id=invocation_id
        )
        assert converged is None

    async def test_post_handoff_cancel_preserves_exact_reput_custody(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        marked = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert marked is not None and marked.status == "delivering"
        assert marked.cancel_requested_at is not None
        # The payload may be in flight: the exact re-PUT custody is untouched.
        assert marked.runtime_payload_json == fixed.runtime_payload_json
        assert marked.runtime_payload_digest == fixed.runtime_payload_digest
        assert marked.anyharness_data_epoch == fixed.anyharness_data_epoch
        converged = await delivery_store.record_delivery_cancelled_converged(
            db_session, invocation_id=invocation_id
        )
        assert converged is None

    async def test_accepted_row_keeps_the_cancel_marker_pending(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await seed_accepted_delivery(db_session, invocation_id)
        marked = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert marked is not None and marked.status == "accepted"
        assert marked.cancel_requested_at is not None
        converged = await delivery_store.record_delivery_cancelled_converged(
            db_session, invocation_id=invocation_id
        )
        assert converged is None

    async def test_no_marker_is_written_after_a_terminal_observation(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await seed_accepted_delivery(db_session, invocation_id)
        projected = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": "succeeded"},
            observed_at=_OBSERVED_AT,
        )
        assert projected is not None
        after = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert after is not None and after.status == "accepted"
        assert after.cancel_requested_at is None

    async def test_cancel_marker_is_first_write_wins(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        await handoff_and_fix(db_session, invocation_id)
        first = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert first is not None and first.cancel_requested_at is not None
        again = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert again is not None
        assert again.cancel_requested_at == first.cancel_requested_at
