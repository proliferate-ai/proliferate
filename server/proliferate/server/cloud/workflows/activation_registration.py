"""Required-invocation activation registration (WS3c, feature spec §7.3).

Owns the runtime's first move in the §7.3 flow: "runtime persists attempt and
generates a non-agent-controlled activation id -> runtime activates (run, slot,
session, step, attempt, turn) through its authenticated control/report
channel". The registration itself is a pure identity write — no authorization
decision happens here (that is the live gateway seam, ``activation_receipts.py``,
at CALL time) — but it is durable-before-response and idempotent by the SAME
contract shape WS3b's credential exchange uses:

* an identical retry (same ``activation_id`` AND the same identity tuple) is a
  no-op that returns the already-persisted row;
* a conflicting reuse of an ``activation_id`` under a DIFFERENT identity is a
  typed 409 — the runtime must mint a fresh ``activation_id`` for each new
  activation, never reuse one across steps/attempts/slots.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.workflow_ledger import activations as activations_store
from proliferate.db.store.workflow_ledger import gateway as ledger_gateway
from proliferate.db.store.workflow_ledger.records import ActivationRecord
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.workflows.domain.capabilities import (
    CAPABILITY_KIND_FUNCTION,
    CAPABILITY_KIND_INTEGRATION_TOOL,
    parse_capability_key,
)

_REQUIRED_INVOCATION_KINDS = frozenset(
    {CAPABILITY_KIND_INTEGRATION_TOOL, CAPABILITY_KIND_FUNCTION}
)


def _identity_matches(existing: ActivationRecord, *, run_id: UUID, **fields: object) -> bool:
    if existing.run_id != run_id:
        return False
    return all(getattr(existing, key) == value for key, value in fields.items())


async def register_activation(
    db: AsyncSession,
    *,
    run_id: UUID,
    plan_hash: str,
    slot_id: str,
    session_id: str,
    step_key: str,
    attempt: int,
    activation_id: str,
    capability_key: str,
    turn_id: str | None = None,
) -> ActivationRecord:
    """Register one required-invocation activation identity (§7.3).

    Idempotent on ``(activation_id, <the full identity tuple>)``; a conflicting
    reuse of ``activation_id`` under a different tuple is a typed 409. A
    ``capability_key`` naming anything other than an ``integration_tool`` or
    ``function`` is rejected (§7.1: "Product MCP is not a required-invocation
    target in v1"). Best-effort fail-fast: when the run already has frozen
    capability leases (WS3a), the named ``(slot_id, capability_key)`` must be
    one of them — a legacy run with no leases registers without this check
    (legacy-open, matching WS3b's lease-gating convention); the live gateway
    seam re-verifies unconditionally at call time regardless.
    """

    try:
        parsed = parse_capability_key(capability_key)
    except ValueError:
        raise CloudApiError(
            "workflow_activation_capability_malformed",
            "The activation's capability_key is malformed.",
            status_code=400,
        ) from None
    if parsed.kind not in _REQUIRED_INVOCATION_KINDS:
        raise CloudApiError(
            "workflow_activation_capability_kind_invalid",
            "A required invocation may only activate an integration_tool or function capability.",
            status_code=400,
        )

    leases = await ledger_gateway.list_capability_leases(db, run_id=run_id)
    if leases and not any(
        lease.slot_id == slot_id and lease.capability_key == capability_key for lease in leases
    ):
        raise CloudApiError(
            "workflow_activation_capability_not_leased",
            "This capability is not leased to this slot for this run.",
            status_code=404,
        )

    existing = await activations_store.get_activation_by_id(db, activation_id=activation_id)
    if existing is not None:
        if _identity_matches(
            existing,
            run_id=run_id,
            plan_hash=plan_hash,
            slot_id=slot_id,
            session_id=session_id,
            step_key=step_key,
            attempt=attempt,
            capability_key=capability_key,
        ):
            return existing  # identical retry — durable-before-response no-op.
        raise CloudApiError(
            "workflow_activation_conflict",
            "This activation id is already registered under a different identity.",
            status_code=409,
        )

    return await activations_store.insert_activation(
        db,
        run_id=run_id,
        plan_hash=plan_hash,
        slot_id=slot_id,
        session_id=session_id,
        step_key=step_key,
        attempt=attempt,
        activation_id=activation_id,
        capability_key=capability_key,
        turn_id=turn_id,
    )
