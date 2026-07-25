"""Adversarial real-Postgres fences for workflow delivery payload custody.

Bare-run payload custody, acceptance custody, deterministic failure custody,
and the database CHECK constraints as the last fence (PR2 design §7.2):
custody stores only the immutable canonical run object, the digest is always
recomputed from that run, and every acceptance/failure CAS binds to the exact
fixed digest, data epoch, run binding, and typed target identity correlated
against the immutable invocation row. Loss, projection, and cancellation
fences live in `test_workflow_delivery_loss`.
"""

from __future__ import annotations

import asyncio
from uuid import UUID

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store import workflow_delivery_loss as loss_store
from proliferate.db.store.workflow_delivery_custody import DesktopTarget, ManagedCloudTarget
from proliferate.server.workflows.domain.delivery import build_runtime_transport_envelope
from proliferate.utils.canonical_json import sha256_hex
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
    read_delivery,
    run_object,
    seed_delivery,
)

pytestmark = pytest.mark.asyncio

FOREIGN_RUN_ID = "20000000-0000-4000-8000-000000000009"

# One perturbed custody field per case; the CAS must reject the whole call.
TARGET_CUSTODY_MISMATCHES = [
    pytest.param("expected_runtime_payload_digest", "0" * 64, id="wrong-digest"),
    pytest.param("expected_data_epoch", "epoch-other", id="wrong-epoch"),
    pytest.param(
        "expected_target",
        ManagedCloudTarget(cloud_sandbox_id="sbx-other"),
        id="wrong-sandbox",
    ),
    pytest.param("expected_target", DEFAULT_DESKTOP_TARGET, id="wrong-target-kind"),
]
ACCEPT_CUSTODY_MISMATCHES = [
    *TARGET_CUSTODY_MISMATCHES,
    pytest.param("anyharness_run_id", FOREIGN_RUN_ID, id="foreign-run"),
]


def accept_kwargs(invocation_id: UUID, digest: str, **overrides: object) -> dict[str, object]:
    kwargs: dict[str, object] = dict(
        invocation_id=invocation_id,
        anyharness_run_id=str(invocation_id),
        expected_runtime_payload_digest=digest,
        expected_data_epoch=DEFAULT_EPOCH,
        expected_target=DEFAULT_TARGET,
    )
    kwargs.update(overrides)
    return kwargs


