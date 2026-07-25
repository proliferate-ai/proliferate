"""Focused real-Postgres proofs for the bare-run custody boundary (P1).

Custody stores only the immutable run object; the transport envelope is
reconstructed per attempt. Acceptance replays fill the workspace ID
monotonically, and a terminal AnyHarness projection makes cancellation a
no-op. The broad adversarial custody/loss battery lives in the delivery
custody suites.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from proliferate.db.store import workflow_deliveries as delivery_store
from proliferate.db.store.workflow_delivery_custody import DesktopTarget, ManagedCloudTarget
from proliferate.server.workflows.domain.delivery import build_runtime_transport_envelope
from proliferate.utils.canonical_json import sha256_hex
from tests.unit.workflow_delivery_helpers import (
    DEFAULT_DESKTOP_TARGET,
    DEFAULT_EPOCH,
    DEFAULT_INSTALL,
    DEFAULT_TARGET,
    accept_delivery,
    handoff_and_fix,
    project_observation,
    run_object,
    seed_invocation_with_delivery,
    seed_user,
)

pytestmark = pytest.mark.asyncio

_OBSERVED_AT = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)


class TestRunCustody:
    @pytest.mark.parametrize("reserved_key", ["run", "control", "expectedDataEpoch"])
    async def test_reserved_transport_keys_are_rejected(
        self, db_session: AsyncSession, reserved_key: str
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        run = run_object(invocation_id)
        run[reserved_key] = {"smuggled": True}
        with pytest.raises(ValueError, match="reserved transport keys"):
            await delivery_store.fix_runtime_payload(
                db_session,
                invocation_id=invocation_id,
                run_json=run,
                anyharness_data_epoch=DEFAULT_EPOCH,
                expected_target=DEFAULT_TARGET,
            )

    async def test_envelope_passed_as_run_is_rejected(self, db_session: AsyncSession) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        envelope = {
            "expectedDataEpoch": DEFAULT_EPOCH,
            "run": run_object(invocation_id),
            "control": {"cancelRequested": False},
        }
        with pytest.raises(ValueError, match="reserved transport keys"):
            await delivery_store.fix_runtime_payload(
                db_session,
                invocation_id=invocation_id,
                run_json=envelope,
                anyharness_data_epoch=DEFAULT_EPOCH,
                expected_target=DEFAULT_TARGET,
            )

    async def test_custody_stores_bare_run_and_its_digest(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        fixed = await handoff_and_fix(db_session, invocation_id)
        assert fixed.runtime_payload_json == run_object(invocation_id)
        assert fixed.runtime_payload_digest == sha256_hex(run_object(invocation_id))

    async def test_committed_custody_reloads_exactly_in_a_fresh_session(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        run = run_object(invocation_id)
        run["arguments"] = {"exp": 1e21, "plain": 7}
        fixed = await handoff_and_fix(db_session, invocation_id, run_json=run)
        assert fixed.runtime_payload_digest is not None
        await db_session.commit()

        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)
        async with session_factory() as session:
            reloaded = await delivery_store.get_workflow_delivery(
                session, invocation_id=invocation_id
            )
        assert reloaded is not None
        assert reloaded.runtime_payload_json == run
        assert reloaded.runtime_payload_digest == fixed.runtime_payload_digest
        assert reloaded.runtime_payload_json is not None
        assert sha256_hex(reloaded.runtime_payload_json) == fixed.runtime_payload_digest
        assert reloaded.anyharness_data_epoch == DEFAULT_EPOCH


class TestTransportEnvelope:
    async def test_reconstruction_carries_current_cancel_state_over_fixed_custody(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        cancelled = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert cancelled is not None
        assert cancelled.status == "delivering"
        assert cancelled.cancel_requested_at is not None
        assert cancelled.runtime_payload_json is not None
        assert cancelled.anyharness_data_epoch is not None

        envelope = build_runtime_transport_envelope(
            run=cancelled.runtime_payload_json,
            expected_data_epoch=cancelled.anyharness_data_epoch,
            cancel_requested=cancelled.cancel_requested_at is not None,
        )
        assert envelope["control"] == {"cancelRequested": True}
        assert envelope["expectedDataEpoch"] == DEFAULT_EPOCH
        run = envelope["run"]
        assert isinstance(run, dict)
        assert sha256_hex(run) == cancelled.runtime_payload_digest

        flipped = build_runtime_transport_envelope(
            run=cancelled.runtime_payload_json,
            expected_data_epoch=cancelled.anyharness_data_epoch,
            cancel_requested=False,
        )
        assert flipped["control"] == {"cancelRequested": False}
        assert sha256_hex(flipped["run"]) == cancelled.runtime_payload_digest

    async def test_envelope_validation(self) -> None:
        run = run_object(uuid4())
        with pytest.raises(ValueError, match="data epoch"):
            build_runtime_transport_envelope(
                run=run, expected_data_epoch="", cancel_requested=False
            )
        with pytest.raises(ValueError, match="runId"):
            build_runtime_transport_envelope(
                run={"contractVersion": 1},
                expected_data_epoch=DEFAULT_EPOCH,
                cancel_requested=False,
            )
        with pytest.raises(ValueError, match="reserved transport keys"):
            build_runtime_transport_envelope(
                run={**run, "control": {}},
                expected_data_epoch=DEFAULT_EPOCH,
                cancel_requested=False,
            )


class TestAcceptanceWorkspaceFill:
    async def test_null_then_value_fills_and_preserves_accepted_at(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(db_session, invocation_id)
        assert first is not None
        assert first.anyharness_workspace_id is None
        assert first.accepted_at is not None

        filled = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-1"
        )
        assert filled is not None
        assert filled.anyharness_workspace_id == "ws-1"
        assert filled.accepted_at == first.accepted_at

    async def test_omitted_and_equal_workspace_replays_succeed(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-1"
        )
        assert first is not None and first.anyharness_workspace_id == "ws-1"

        omitted = await accept_delivery(db_session, invocation_id)
        assert omitted is not None and omitted.anyharness_workspace_id == "ws-1"
        equal = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-1"
        )
        assert equal is not None and equal.anyharness_workspace_id == "ws-1"

    async def test_conflicting_workspace_is_a_no_op(self, db_session: AsyncSession) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-1"
        )
        assert first is not None

        conflicting = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-2"
        )
        assert conflicting is None
        current = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert current is not None and current.anyharness_workspace_id == "ws-1"

    async def test_fill_requires_exact_custody(self, db_session: AsyncSession) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        first = await accept_delivery(db_session, invocation_id)
        assert first is not None and first.runtime_payload_digest is not None

        wrong_digest = await delivery_store.record_delivery_accepted(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            expected_runtime_payload_digest="0" * 64,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_TARGET,
            anyharness_workspace_id="ws-1",
        )
        assert wrong_digest is None
        wrong_epoch = await delivery_store.record_delivery_accepted(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            expected_runtime_payload_digest=first.runtime_payload_digest,
            expected_data_epoch="epoch-wrong",
            expected_target=DEFAULT_TARGET,
            anyharness_workspace_id="ws-1",
        )
        assert wrong_epoch is None
        wrong_sandbox = await delivery_store.record_delivery_accepted(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            expected_runtime_payload_digest=first.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=ManagedCloudTarget(cloud_sandbox_id="sbx-other"),
            anyharness_workspace_id="ws-1",
        )
        assert wrong_sandbox is None
        wrong_kind = await delivery_store.record_delivery_accepted(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(invocation_id),
            expected_runtime_payload_digest=first.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_DESKTOP_TARGET,
            anyharness_workspace_id="ws-1",
        )
        assert wrong_kind is None
        foreign_run = await delivery_store.record_delivery_accepted(
            db_session,
            invocation_id=invocation_id,
            anyharness_run_id=str(uuid4()),
            expected_runtime_payload_digest=first.runtime_payload_digest,
            expected_data_epoch=DEFAULT_EPOCH,
            expected_target=DEFAULT_TARGET,
            anyharness_workspace_id="ws-1",
        )
        assert foreign_run is None
        current = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert current is not None and current.anyharness_workspace_id is None

        # Positive control: the exact custody is the only thing that was wrong.
        exact = await accept_delivery(
            db_session, invocation_id, anyharness_workspace_id="ws-1"
        )
        assert exact is not None and exact.anyharness_workspace_id == "ws-1"

    async def test_desktop_fill_requires_exact_install_and_kind(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(
            db_session,
            user_id=user_id,
            target_kind="desktop",
            desktop_install_id=DEFAULT_INSTALL,
        )
        await handoff_and_fix(db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET)
        first = await accept_delivery(
            db_session, invocation_id, target=DEFAULT_DESKTOP_TARGET
        )
        assert first is not None and first.anyharness_workspace_id is None

        wrong_install = await accept_delivery(
            db_session,
            invocation_id,
            target=DesktopTarget(desktop_install_id="install-other"),
            anyharness_workspace_id="ws-1",
        )
        assert wrong_install is None
        wrong_kind = await accept_delivery(
            db_session,
            invocation_id,
            target=DEFAULT_TARGET,
            anyharness_workspace_id="ws-1",
        )
        assert wrong_kind is None
        current = await delivery_store.get_workflow_delivery(
            db_session, invocation_id=invocation_id
        )
        assert current is not None and current.anyharness_workspace_id is None

        exact = await accept_delivery(
            db_session,
            invocation_id,
            target=DEFAULT_DESKTOP_TARGET,
            anyharness_workspace_id="ws-1",
        )
        assert exact is not None and exact.anyharness_workspace_id == "ws-1"

    async def test_two_writer_fill_race_has_exactly_one_winner(
        self, test_engine: AsyncEngine, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        fixed = await handoff_and_fix(db_session, invocation_id)
        assert fixed.runtime_payload_digest is not None
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None and accepted.anyharness_workspace_id is None
        assert accepted.accepted_at is not None
        await db_session.commit()
        session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

        async def fill(workspace_id: str) -> str | None:
            async with session_factory() as session:
                filled = await delivery_store.record_delivery_accepted(
                    session,
                    invocation_id=invocation_id,
                    anyharness_run_id=str(invocation_id),
                    expected_runtime_payload_digest=fixed.runtime_payload_digest,
                    expected_data_epoch=DEFAULT_EPOCH,
                    expected_target=DEFAULT_TARGET,
                    anyharness_workspace_id=workspace_id,
                )
                await session.commit()
                return None if filled is None else filled.anyharness_workspace_id

        outcomes = await asyncio.gather(fill("ws-a"), fill("ws-b"))
        winners = [workspace for workspace in outcomes if workspace is not None]
        assert len(winners) == 1

        async with session_factory() as session:
            final = await delivery_store.get_workflow_delivery(
                session, invocation_id=invocation_id
            )
        assert final is not None
        assert final.anyharness_workspace_id == winners[0]
        assert final.accepted_at == accepted.accepted_at

    async def test_empty_acceptance_fields_are_invariant_violations(
        self, db_session: AsyncSession
    ) -> None:
        invocation_id = uuid4()
        with pytest.raises(ValueError, match="digest"):
            await delivery_store.record_delivery_accepted(
                db_session,
                invocation_id=invocation_id,
                anyharness_run_id=str(invocation_id),
                expected_runtime_payload_digest="",
                expected_data_epoch=DEFAULT_EPOCH,
                expected_target=DEFAULT_TARGET,
            )
        with pytest.raises(ValueError, match="data epoch"):
            await delivery_store.record_delivery_accepted(
                db_session,
                invocation_id=invocation_id,
                anyharness_run_id=str(invocation_id),
                expected_runtime_payload_digest="d" * 64,
                expected_data_epoch="",
                expected_target=DEFAULT_TARGET,
            )
        with pytest.raises(ValueError, match="workspace ID"):
            await delivery_store.record_delivery_accepted(
                db_session,
                invocation_id=invocation_id,
                anyharness_run_id=str(invocation_id),
                expected_runtime_payload_digest="d" * 64,
                expected_data_epoch=DEFAULT_EPOCH,
                expected_target=DEFAULT_TARGET,
                anyharness_workspace_id="",
            )


class TestTerminalObservationCancel:
    @pytest.mark.parametrize("terminal_status", ["succeeded", "failed", "cancelled"])
    async def test_cancel_after_terminal_projection_writes_no_marker(
        self, db_session: AsyncSession, terminal_status: str
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None
        projected = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": terminal_status},
            observed_at=_OBSERVED_AT,
        )
        assert projected is not None

        after = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert after is not None
        assert after.status == "accepted"
        assert after.cancel_requested_at is None

    async def test_cancel_after_nonterminal_projection_writes_the_marker(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await seed_user(db_session)
        invocation_id = await seed_invocation_with_delivery(db_session, user_id=user_id)
        await handoff_and_fix(db_session, invocation_id)
        accepted = await accept_delivery(db_session, invocation_id)
        assert accepted is not None
        projected = await project_observation(
            db_session,
            invocation_id,
            revision=1,
            observation={"status": "running"},
            observed_at=_OBSERVED_AT,
        )
        assert projected is not None

        after = await delivery_store.request_delivery_cancel(
            db_session, invocation_id=invocation_id
        )
        assert after is not None
        assert after.status == "accepted"
        assert after.cancel_requested_at is not None
