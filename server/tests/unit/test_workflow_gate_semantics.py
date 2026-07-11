"""Pure required-invocation gate-satisfaction logic (WS3c, feature spec §7.3, WF-9).

No DB, no HTTP: ``domain.gate`` is exercised directly over a plain dataclass
that structurally satisfies ``ReceiptView``, covering every non-satisfying
receipt class the spec names (denied, failed, stale, wrong-slot, wrong-step,
wrong-attempt) plus the one satisfying case, per WF-9: "A required invocation
is satisfied only by a successful authoritative gateway receipt for the
current attempt."
"""

from __future__ import annotations

from dataclasses import dataclass

from proliferate.server.cloud.workflows.domain import gate
from proliferate.server.cloud.workflows.domain.capabilities import FunctionRef

_CAPABILITY_KEY = FunctionRef(definition_id="fn-1", semantic_revision=3).capability_key
_OTHER_CAPABILITY_KEY = FunctionRef(definition_id="fn-2", semantic_revision=1).capability_key


@dataclass(frozen=True)
class _Receipt:
    """A minimal stand-in that structurally satisfies ``gate.ReceiptView``."""

    authorization_decision: str = "allow"
    outcome: str = "success"
    slot_id: str = "main"
    step_key: str = "root::node-1::-::step-1"
    attempt: int = 1
    capability_kind: str = "function"
    provider_definition_id: str | None = None
    provider_revision: str | None = None
    tool_name: str | None = None
    function_definition_id: str | None = "fn-1"
    semantic_revision: int | None = 3


def _classify(receipt: _Receipt, *, attempt: int = 1) -> str:
    return gate.classify_receipt(
        receipt,
        slot_id="main",
        step_key="root::node-1::-::step-1",
        attempt=attempt,
        capability_key=_CAPABILITY_KEY,
    )


def test_satisfied_receipt() -> None:
    assert _classify(_Receipt()) == "satisfied"
    assert gate.gate_satisfied(
        [_Receipt()],
        slot_id="main",
        step_key="root::node-1::-::step-1",
        attempt=1,
        capability_key=_CAPABILITY_KEY,
    )


def test_denied_receipt_does_not_satisfy() -> None:
    receipt = _Receipt(authorization_decision="deny", outcome="denied")
    assert _classify(receipt) == "denied"


def test_failed_outcome_does_not_satisfy() -> None:
    for outcome in ("upstream_failed", "output_invalid"):
        assert _classify(_Receipt(outcome=outcome)) == "failed"


def test_stale_attempt_does_not_satisfy_a_later_attempt() -> None:
    # The receipt belongs to attempt 1; the gate is evaluated for attempt 2.
    receipt = _Receipt(attempt=1)
    assert _classify(receipt, attempt=2) == "stale"


def test_wrong_attempt_a_future_attempt_does_not_satisfy_an_earlier_one() -> None:
    receipt = _Receipt(attempt=3)
    assert _classify(receipt, attempt=1) == "wrong_attempt"


def test_wrong_slot_does_not_satisfy() -> None:
    receipt = _Receipt(slot_id="other-slot")
    assert _classify(receipt) == "wrong_slot"


def test_wrong_step_does_not_satisfy() -> None:
    receipt = _Receipt(step_key="root::node-2::-::step-9")
    assert _classify(receipt) == "wrong_step"


def test_wrong_capability_does_not_satisfy() -> None:
    # A clean, current-attempt, right-slot-and-step success — for the WRONG
    # capability (a different function than the one this step activates).
    receipt = _Receipt(function_definition_id="fn-2", semantic_revision=1)
    assert _classify(receipt) == "wrong_capability"
    assert not gate.gate_satisfied(
        [receipt],
        slot_id="main",
        step_key="root::node-1::-::step-1",
        attempt=1,
        capability_key=_CAPABILITY_KEY,
    )
    # But it DOES satisfy the gate for the capability it actually names.
    assert gate.gate_satisfied(
        [receipt],
        slot_id="main",
        step_key="root::node-1::-::step-1",
        attempt=1,
        capability_key=_OTHER_CAPABILITY_KEY,
    )


def test_any_one_satisfying_receipt_among_many_satisfies_the_gate() -> None:
    # A denied corrective turn followed by a successful one under the SAME
    # attempt: any one successful current activation satisfies the gate.
    receipts = [
        _Receipt(authorization_decision="deny", outcome="denied"),
        _Receipt(outcome="upstream_failed"),
        _Receipt(),  # the satisfying one.
    ]
    assert gate.gate_satisfied(
        receipts,
        slot_id="main",
        step_key="root::node-1::-::step-1",
        attempt=1,
        capability_key=_CAPABILITY_KEY,
    )


def test_no_receipts_never_satisfies() -> None:
    assert not gate.gate_satisfied(
        [],
        slot_id="main",
        step_key="root::node-1::-::step-1",
        attempt=1,
        capability_key=_CAPABILITY_KEY,
    )


def test_receipt_capability_key_integration_tool_arm() -> None:
    from proliferate.server.cloud.workflows.domain.capabilities import IntegrationToolRef

    receipt = _Receipt(
        capability_kind="integration_tool",
        function_definition_id=None,
        semantic_revision=None,
        provider_definition_id="prov-1",
        provider_revision="2026-01-01T00:00:00Z",
        tool_name="search",
    )
    expected = IntegrationToolRef(
        provider_definition_id="prov-1",
        provider_revision="2026-01-01T00:00:00Z",
        tool_name="search",
    ).capability_key
    assert gate.receipt_capability_key(receipt) == expected
