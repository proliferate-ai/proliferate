"""Pure required-invocation gate-satisfaction logic (WS3c, feature spec §7.3, WF-9).

WF-9: "A required invocation is satisfied only by a successful authoritative
gateway receipt for the current attempt." This module is the single place that
decision lives, expressed over plain data so both the server (``activation_
receipts.py``, over real ``GatewayReceiptRecord`` rows) and WS5c's Rust runtime
mirror can implement the identical rule without re-deriving it independently.

A receipt satisfies the gate for a given ``(slot_id, step_key, attempt,
capability_key)`` iff it is:

* authorized (``authorization_decision == "allow"`` — a denied receipt never
  satisfies, no matter its outcome);
* successful (``outcome == "success"`` — denied/upstream-failed/output-invalid
  never satisfy);
* for the EXACT slot, step, attempt, and capability being gated — any mismatch
  (wrong slot, wrong step, an older/"stale" attempt, a newer/other "wrong"
  attempt, or a different capability than the one this step activates) never
  satisfies, even if everything else about the receipt is a clean success.

Every corrective turn mints a new activation under the SAME attempt, so many
receipts may exist for one ``(slot_id, step_key, attempt)`` — the gate is
satisfied the moment ANY one of them is a clean current-attempt success; the
others (e.g. an earlier denied/failed corrective turn) are simply irrelevant,
not gate-breaking.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Literal, Protocol

from proliferate.server.cloud.workflows.domain.capabilities import (
    CAPABILITY_KIND_FUNCTION,
    CAPABILITY_KIND_INTEGRATION_TOOL,
    FunctionRef,
    IntegrationToolRef,
)

GateReason = Literal[
    "satisfied",
    "denied",
    "failed",
    "stale",
    "wrong_slot",
    "wrong_step",
    "wrong_attempt",
    "wrong_capability",
]


class ReceiptView(Protocol):
    """The subset of a gateway receipt's fields the gate needs. A plain
    ``GatewayReceiptRecord`` (``db/store/workflow_ledger/records.py``) already
    satisfies this structurally — no domain -> store import is needed here,
    keeping this module DB/framework-free."""

    authorization_decision: str
    outcome: str
    slot_id: str
    step_key: str
    attempt: int
    capability_kind: str
    provider_definition_id: str | None
    provider_revision: str | None
    tool_name: str | None
    function_definition_id: str | None
    semantic_revision: int | None


def receipt_capability_key(receipt: ReceiptView) -> str | None:
    """Rebuild the receipt's ``capability_key`` from its denormalized identity
    columns, using the SAME codec the frozen lease and activation rows use
    (``domain.capabilities``). ``None`` when the receipt's arm is incomplete
    (should not happen for a real row; treated as "cannot match anything")."""

    if receipt.capability_kind == CAPABILITY_KIND_FUNCTION:
        if receipt.function_definition_id is None or receipt.semantic_revision is None:
            return None
        return FunctionRef(
            definition_id=receipt.function_definition_id,
            semantic_revision=receipt.semantic_revision,
        ).capability_key
    if receipt.capability_kind == CAPABILITY_KIND_INTEGRATION_TOOL:
        if (
            receipt.provider_definition_id is None
            or receipt.provider_revision is None
            or receipt.tool_name is None
        ):
            return None
        return IntegrationToolRef(
            provider_definition_id=receipt.provider_definition_id,
            provider_revision=receipt.provider_revision,
            tool_name=receipt.tool_name,
        ).capability_key
    return None


def classify_receipt(
    receipt: ReceiptView,
    *,
    slot_id: str,
    step_key: str,
    attempt: int,
    capability_key: str,
) -> GateReason:
    """Classify one receipt against the gate being evaluated. Checks run in a
    fixed priority order so every receipt gets exactly one reason."""

    if receipt.authorization_decision != "allow":
        return "denied"
    if receipt.outcome != "success":
        return "failed"
    if receipt.slot_id != slot_id:
        return "wrong_slot"
    if receipt.step_key != step_key:
        return "wrong_step"
    if receipt.attempt != attempt:
        return "stale" if receipt.attempt < attempt else "wrong_attempt"
    if receipt_capability_key(receipt) != capability_key:
        return "wrong_capability"
    return "satisfied"


def gate_satisfied(
    receipts: Iterable[ReceiptView],
    *,
    slot_id: str,
    step_key: str,
    attempt: int,
    capability_key: str,
) -> bool:
    """Whether ANY receipt in ``receipts`` satisfies the gate (WF-9: any one
    successful current activation satisfies; stale/denied/failed/wrong-*
    receipts never do, and never block a later satisfying one either)."""

    return any(
        classify_receipt(
            receipt,
            slot_id=slot_id,
            step_key=step_key,
            attempt=attempt,
            capability_key=capability_key,
        )
        == "satisfied"
        for receipt in receipts
    )