class TestPayloadCustody:
    async def test_digest_is_recomputed_from_the_bare_run(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        run = run_object(invocation_id)
        fixed = await handoff_and_fix(db_session, invocation_id, run_json=run)
        assert fixed.runtime_payload_json == run
        assert fixed.runtime_payload_digest == sha256_hex(run)
        assert fixed.anyharness_data_epoch == DEFAULT_EPOCH

    async def test_mismatched_run_binding_is_an_invariant_violation(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        handed = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert handed is not None
        with pytest.raises(ValueError, match="runId"):
            await fix_delivery(
                db_session,
                invocation_id,
                run_json={**run_object(invocation_id), "runId": FOREIGN_RUN_ID},
            )
        with pytest.raises(ValueError, match="bundleDigest"):
            await fix_delivery(
                db_session,
                invocation_id,
                run_json={**run_object(invocation_id), "bundleDigest": "c" * 64},
            )

    @pytest.mark.parametrize("reserved_key", ["run", "control", "expectedDataEpoch"])
    async def test_reserved_transport_keys_can_never_enter_custody(
        self, db_session: AsyncSession, reserved_key: str
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        with pytest.raises(ValueError, match="reserved transport keys"):
            await fix_delivery(
                db_session,
                invocation_id,
                run_json={**run_object(invocation_id), reserved_key: {"smuggled": True}},
            )

    async def test_queued_and_cancelled_rows_cannot_fix(
        self, db_session: AsyncSession
    ) -> None:
        queued_id = await seed_delivery(db_session)
        assert await fix_delivery(db_session, queued_id) is None
        queued = await read_delivery(db_session, queued_id)
        assert queued.status == "queued" and queued.runtime_payload_digest is None

        cancelled_id = await seed_delivery(db_session)
        cancelled = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=cancelled_id
        )
        assert cancelled is not None and cancelled.status == "cancelled"
        assert await fix_delivery(db_session, cancelled_id) is None
        after = await read_delivery(db_session, cancelled_id)
        assert after.status == "cancelled"
        assert after.runtime_payload_json is None and after.runtime_payload_digest is None

    async def test_fix_under_the_wrong_typed_target_leaves_custody_empty(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        handed = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert handed is not None
        wrong_targets = (ManagedCloudTarget(cloud_sandbox_id="sbx-other"), DEFAULT_DESKTOP_TARGET)
        for wrong_target in wrong_targets:
            assert await fix_delivery(db_session, invocation_id, target=wrong_target) is None
        after = await read_delivery(db_session, invocation_id)
        assert after.status == "delivering"
        assert after.runtime_payload_json is None
        assert after.runtime_payload_digest is None
        assert after.anyharness_data_epoch is None
        # Positive control: the exact bound target was the only thing wrong.
        fixed = await fix_delivery(db_session, invocation_id)
        assert fixed is not None and fixed.runtime_payload_digest is not None

    async def test_first_writer_fixes_the_atomic_run_digest_epoch_tuple(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        handed = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert handed is not None
        await db_session.commit()
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

        async def fixer(marker: str) -> str | None:
            async with session_factory() as session:
                fixed = await fix_delivery(
                    session,
                    invocation_id,
                    run_json={**run_object(invocation_id), "attemptMarker": marker},
                    epoch=f"epoch-{marker}",
                )
                await session.commit()
                return None if fixed is None else fixed.runtime_payload_digest

        digests = await asyncio.gather(fixer("a"), fixer("b"))
        # The loser receives the winning custody, never its own candidate.
        assert digests[0] is not None and digests[0] == digests[1]

        # A fresh third session proves the run, digest, and epoch are one
        # writer's atomic tuple — never a cross-writer mixture.
        async with session_factory() as session:
            final = await read_delivery(session, invocation_id)
        assert final.runtime_payload_json is not None
        marker = final.runtime_payload_json["attemptMarker"]
        assert final.anyharness_data_epoch == f"epoch-{marker}"
        assert final.runtime_payload_digest == digests[0]
        assert sha256_hex(final.runtime_payload_json) == final.runtime_payload_digest

    async def test_fix_fallback_returns_none_on_a_lost_row(
        self, db_session: AsyncSession
    ) -> None:
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
        assert await fix_delivery(db_session, invocation_id) is None

    async def test_managed_sandbox_is_immutable_once_bound(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        first = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert first is not None and first.cloud_sandbox_id == "sbx-1"
        # A retry naming a different sandbox is refused, never rebound.
        rebound = await delivery_store.mark_delivery_handoff_started(
            db_session,
            invocation_id=invocation_id,
            expected_target=ManagedCloudTarget(cloud_sandbox_id="sbx-2"),
        )
        assert rebound is None
        same = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert same is not None and same.cloud_sandbox_id == "sbx-1"

    async def test_reput_envelope_reconstructs_from_custody_and_durable_cancel_state(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await handoff_and_fix(db_session, invocation_id)
        marked = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert marked is not None and marked.cancel_requested_at is not None
        await db_session.commit()

        # A later attempt reads only the custodied row and reconstructs the
        # transport envelope; the custodied run's digest never moves.
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            custodied = await read_delivery(session, invocation_id)
        assert custodied.runtime_payload_json is not None
        assert custodied.anyharness_data_epoch is not None
        envelope = build_runtime_transport_envelope(
            run=custodied.runtime_payload_json,
            expected_data_epoch=custodied.anyharness_data_epoch,
            cancel_requested=custodied.cancel_requested_at is not None,
        )
        assert envelope == {
            "expectedDataEpoch": DEFAULT_EPOCH,
            "run": custodied.runtime_payload_json,
            "control": {"cancelRequested": True},
        }
        assert sha256_hex(custodied.runtime_payload_json) == custodied.runtime_payload_digest


class TestAcceptanceCustody:
    async def test_premature_acceptance_from_queued_is_refused(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        premature = await delivery_store.record_delivery_accepted(
            db_session, **accept_kwargs(invocation_id, "d" * 64)
        )
        assert premature is None
        after = await read_delivery(db_session, invocation_id)
        assert after.status == "queued" and after.anyharness_run_id is None

    @pytest.mark.parametrize(("field", "value"), ACCEPT_CUSTODY_MISMATCHES)
    async def test_acceptance_rejects_mismatched_custody(
        self, db_session: AsyncSession, field: str, value: object
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        assert fixed.runtime_payload_digest is not None
        kwargs = accept_kwargs(invocation_id, fixed.runtime_payload_digest)
        kwargs[field] = value
        assert await delivery_store.record_delivery_accepted(db_session, **kwargs) is None
        after = await read_delivery(db_session, invocation_id)
        assert after.status == "delivering" and after.anyharness_run_id is None

    async def test_desktop_acceptance_fences_kind_and_install(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(
            db_session, target_kind="desktop", desktop_install_id=DEFAULT_INSTALL
        )
        await handoff_and_fix(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        wrong_kind = await accept_delivery(db_session, invocation_id, target=DEFAULT_TARGET)
        assert wrong_kind is None
        wrong_install = await accept_delivery(
            db_session,
            invocation_id,
            target=DesktopTarget(desktop_install_id="install-other"),
        )
        assert wrong_install is None
        assert (await read_delivery(db_session, invocation_id)).status == "delivering"
        # A true desktop acceptance binds the run and keeps the sandbox NULL.
        accepted = await accept_delivery(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        assert accepted is not None and accepted.status == "accepted"
        assert accepted.cloud_sandbox_id is None
        assert accepted.anyharness_run_id == str(invocation_id)

    async def test_exact_replay_is_an_idempotent_success(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(db_session, invocation_id)
        assert first is not None and first.accepted_at is not None
        replay = await accept_delivery(db_session, invocation_id)
        assert replay is not None and replay.status == "accepted"
        assert replay.accepted_at == first.accepted_at

    async def test_acceptance_after_a_pending_cancel_keeps_the_marker(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await handoff_and_fix(db_session, invocation_id)
        marked = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert marked is not None and marked.status == "delivering"
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None and accepted.status == "accepted"
        assert accepted.cancel_requested_at == marked.cancel_requested_at

    async def test_workspace_fill_matrix(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(db_session, invocation_id)
        assert first is not None and first.anyharness_workspace_id is None
        assert first.accepted_at is not None
        # A later replay that knows the workspace fills it monotonically.
        filled = await accept_delivery(db_session, invocation_id, anyharness_workspace_id="ws-1")
        assert filled is not None and filled.anyharness_workspace_id == "ws-1"
        assert filled.accepted_at == first.accepted_at
        omitted = await accept_delivery(db_session, invocation_id)
        assert omitted is not None and omitted.anyharness_workspace_id == "ws-1"
        equal = await accept_delivery(db_session, invocation_id, anyharness_workspace_id="ws-1")
        assert equal is not None and equal.anyharness_workspace_id == "ws-1"
        conflicting = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-2"
        )
        assert conflicting is None
        assert (await read_delivery(db_session, invocation_id)).anyharness_workspace_id == "ws-1"

    @pytest.mark.parametrize(("field", "value"), ACCEPT_CUSTODY_MISMATCHES)
    async def test_workspace_fill_requires_exact_custody(
        self, db_session: AsyncSession, field: str, value: object
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(db_session, invocation_id)
        assert first is not None and first.runtime_payload_digest is not None
        kwargs = accept_kwargs(
            invocation_id, first.runtime_payload_digest, anyharness_workspace_id="ws-1"
        )
        kwargs[field] = value
        assert await delivery_store.record_delivery_accepted(db_session, **kwargs) is None
        assert (await read_delivery(db_session, invocation_id)).anyharness_workspace_id is None


class TestFailureCustody:
    async def test_failed_before_handoff_only_from_an_unoffered_row(
        self, db_session: AsyncSession
    ) -> None:
        queued_id = await seed_delivery(db_session)
        failed = await delivery_store.record_delivery_failed_before_handoff(
            db_session, invocation_id=queued_id, error_code="resolve_failed", error_message="x"
        )
        assert failed is not None and failed.status == "failed"
        assert failed.error_code == "resolve_failed" and failed.finished_at is not None

        offered_id = await seed_delivery(db_session)
        handed = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=offered_id, expected_target=DEFAULT_TARGET
        )
        assert handed is not None
        late = await delivery_store.record_delivery_failed_before_handoff(
            db_session, invocation_id=offered_id, error_code="resolve_failed", error_message="x"
        )
        assert late is None
        assert (await read_delivery(db_session, offered_id)).status == "delivering"

    async def test_failed_before_handoff_never_overwrites_a_cancel_marker(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        cancelled = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert cancelled is not None and cancelled.status == "cancelled"
        refused = await delivery_store.record_delivery_failed_before_handoff(
            db_session, invocation_id=invocation_id, error_code="x", error_message="x"
        )
        assert refused is None
        after = await read_delivery(db_session, invocation_id)
        assert after.status == "cancelled" and after.error_code is None

    async def test_failed_after_handoff_states_exactly_the_observed_custody(
        self, db_session: AsyncSession
    ) -> None:
        # Before any payload was fixed, None expecteds are the exact statement.
        prefix_id = await seed_delivery(db_session)
        handed = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=prefix_id, expected_target=DEFAULT_TARGET
        )
        assert handed is not None
        failed = await fail_after_handoff(db_session, prefix_id, digest=None, epoch=None)
        assert failed is not None and failed.status == "failed"

        fixed_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, fixed_id)
        rejected = await fail_after_handoff(
            db_session, fixed_id, digest=fixed.runtime_payload_digest
        )
        assert rejected is not None and rejected.status == "failed"
        assert rejected.finished_at is not None

    @pytest.mark.parametrize(("field", "value"), TARGET_CUSTODY_MISMATCHES)
    async def test_failed_after_handoff_rejects_stale_or_foreign_custody(
        self, db_session: AsyncSession, field: str, value: object
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, invocation_id)
        kwargs: dict[str, object] = dict(
            invocation_id=invocation_id,
            error_code="target_rejected",
            error_message="x",
            expected_runtime_payload_digest=fixed.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_TARGET,
        )
        kwargs[field] = value
        refused = await delivery_store.record_delivery_failed_after_handoff(db_session, **kwargs)
        assert refused is None
        assert (await read_delivery(db_session, invocation_id)).status == "delivering"

    async def test_failed_after_handoff_fences_the_desktop_install(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(
            db_session, target_kind="desktop", desktop_install_id=DEFAULT_INSTALL
        )
        fixed = await handoff_and_fix(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        for wrong_target in (DesktopTarget(desktop_install_id="install-other"), DEFAULT_TARGET):
            refused = await fail_after_handoff(
                db_session,
                invocation_id,
                digest=fixed.runtime_payload_digest,
                target=wrong_target,
            )
            assert refused is None
        assert (await read_delivery(db_session, invocation_id)).status == "delivering"
        exact = await fail_after_handoff(
            db_session,
            invocation_id,
            digest=fixed.runtime_payload_digest,
            target=DEFAULT_DESKTOP_TARGET,
        )
        assert exact is not None and exact.status == "failed"

    async def test_failure_never_overwrites_accepted_cancel_pending_or_lost(
        self, db_session: AsyncSession
    ) -> None:
        accepted_id = await seed_delivery(db_session)
        fixed = await handoff_and_fix(db_session, accepted_id)
        assert await accept_delivery(db_session, accepted_id) is not None
        assert await fail_after_handoff(
            db_session, accepted_id, digest=fixed.runtime_payload_digest
        ) is None
        assert (await read_delivery(db_session, accepted_id)).status == "accepted"

        pending_id = await seed_delivery(db_session)
        pending_fixed = await handoff_and_fix(db_session, pending_id)
        marked = await delivery_store.request_delivery_cancel(db_session, invocation_id=pending_id)
        assert marked is not None and marked.cancel_requested_at is not None
        assert await fail_after_handoff(
            db_session, pending_id, digest=pending_fixed.runtime_payload_digest
        ) is None
        after = await read_delivery(db_session, pending_id)
        assert after.status == "delivering" and after.cancel_requested_at is not None

        lost_id = await seed_delivery(db_session)
        lost_fixed = await handoff_and_fix(db_session, lost_id)
        lost = await loss_store.record_runtime_lost_epoch_changed(
            db_session,
            invocation_id=lost_id,
            expected_status="delivering",
            observed_data_epoch="epoch-2",
            **lost_proof_kwargs(lost_fixed),
        )
        assert lost is not None
        assert await fail_after_handoff(
            db_session, lost_id, digest=lost_fixed.runtime_payload_digest
        ) is None


class TestDatabaseConstraints:
    """Raw-SQL probes: each statement violates exactly one CHECK, so the
    asserted constraint name is the one Postgres reports."""

    async def _expect_check_violation(
        self, db: AsyncSession, invocation_id: UUID, set_clause: str, constraint: str
    ) -> None:
        with pytest.raises(IntegrityError, match=constraint):
            await db.execute(
                text(
                    "UPDATE workflow_invocation_delivery SET "
                    + set_clause
                    + " WHERE invocation_id = :id"
                ),
                {"id": invocation_id},
            )
        await db.rollback()

    async def test_acceptance_without_custody_is_rejected(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        await self._expect_check_violation(
            db_session,
            invocation_id,
            "status = 'accepted', accepted_at = now(), handoff_started_at = now()",
            "ck_wf_delivery_accepted_custody",
        )

    async def test_runtime_outcome_without_a_fixed_epoch_is_rejected(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = await seed_delivery(db_session)
        handed = await delivery_store.mark_delivery_handoff_started(
            db_session, invocation_id=invocation_id, expected_target=DEFAULT_TARGET
        )
        assert handed is not None
        await db_session.commit()
        await self._expect_check_violation(
            db_session,
            invocation_id,
            "control_plane_runtime_outcome = 'runtime_lost',"
            " control_plane_runtime_outcome_at = now(),"
            " control_plane_runtime_outcome_reason = 'epoch_changed'",
            "ck_wf_delivery_outcome_needs_handoff",
        )

    async def test_foreign_run_binding_is_rejected(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        await self._expect_check_violation(
            db_session,
            invocation_id,
            f"anyharness_run_id = '{FOREIGN_RUN_ID}'",
            "ck_wf_delivery_run_binding",
        )

    async def test_cancelled_row_can_carry_no_custody(self, db_session: AsyncSession) -> None:
        invocation_id = await seed_delivery(db_session)
        cancelled = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert cancelled is not None and cancelled.status == "cancelled"
        await db_session.commit()
        await self._expect_check_violation(
            db_session,
            invocation_id,
            "handoff_started_at = now()",
            "ck_wf_delivery_cancelled_unoffered",
        )
