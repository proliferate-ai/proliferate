"""Tier-1 WS2a persistence-skeleton tests against real Postgres (part 2).

Proves the uniqueness/dedupe identities (completion plan §6 WS2a; feature spec
§7.1, §7.3, §7.4, §8.3, §10.3):

- poll inbox ``(trigger_id, external_item_id)`` dedupe
- gateway receipt ``activation_id`` uniqueness
- action effect ``(run_id, step_key, attempt)`` uniqueness, incl.
  ``outcome_uncertain``
- control-command enqueue/deliver/ack lifecycle with idempotent ack
- capability lease exact-``CapabilityRef`` storage and per-(run, slot, ref)
  uniqueness

The lease/CAS/outbox concurrency guarantees are in
``test_workflow_ledger_skeleton.py``.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store import workflow_ledger as ledger
from tests.unit.workflow_ledger_helpers import make_poll_trigger, make_run, make_user

pytestmark = pytest.mark.asyncio


# --- poll inbox dedupe (spec §10.3) ---------------------------------------------------


async def test_poll_inbox_dedupes_on_trigger_and_external_id(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)
    trigger = await make_poll_trigger(db_session, user, run.workflow_id)
    other_trigger = await make_poll_trigger(db_session, user, run.workflow_id)

    first = await ledger.upsert_poll_inbox_item(
        db_session,
        trigger_id=trigger.id,
        external_item_id="item-1",
        payload_json={"data": {"n": 1}},
    )
    assert first is not None and first.status == "pending"

    # Replayed page item: same (trigger, external id) is a dedupe no-op.
    duplicate = await ledger.upsert_poll_inbox_item(
        db_session,
        trigger_id=trigger.id,
        external_item_id="item-1",
        payload_json={"data": {"n": 999}},
    )
    assert duplicate is None
    stored = await ledger.get_poll_inbox_item(
        db_session, trigger_id=trigger.id, external_item_id="item-1"
    )
    assert stored is not None and stored.payload_json == {"data": {"n": 1}}

    # The same external id under a different trigger is a distinct item.
    other = await ledger.upsert_poll_inbox_item(
        db_session,
        trigger_id=other_trigger.id,
        external_item_id="item-1",
        payload_json={"data": {"n": 2}},
    )
    assert other is not None

    # Poison-item bookkeeping is explicit state, not silent sealing.
    dead = await ledger.update_poll_inbox_item(
        db_session,
        inbox_id=first.id,
        status="dead_letter",
        last_error="schema-invalid: data.n must be a string",
        increment_attempt=True,
    )
    assert dead is not None
    assert dead.status == "dead_letter"
    assert dead.attempt_count == 1


# --- gateway receipts (spec §7.3) -----------------------------------------------------


async def test_gateway_receipt_activation_id_is_unique(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)
    plan_hash = f"sha256:{'0' * 64}"
    step_key = "root::node-1::-::step-1"
    activation_id = f"act_{uuid.uuid4().hex}"

    receipt = await ledger.insert_gateway_receipt(
        db_session,
        run_id=run.id,
        plan_hash=plan_hash,
        slot_id="slot-1",
        session_id="session-1",
        step_key=step_key,
        attempt=1,
        activation_id=activation_id,
        capability_kind="function",
        function_definition_id="fn_notify",
        semantic_revision=3,
        authorization_decision="allow",
        outcome="success",
    )
    assert receipt.activation_id == activation_id

    # The same activation id can never record a second receipt — WS3c recovers
    # the durable record by activation identity instead.
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await ledger.insert_gateway_receipt(
                db_session,
                run_id=run.id,
                plan_hash=plan_hash,
                slot_id="slot-1",
                session_id="session-1",
                step_key=step_key,
                attempt=1,
                activation_id=activation_id,
                capability_kind="function",
                function_definition_id="fn_notify",
                semantic_revision=3,
                authorization_decision="allow",
                outcome="success",
            )

    recovered = await ledger.get_gateway_receipt_by_activation(
        db_session, activation_id=activation_id
    )
    assert recovered is not None and recovered.id == receipt.id

    per_step = await ledger.list_gateway_receipts_for_step(
        db_session, run_id=run.id, step_key=step_key, attempt=1
    )
    assert [r.id for r in per_step] == [receipt.id]


# --- required-invocation activations (spec §7.3) --------------------------------------


async def test_activation_id_is_globally_unique(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)
    plan_hash = f"sha256:{'0' * 64}"
    step_key = "root::node-1::-::step-1"
    activation_id = f"act_{uuid.uuid4().hex}"

    activation = await ledger.insert_activation(
        db_session,
        run_id=run.id,
        plan_hash=plan_hash,
        slot_id="slot-1",
        session_id="session-1",
        step_key=step_key,
        attempt=1,
        activation_id=activation_id,
        capability_key="function:fn_notify:3",
    )
    assert activation.activation_id == activation_id

    # The same activation id can never be registered twice at the DB layer — the
    # service layer (register_activation) owns idempotent-vs-conflicting-reuse.
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await ledger.insert_activation(
                db_session,
                run_id=run.id,
                plan_hash=plan_hash,
                slot_id="slot-2",
                session_id="session-2",
                step_key="root::node-2::-::step-2",
                attempt=1,
                activation_id=activation_id,
                capability_key="function:fn_other:1",
            )

    recovered = await ledger.get_activation_by_id(db_session, activation_id=activation_id)
    assert recovered is not None and recovered.id == activation.id
    assert recovered.slot_id == "slot-1"


# --- deterministic action identity (spec §7.4) -----------------------------------------


async def test_action_effect_identity_is_unique(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)
    step_key = "root::node-2::-::step-9"

    first = await ledger.insert_action_effect(
        db_session,
        run_id=run.id,
        step_key=step_key,
        attempt=1,
        action_kind="slack_notify",
        payload_json={"channel": "C1", "message": "done"},
    )
    assert first is not None and first.status == "pending"

    # A retried submission with the same (run, step_key, attempt) identity never
    # creates a second action.
    retried = await ledger.insert_action_effect(
        db_session,
        run_id=run.id,
        step_key=step_key,
        attempt=1,
        action_kind="slack_notify",
        payload_json={"channel": "C1", "message": "done"},
    )
    assert retried is None
    recovered = await ledger.get_action_effect(
        db_session, run_id=run.id, step_key=step_key, attempt=1
    )
    assert recovered is not None and recovered.id == first.id

    # A corrective attempt is a distinct identity.
    second_attempt = await ledger.insert_action_effect(
        db_session,
        run_id=run.id,
        step_key=step_key,
        attempt=2,
        action_kind="slack_notify",
        payload_json={"channel": "C1", "message": "done"},
    )
    assert second_attempt is not None

    # outcome_uncertain is a first-class terminal-ish state (never auto-resend).
    uncertain = await ledger.update_action_effect(
        db_session,
        effect_id=first.id,
        status="outcome_uncertain",
        provider_operation_id="slack:chat.postMessage",
        last_error="ambiguous send: no reconciliation match",
    )
    assert uncertain is not None and uncertain.status == "outcome_uncertain"


# --- control commands (spec §8.3) ------------------------------------------------------


async def test_control_command_enqueue_and_ack(db_session: AsyncSession) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)

    command_record = await ledger.enqueue_control_command(
        db_session,
        run_id=run.id,
        kind="cancel",
        reason="user_requested",
        plan_hash=f"sha256:{'1' * 64}",
        binding_hash=f"sha256:{'2' * 64}",
        execution_generation=1,
    )
    assert command_record.status == "pending"

    pending = await ledger.list_undelivered_control_commands(db_session, run_id=run.id)
    assert [c.id for c in pending] == [command_record.id]

    delivered = await ledger.mark_control_command_delivered(
        db_session, command_id=command_record.id
    )
    assert delivered is not None and delivered.status == "delivered"
    assert delivered.delivered_at is not None

    acked = await ledger.ack_control_command(
        db_session, command_id=command_record.id, ack_outcome="quiescent_cancelled"
    )
    assert acked is not None and acked.status == "acknowledged"
    assert acked.ack_outcome == "quiescent_cancelled"

    # A duplicate ack is idempotent and cannot rewrite the recorded outcome.
    re_acked = await ledger.ack_control_command(
        db_session, command_id=command_record.id, ack_outcome="different"
    )
    assert re_acked is not None and re_acked.ack_outcome == "quiescent_cancelled"

    assert await ledger.list_undelivered_control_commands(db_session, run_id=run.id) == ()


# --- capability leases (spec §7.1) ------------------------------------------------------


async def test_capability_lease_stores_exact_refs_per_run_slot(
    db_session: AsyncSession,
) -> None:
    user = await make_user(db_session)
    run = await make_run(db_session, user)

    tool = await ledger.insert_capability_lease(
        db_session,
        run_id=run.id,
        slot_id="018f8a10-0000-7000-8000-00000000000a",
        kind="integration_tool",
        capability_key="integration_tool:prov_github:rev_2:create_issue",
        provider_definition_id="prov_github",
        provider_revision="rev_2",
        tool_name="create_issue",
        input_schema_hash=f"sha256:{'3' * 64}",
    )
    fn = await ledger.insert_capability_lease(
        db_session,
        run_id=run.id,
        slot_id="018f8a10-0000-7000-8000-000000000001",
        kind="function",
        capability_key="function:fn_notify:3",
        function_definition_id="fn_notify",
        semantic_revision=3,
    )
    assert tool.tool_name == "create_issue"
    assert fn.semantic_revision == 3

    # The same exact ref cannot be frozen twice for one (run, slot).
    with pytest.raises(IntegrityError):
        async with db_session.begin_nested():
            await ledger.insert_capability_lease(
                db_session,
                run_id=run.id,
                slot_id="018f8a10-0000-7000-8000-000000000001",
                kind="function",
                capability_key="function:fn_notify:3",
                function_definition_id="fn_notify",
                semantic_revision=3,
            )

    leases = await ledger.list_capability_leases(db_session, run_id=run.id)
    assert {lease.capability_key for lease in leases} == {
        "integration_tool:prov_github:rev_2:create_issue",
        "function:fn_notify:3",
    }
